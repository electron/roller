import debug from 'debug';
import * as semver from 'semver';

import {
  BACKPORT_CHECK_SKIP,
  MAIN_BRANCH,
  NO_BACKPORT,
  REPOS,
  ROLL_TARGETS,
  RollTarget,
} from '../constants';
import { ReposListBranchesResponseItem, PullsListResponseItem } from '../types';
import { getOctokit } from './octokit';
import { getPRText } from './pr-text';
import { updateDepsFile } from './update-deps';
import { Octokit } from '@octokit/rest';
import { addLabels, removeLabel } from './label-utils';

interface RollParams {
  rollTarget: RollTarget;
  electronBranch: ReposListBranchesResponseItem;
  targetVersion: string;
  prNumber?: number;
  previousVersion?: string;
}

async function updateLabels(
  octokit: Octokit,
  { rollTarget, electronBranch, targetVersion, previousVersion, prNumber }: RollParams,
) {
  let labels: string[] = [];
  let labelToRemove: string;

  labels.push(electronBranch.name === MAIN_BRANCH ? NO_BACKPORT : BACKPORT_CHECK_SKIP);

  // Chromium bumps & roll bumps to the main branch are always patch bumps.
  if (electronBranch.name === MAIN_BRANCH || rollTarget === ROLL_TARGETS.chromium) {
    labels.push('semver/patch');
    await addLabels(octokit, { prNumber, labels });
    return;
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
}

export async function roll({
  rollTarget,
  electronBranch,
  targetVersion,
}: RollParams): Promise<void> {
  const d = debug(`roller/${rollTarget.name}:roll()`);
  const github = await getOctokit();

  d(
    `roll triggered for electron branch=${electronBranch.name} ${rollTarget.depsKey}=${targetVersion}`,
  );

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
    // Update existing PR(s)
    for (const pr of prs) {
      if (pr.user.login.startsWith('trop')) continue;
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
        branch: pr.head.ref,
        targetVersion,
      });

      if (previousDEPSVersion === newDEPSVersion) {
        d(`DEPS version unchanged - skipping PR body update`);
        continue;
      }

      d(`DEPS version changed - updating PR body`);

      const re = new RegExp('^Original-Version: (\\S+)', 'm');
      const prVersionText = re.exec(pr.body);

      if (!prVersionText || prVersionText.length === 0) {
        d('Could not find PR version text in existing PR - exiting');
        return;
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

      await updateLabels(github, {
        rollTarget,
        electronBranch,
        targetVersion,
        previousVersion: prVersionText[1],
        prNumber: pr.number,
      });
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

    await updateLabels(github, {
      rollTarget,
      electronBranch,
      targetVersion,
      previousVersion: previousDEPSVersion,
      prNumber: newPr.data.number,
    });

    d(`New PR: ${newPr.data.html_url}`);
  }
}
