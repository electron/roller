import { getOctokit } from './utils/octokit';
import { FORK_OWNER, FORK_NAME } from './constants';

export const raisePR = async (forkBranchName: string, targetBranch: string) => {
  const github = await getOctokit();

  const existingPrsForBranch = await github.pullRequests.getAll({
    per_page: 100,
    base: targetBranch,
    owner: 'electron',
    repo: 'electron',
    state: 'open'
  });

  const newPr = await github.pullRequests.create({
    owner: 'electron',
    repo: 'electron',
    base: targetBranch,
    head: `${FORK_OWNER}:${forkBranchName}`,
    title: 'chore: bump libcc',
    body: 'Updating libcc reference to latest'
  });

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
