import * as debug from 'debug';

import { getOctokit } from './utils/octokit';
import { FORK_OWNER, FORK_NAME } from './constants';

const d = debug('roller:raisePR()');

export const raisePR = async (forkBranchName: string, targetBranch: string) => {
  d(`triggered for forkBranch=${forkBranchName} and targetBranch=${targetBranch}`);
  const github = await getOctokit();

  d('fetching existing PRs');
  const existingPrsForBranch = await github.pullRequests.getAll({
    per_page: 100,
    base: targetBranch,
    owner: 'electron',
    repo: 'electron',
    state: 'open'
  });

  d('creating new PR');
  const newPr = await github.pullRequests.create({
    owner: 'electron',
    repo: 'electron',
    base: targetBranch,
    head: `${FORK_OWNER}:${forkBranchName}`,
    title: 'chore: bump libcc',
    body: 'Updating libcc reference to latest'
  });
  d(`created new PR with number: #${newPr.data.number}`);

  d('closing old PRs');
  for (const pr of existingPrsForBranch.data) {
    if (pr.user.login !== FORK_OWNER) continue;

    await github.issues.createComment({
      number: pr.number,
      repo: 'electron',
      owner: 'electron',
      body: `Closing PR as it is superceded by #${newPr.data.number}`
    });

    await github.pullRequests.update({
      state: 'closed',
      owner: 'electron',
      repo: 'electron',
      number: pr.number,
    });
  }
}
