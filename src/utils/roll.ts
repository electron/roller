import debug from 'debug';
import * as semver from 'semver';

import {
  BACKPORT_CHECK_SKIP,
  CHROMIUM_UPGRADE_WORKFLOW,
  MAIN_BRANCH,
  NO_BACKPORT,
  REPOS,
  ROLL_TARGETS,
  ROLLER_BOT_LOGIN,
  RollTarget,
} from '../constants.js';
import { ReposListBranchesResponseItem, PullsListResponseItem } from '../types.js';
import { getOctokit } from './octokit.js';
import { getPRText } from './pr-text.js';
import { updateDepsFile } from './update-deps.js';
import { Octokit } from '@octokit/rest';
import { addLabels, removeLabel } from './label-utils.js';
import { getBranchesTrackedByMain } from './get-target-branch-labels.js';

interface RollParams {
  rollTarget: RollTarget;
  electronBranch: ReposListBranchesResponseItem;
  targetVersion: string;
  prNumber?: number;
  previousVersion?: string;
}

const TARGET_BRANCH_LABEL_PATTERN = /^target\/\d+-(?:\d+-x|x-y)$/;

// The main branch roll PR is long-lived and relabeled on every update, and
// labels are otherwise only ever added - so a `target/N-x-y` label that no
// longer qualifies (main rolled past the branch's scheduled Chromium version)
// or a `no-backport` added while the schedule was unavailable would stick
// around forever. Remove only those roller-managed labels; never touch
// anything else (merged/*, trop, semver, ...) and never replace the label set.
// Throws if any stale label could not be confirmed removed.
async function removeStaleBackportLabels(
  octokit: Octokit,
  prNumber: number,
  targetBranchLabels: string[],
) {
  const d = debug('roller/chromium:removeStaleBackportLabels()');

  const { data: labelData } = await octokit.issues.listLabelsOnIssue({
    ...REPOS.electron,
    issue_number: prNumber,
    per_page: 100,
    page: 1,
  });

  const staleLabels = labelData
    .map((label) => label.name)
    .filter(
      (name) =>
        (TARGET_BRANCH_LABEL_PATTERN.test(name) && !targetBranchLabels.includes(name)) ||
        (name === NO_BACKPORT && targetBranchLabels.length > 0),
    );

  for (const name of staleLabels) {
    d(`Removing stale backport label ${name} from #${prNumber}`);
    try {
      await octokit.issues.removeLabel({
        ...REPOS.electron,
        issue_number: prNumber,
        name,
      });
    } catch (e) {
      // Already removed out from under us - that still counts as removed.
      if (e.status === 404) continue;
      throw e;
    }
  }
}

// Updates the labels on a roll PR. Returns the names of the release branches
// the PR's `target/N-x-y` labels cover - non-empty only for Chromium rolls to
// the main branch whose backport labels were successfully reconciled.
async function updateLabels(
  octokit: Octokit,
  { rollTarget, electronBranch, targetVersion, previousVersion, prNumber }: RollParams,
  isNewPr = false,
): Promise<string[]> {
  const d = debug(`roller/${rollTarget.name}:updateLabels()`);
  let labels: string[] = [];
  let labelToRemove: string;
  let coveredBranches: string[] = [];

  if (electronBranch.name === MAIN_BRANCH) {
    let targetBranchLabels: string[] = [];
    let reconciled = false;

    // Chromium rolls to main should be labeled for backport to every supported
    // release branch whose scheduled Chromium version is >= the rolled version.
    if (rollTarget === ROLL_TARGETS.chromium) {
      try {
        const chromiumMajorVersion = Number(targetVersion.split('.')[0]);
        if (Number.isNaN(chromiumMajorVersion)) {
          throw new Error(`${targetVersion} is not a valid version number`);
        }
        const trackedBranches = await getBranchesTrackedByMain(octokit, chromiumMajorVersion);
        targetBranchLabels = trackedBranches.map((branch) => `target/${branch}`);
        // The PR must never carry both no-backport and target/ labels - trop
        // rejects that as ambiguous. Only transition to the new backport label
        // set once every label conflicting with it is confirmed removed.
        await removeStaleBackportLabels(octokit, prNumber, targetBranchLabels);
        coveredBranches = trackedBranches;
        reconciled = true;
      } catch (e) {
        // Leave the PR's existing backport labels exactly as they were - a
        // half-applied transition could strand conflicting labels on the PR.
        targetBranchLabels = [];
        coveredBranches = [];
        d(`Failed to reconcile backport labels: ${e.message} - leaving existing labels unchanged`);
      }
    }

    if (targetBranchLabels.length > 0) {
      d(`Adding target branch labels: ${targetBranchLabels.join(', ')}`);
      labels.push(...targetBranchLabels);
    } else if (rollTarget !== ROLL_TARGETS.chromium || reconciled || isNewPr) {
      // A reconciled empty set means no release branch qualifies; a brand-new
      // PR has no existing backport labels to preserve, so it can take the
      // fallback even when reconciliation failed.
      labels.push(NO_BACKPORT);
    }
  } else {
    labels.push(BACKPORT_CHECK_SKIP);
  }

  // Chromium bumps & roll bumps to the main branch are always patch bumps.
  if (electronBranch.name === MAIN_BRANCH || rollTarget === ROLL_TARGETS.chromium) {
    labels.push('semver/patch');
    await addLabels(octokit, { prNumber, labels });
    return coveredBranches;
  }

  // Check Node.js rolls against previous version and determine the semver label to add.
  const bumpType = semver.diff(previousVersion, targetVersion);
  if (bumpType === 'patch') {
    labels.push('semver/patch');
    labelToRemove = 'semver/minor';
  } else if (bumpType === 'minor') {
    labels.push('semver/minor');
    labelToRemove = 'semver/patch';
  }

  await removeLabel(octokit, { prNumber, name: labelToRemove });
  await addLabels(octokit, { prNumber, labels });

  return coveredBranches;
}

