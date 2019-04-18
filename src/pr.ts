import * as debug from 'debug';

import { Commit, PR_USER, REPO_NAME, REPO_OWNER } from './constants';
import { ChromiumCommit } from './get-chromium-tags';
import { getOctokit } from './utils/octokit';

const d = debug('roller:raisePR()');

const COMMIT_URL_BASE = 'https://github.com/electron/libchromiumcontent/commit/';
const ISSUE_URL_BASE = 'https://github.com/electron/libchromiumcontent/issues/';

const cleanUpRef = async (ref: string) => {
  d('being told to clean up ref:', ref);
  // Safety check to ensure we do not delete any branches that are not roller PRs
  if (!ref.startsWith('roller/')) return;
  d('actually cleaning ref:', ref);

  const github = await getOctokit();

  await github.git.deleteRef({
    owner: REPO_OWNER,
    repo: REPO_NAME,
    ref,
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
    head: `${REPO_OWNER}:${forkBranchName}`,
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
      number: pr.number,
      repo: 'electron',
      owner: 'electron',
      body: `Closing PR as it is superceded by #${newPr.data.number}`,
    });

    await github.pulls.update({
      state: 'closed',
      owner: 'electron',
      repo: 'electron',
      number: pr.number,
    });

    await cleanUpRef(pr.head.sha);
  }
};

export const raisePR4 = async (
  forkBranchName: string,
  targetBranch: string,
  extraCommits: {log: ChromiumCommit[], next?: string},
  previousChromiumVersion: string,
  chromiumVersion: string,
  isLKGR: boolean,
) => {
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

  const prTitleVersion = isLKGR ? chromiumVersion.slice(0, 12) : chromiumVersion;

  for (const pr of existingPrsForBranch.data) {
    if (pr.user.login !== PR_USER) continue;

    if (pr.title.includes(prTitleVersion)) {
      d(`Found pr #${pr.number} already open for ${prTitleVersion}, won't open a new one`);
      return;
    }
  }

  function commitLink(commit: ChromiumCommit): string {
    return `[\`${commit.commit.slice(0, 7)}\`](https://chromium.googlesource.com/chromium/src/+/${commit.commit}^!)`;
  }
  const diffLink = `https://chromium.googlesource.com/chromium/src/+/${previousChromiumVersion}..${chromiumVersion}`;
  const logLink = `https://chromium.googlesource.com/chromium/src/+log/${previousChromiumVersion}..${chromiumVersion}`;

  d('creating new PR');
  const newPr = await github.pulls.create({
    owner: 'electron',
    repo: 'electron',
    base: targetBranch,
    head: `${REPO_NAME}:${forkBranchName}`,
    maintainer_can_modify: true,
    title: `chore: bump chromium to ${prTitleVersion} (${targetBranch})`,
    body: `Updating Chromium to ${chromiumVersion} (lkgr).

See [all changes in ${previousChromiumVersion}..${chromiumVersion}](${diffLink})

Notes: ${isLKGR ? 'no-notes' : `Updated Chromium to ${chromiumVersion}.`}`,
  });
  d(`created new PR with number: #${newPr.data.number}`);
  d(`adding change list comment to PR`);
  await github.issues.createComment({
    number: newPr.data.number,
    repo: 'electron',
    owner: 'electron',
    body: `Changes since the last roll:

${extraCommits.log.map((commit) => `* ${commitLink(commit)} ${commit.message.split(/\n/)[0]}`).join('\n')}` +
    (extraCommits.next ? `

[More commits &raquo;](${logLink})` : ''),
  });

  d('closing old PRs');
  for (const pr of existingPrsForBranch.data) {
    if (pr.user.login !== PR_USER) continue;
    // Handle other electron-bot PRs being open
    if (!pr.title.startsWith('chore: bump chromium to ')) continue;

    await github.issues.createComment({
      number: pr.number,
      repo: 'electron',
      owner: 'electron',
      body: `Closing PR as it is superceded by #${newPr.data.number}`,
    });

    await github.pulls.update({
      state: 'closed',
      owner: 'electron',
      repo: 'electron',
      number: pr.number,
    });

    await cleanUpRef(pr.head.sha);
  }
};
