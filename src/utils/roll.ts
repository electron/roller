import { PullsListResponseItem, ReposListBranchesResponseItem } from '@octokit/rest';
import * as debug from 'debug';

import { PR_USER, REPOS, RollTarget } from '../constants';
import { getOctokit } from './octokit';
import { getPRText } from './pr-text';
import { updateDepsFile } from './update-deps';

interface RollParams {
  rollTarget: RollTarget;
  electronBranch: ReposListBranchesResponseItem;
  targetVersion: string;
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

  const myPrs = existingPrsForBranch.filter(
    pr => pr.user.login === PR_USER && pr.title.includes(rollTarget.name),
  );

  if (myPrs.length) {
    // Update existing PR(s)
    for (const pr of myPrs) {
      d(`Found existing PR: #${pr.number}`);

      // Check to see if automatic DEPS roll has been temporarily disabled
      const hasPauseLabel = pr.labels.some(label => label.name === 'roller/pause');
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
      // TODO(erickzhao): remove "Original-Chromium-Version" once older PRs are closed
      // and don't forget to change the array destructure a few lines down
      const originalVersionRegex = new RegExp(
        '^Original-Chromium-Version: (\\S+)|^Original-Version: (\\S+)',
        'm',
      );
      const captured = originalVersionRegex.exec(pr.body);
      const [, previousPRVersionOldText, previousPRVersionNewText] = captured;

      await github.pulls.update({
        owner: REPOS.electron.owner,
        repo: REPOS.electron.repo,
        pull_number: pr.number,
        ...getPRText(rollTarget, {
          previousVersion: previousPRVersionOldText || previousPRVersionNewText,
          newVersion: newDEPSVersion,
          branchName: electronBranch.name,
        }),
      });
    }
  } else {
    d(`No existing PR found - raising a new PR`);
    const electronSha = electronBranch.commit.sha;
    const branchName = `roller/${rollTarget.name}/${electronBranch.name}`;
    const newRef = `refs/heads/${branchName}`;

    // Create a new ref that the PR will point to
    d(`Creating ref=${newRef} at sha=${electronSha}`);
    await github.git.createRef({
      ...REPOS.electron,
      ref: newRef,
      sha: electronSha,
    });

    // Update the ref
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
    d(`New PR: ${newPr.data.html_url}`);
    // TODO: add comment with commit list to new PR.
  }
}
