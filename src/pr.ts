import * as debug from 'debug';

import { getOctokit } from './utils/octokit';
import { FORK_OWNER, Commit } from './constants';

const d = debug('roller:raisePR()');

export const raisePR = async (
  forkBranchName: string,
  targetBranch: string,
  extraCommits: Commit[],
) => {
  d(`triggered for forkBranch=${forkBranchName} and targetBranch=${targetBranch}`);
  const github = await getOctokit();

  d('fetching existing PRs');
  const existingPrsForBranch = await github.pullRequests.getAll({
    per_page: 100,
    base: targetBranch,
    owner: 'electron',
    repo: 'electron',
    state: 'open',
  });

  d('creating new PR');
  const newPr = await github.pullRequests.create({
    owner: 'electron',
    repo: 'electron',
    base: targetBranch,
    head: `${FORK_OWNER}:${forkBranchName}`,
    title: `chore: bump libcc (${targetBranch})`,
    body: `Updating libcc reference to latest.  Changes since the last roll:

${extraCommits.map(commit => `* [\`${commit.sha.substr(0, 8)}\`](https://github.com/electron/libchromiumcontent/commit/${commit.sha}) ${commit.message}`).join('\n')}`,
  });
  d(`created new PR with number: #${newPr.data.number}`);

  d('closing old PRs');
  for (const pr of existingPrsForBranch.data) {
    if (pr.user.login !== FORK_OWNER) continue;

    await github.issues.createComment({
      number: pr.number,
      repo: 'electron',
      owner: 'electron',
      body: `Closing PR as it is superceded by #${newPr.data.number}`,
    });

    await github.pullRequests.update({
      state: 'closed',
      owner: 'electron',
      repo: 'electron',
      number: pr.number,
    });
  }
};
