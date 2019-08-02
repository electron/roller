import { PullsListResponseItem, ReposListBranchesResponseItem } from '@octokit/rest';
import * as debug from 'debug';

import { PR_USER , REPOS, RollTarget } from '../constants';
import { getOctokit } from './octokit';
import { getPRText } from './pr-text';
import { updateDepsFile } from './update-deps';

interface RollParams {
  rollTarget: RollTarget;
  electronBranch: ReposListBranchesResponseItem;
  targetVersion: string;
}

export async function roll({ rollTarget, electronBranch, targetVersion }: RollParams): Promise<void> {
  const d = debug(`roller/${rollTarget.name}:roll()`);
  const github = await getOctokit();

  d(`roll triggered for electron branch=${electronBranch.name} ${rollTarget.depsKey}=${targetVersion}`);

  // Look for a pre-existing PR that targets this branch to see if we can update that.
  const existingPrsForBranch =
    await github.paginate('GET /repos/:owner/:repo/pulls', {
      base: electronBranch.name,
      ...REPOS.electron,
      state: 'open',
    }) as PullsListResponseItem[];

  const myPrs = existingPrsForBranch
    .filter((pr) => pr.user.login === PR_USER && pr.title.includes(rollTarget.name));

  if (myPrs.length) {
    // Update the existing PR (s?)
    for (const pr of myPrs) {
      d(`found existing PR: #${pr.number}, attempting DEPS update`);
      const daysOld = (+new Date() - +new Date(pr.created_at)) / 1000 / 60 / 60 / 24;
      if (daysOld > 10) {
        d(`PR is ${daysOld} days old, waiting for maintainers to catch up`);
        continue;
      }

      const { previousDEPSVersion, newDEPSVersion } = await updateDepsFile({
        depName: rollTarget.name,
        depKey: rollTarget.depsKey,
        branch: pr.head.ref,
        targetVersion,
      });

      if (previousDEPSVersion === newDEPSVersion) {
        d(`version unchanged, skipping PR body update`);
        continue;
      }

      d(`version changed, updating PR body`);
      // TODO(erickzhao): remove "Original-Chromium-Version" once older PRs are closed
      // and don't forget to change the array destructure a few lines down
      const originalVersionRegex = new RegExp('^Original-Chromium-Version: (\\S+)|^Original-Version: (\\S+)', 'm');
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
    d(`no existing PR found, raising a new PR`);
    // Create a new ref that the PR will point to
    const electronSha = electronBranch.commit.sha;
    const branchName = `roller/${rollTarget.name}/${electronBranch.name}`;
    const newRef = `refs/heads/${branchName}`;

    d(`creating ref=${newRef} at sha=${electronSha}`);

    await github.git.createRef({
      ...REPOS.electron,
      ref: newRef,
      sha: electronSha,
    });

    // Update the ref
    d(`updating the new ref with version=${targetVersion}`);
    const { previousDEPSVersion } = await updateDepsFile({
      depName: rollTarget.name,
      depKey: rollTarget.depsKey,
      branch: branchName,
      targetVersion,
    });

    // Raise a PR
    d(`raising a PR for ${branchName} to ${electronBranch.name}`);
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
    d(`new PR: ${newPr.data.html_url}`);
    // TODO: add comment with commit list to new PR.
  }
}
