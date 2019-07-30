import * as debug from 'debug';

import { Commit, PR_USER, REPOS } from './constants';
import { getOctokit } from './utils/octokit';

const d = debug('roller/chromium:raisePR()');

const COMMIT_URL_BASE = 'https://github.com/electron/libchromiumcontent/commit/';
const ISSUE_URL_BASE = 'https://github.com/electron/libchromiumcontent/issues/';

const cleanUpBranch = async (branchName: string) => {
  d('being told to clean up branch:', branchName);
  // Safety check to ensure we do not delete any branches that are not roller PRs
  if (!branchName.startsWith('roller/')) return;
  d('actually cleaning branch:', branchName);

  const github = await getOctokit();

  await github.git.deleteRef({
    ...REPOS.electron,
    ref: `heads/${branchName}`,
  });
};

// TODO: Remove once Electron 3 is EOL
export const raisePR = async (forkBranchName: string, targetBranch: string, extraCommits: Commit[]) => {
  d(`triggered for forkBranch=${forkBranchName} and targetBranch=${targetBranch}`);
  const github = await getOctokit();

  d('fetching existing PRs');
  const existingPrsForBranch = await github.pulls.list({
    per_page: 100,
    base: targetBranch,
    owner: 'electron',
    repo: 'electron',
    state: 'open',
  });

  d('creating new PR');
  const prTitle = `chore: bump libcc (${targetBranch})`;
  const newPr = await github.pulls.create({
    owner: 'electron',
    repo: 'electron',
    base: targetBranch,
    head: `${REPOS.electron.owner}:${forkBranchName}`,
    title: prTitle,
    body: `Updating libcc reference to latest.  Changes since the last roll:

${extraCommits.map((commit) => {
      const sha = `[\`${commit.sha.substr(0, 8)}\`](${COMMIT_URL_BASE}${commit.sha})`;
      const msg = commit.message.replace(/(^|[\s\(\[])#(\d+)($|[\s\)\]])/g, `$1${ISSUE_URL_BASE}$2$3`);
      return `* ${sha} ${msg}`;
    }).join('\n')}

Notes: no-notes`,
  });
  d(`created new PR with number: #${newPr.data.number}`);

  d('closing old PRs');
  for (const pr of existingPrsForBranch.data) {
    if (pr.user.login !== PR_USER) continue;
    // Handle other electron-bot PRs being open
    if (pr.title !== prTitle) continue;

    await github.issues.createComment({
      issue_number: pr.number,
      repo: 'electron',
      owner: 'electron',
      body: `Closing PR as it is superceded by #${newPr.data.number}`,
    });

    await github.pulls.update({
      state: 'closed',
      owner: 'electron',
      repo: 'electron',
      pull_number: pr.number,
    });

    await cleanUpBranch(pr.head.ref);
  }
};