async function triggerChromiumUpgradeWorkflow(octokit: Octokit) {
  const d = debug('roller/chromium:triggerChromiumUpgradeWorkflow()');
  try {
    await octokit.actions.createWorkflowDispatch(CHROMIUM_UPGRADE_WORKFLOW);
    d(`Dispatched ${CHROMIUM_UPGRADE_WORKFLOW.workflow_id}`);
  } catch (e) {
    d(`Failed to dispatch ${CHROMIUM_UPGRADE_WORKFLOW.workflow_id}: ${e.message}`);
  }
}

// Rolls `rollTarget` on `electronBranch` to `targetVersion`. Returns the names
// of the release branches covered by `target/N-x-y` labels on the roll PR -
// non-empty only for a Chromium roll to the main branch whose PR was
// successfully created or updated and correctly labeled.
export async function roll({
  rollTarget,
  electronBranch,
  targetVersion,
}: RollParams): Promise<string[]> {
  const d = debug(`roller/${rollTarget.name}:roll()`);
  const github = await getOctokit();

  d(
    `roll triggered for electron branch=${electronBranch.name} ${rollTarget.depsKey}=${targetVersion}`,
  );

  let didRoll = false;
  let coveredBranches: string[] = [];

  // Look for a pre-existing PR that targets this branch to see if we can update that.
  const existingPrsForBranch = (await github.paginate('GET /repos/:owner/:repo/pulls', {
    base: electronBranch.name,
    ...REPOS.electron,
    state: 'open',
  })) as PullsListResponseItem[];

  const prs = existingPrsForBranch.filter((pr) =>
    pr.title.startsWith(`chore: bump ${rollTarget.name}`),
  );

  if (prs.length) {
    // The bot only ever rolls into the branch it created itself, which it names
    // `roller/<target>/<electron branch>` in the electron/electron repo. Derive
    // the write target solely from this trusted naming rather than from any
    // field of the (potentially untrusted) PR.
    const rollBranchName = `roller/${rollTarget.name}/${electronBranch.name}`;
    const electronRepoFullName = `${REPOS.electron.owner}/${REPOS.electron.repo}`;

    // Update existing PR(s)
    for (const pr of prs) {
      // Only act on the bot's own roll PR. It must be authored by the roller
      // bot, its head must live in the electron/electron repo itself (not a
      // fork), and it must be named exactly as the bot names its roll branches.
      // Any open PR can match the title prefix - a fork PR's author, head ref,
      // title and body are all attacker-controlled - so none of them may be
      // allowed to select the branch a privileged commit lands on or to receive
      // bot-applied label/title updates.
      if (
        pr.user.login !== ROLLER_BOT_LOGIN ||
        pr.head.repo?.full_name !== electronRepoFullName ||
        pr.head.ref !== rollBranchName
      ) {
        d(
          `Ignoring PR #${pr.number} (@${pr.user.login}, head ${
            pr.head.repo?.full_name ?? '<unknown>'
          }:${pr.head.ref}) - not the bot's roll branch ${electronRepoFullName}:${rollBranchName}`,
        );
        continue;
      }

      d(`Found existing PR: #${pr.number} opened by ${pr.user.login}`);

      // Check to see if automatic DEPS roll has been temporarily disabled
      const hasPauseLabel = pr.labels.some((label) => label.name === 'roller/pause');
      if (hasPauseLabel) {
        d(`Automatic updates have been paused for #${pr.number}, skipping DEPS roll.`);
        continue;
      }

      d(`Attempting DEPS update for #${pr.number}`);
      const { previousDEPSVersion, newDEPSVersion } = await updateDepsFile({
        depName: rollTarget.name,
        depKey: rollTarget.depsKey,
        branch: rollBranchName,
        targetVersion,
      });

      if (previousDEPSVersion === newDEPSVersion) {
        d(`DEPS version unchanged - skipping PR body update`);
        // The release schedule moves independently of Chromium - a newly cut
        // release branch, a schedule edit, or a label call that failed on a
        // previous run must still reconcile the labels on the open roll PR
        // even on a day with no DEPS change.
        if (rollTarget === ROLL_TARGETS.chromium) {
          coveredBranches = await updateLabels(github, {
            rollTarget,
            electronBranch,
            targetVersion,
            previousVersion: previousDEPSVersion,
            prNumber: pr.number,
          });
        }
        continue;
      }

      d(`DEPS version changed - updating PR body`);

      const re = new RegExp('^Original-Version: (\\S+)', 'm');
      const prVersionText = re.exec(pr.body);

      if (!prVersionText || prVersionText.length === 0) {
        d('Could not find PR version text in existing PR - exiting');
        return coveredBranches;
      }

      await github.pulls.update({
        owner: REPOS.electron.owner,
        repo: REPOS.electron.repo,
        pull_number: pr.number,
        ...getPRText(rollTarget, {
          previousVersion: prVersionText[1],
          newVersion: newDEPSVersion,
          branchName: electronBranch.name,
        }),
      });

      coveredBranches = await updateLabels(github, {
        rollTarget,
        electronBranch,
        targetVersion,
        previousVersion: prVersionText[1],
        prNumber: pr.number,
      });

      didRoll = true;
    }
  } else {
    d(`No existing PR found - raising a new PR`);
    const sha = electronBranch.commit.sha;
    const branchName = `roller/${rollTarget.name}/${electronBranch.name}`;
    const shortRef = `heads/${branchName}`;
    const ref = `refs/${shortRef}`;

    d(`Checking that no orphan ref exists from a previous roll`);
    try {
      const maybeOldRef = await github.git.getRef({ ...REPOS.electron, ref: shortRef });
      if (maybeOldRef.status === 200) {
        d(`Found orphan ref ${ref} with no open PR - deleting`);
        await github.git.deleteRef({ ...REPOS.electron, ref: shortRef });
        await new Promise<void>((r) => setTimeout(r, 2000));
      }
    } catch (error) {
      d(`No orphan ref exists at ${ref} - proceeding`);
    }

    d(`Creating ref=${ref} at sha=${sha}`);
    await github.git.createRef({ ...REPOS.electron, ref, sha });

    // Update the ref with the new DEPS version.
    d(`Updating the new ref with version=${targetVersion}`);
    const { previousDEPSVersion } = await updateDepsFile({
      depName: rollTarget.name,
      depKey: rollTarget.depsKey,
      branch: branchName,
      targetVersion,
    });

    // Raise a PR
    d(`Raising a PR for ${branchName} to ${electronBranch.name}`);
    const newPr = await github.pulls.create({
      ...REPOS.electron,
      base: electronBranch.name,
      head: `${REPOS.electron.owner}:${branchName}`,
      ...getPRText(rollTarget, {
        previousVersion: previousDEPSVersion,
        newVersion: targetVersion,
        branchName: electronBranch.name,
      }),
    });

    coveredBranches = await updateLabels(
      github,
      {
        rollTarget,
        electronBranch,
        targetVersion,
        previousVersion: previousDEPSVersion,
        prNumber: newPr.data.number,
      },
      true,
    );

    d(`New PR: ${newPr.data.html_url}`);

    didRoll = true;
  }

  if (didRoll && rollTarget === ROLL_TARGETS.chromium && electronBranch.name === MAIN_BRANCH) {
    await triggerChromiumUpgradeWorkflow(github);
  }

  return coveredBranches;
}
