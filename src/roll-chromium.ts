import * as Github from '@octokit/rest';
import * as debug from 'debug';

import { PR_USER, REPO_NAME, REPO_OWNER } from './constants';
import { getOctokit } from './utils/octokit';

const d = debug('roller:rollChromium()');

const updateDepsFile4 = async (branch: string, chromiumVersion: string) => {
  d(`updating deps file for: ${branch}`);
  const github = await getOctokit();

  const existing = await github.repos.getContents({
    owner: REPO_NAME,
    repo: REPO_OWNER,
    path: 'DEPS',
    ref: branch,
  });
  const content = Buffer.from(existing.data.content, 'base64').toString('utf8');
  const [, previousVersion] = /chromium_version':\n +'(.+?)',/m.exec(content);

  if (chromiumVersion !== previousVersion) {
    const newContent = content.replace(
      /(chromium_version':\n +').+?',/gm,
      `$1${chromiumVersion}',`,
    );
    await github.repos.updateFile({
      owner: REPO_OWNER,
      repo: REPO_NAME,
      path: 'DEPS',
      content: Buffer.from(newContent).toString('base64'),
      message: `chore: bump chromium in DEPS to ${chromiumVersion}`,
      sha: existing.data.sha,
      branch,
    });
  }
  return previousVersion;
};

// TODO: Remove once Electron 3 is EOL
const updateDepsFile = async (forkRef: string, libccRef: string) => {
  d(`updating deps file for: ${forkRef}`);
  const github = await getOctokit();
  let existing;

  try {
    existing = await github.repos.getContents({
      owner: REPO_OWNER,
      repo: REPO_NAME,
      path: 'DEPS',
      ref: forkRef,
    });
  } catch (error) {
    if (error.code === 404) return true;
    d('deps update error', error);
    return false;
  }

  const content = Buffer.from(existing.data.content, 'base64').toString('utf8');
  const newContent = content.replace(
    /(libchromiumcontent_revision':\n +').+?',/gm,
    `$1${libccRef}',`,
  );

  const commit = await github.repos.updateFile({
    owner: REPO_OWNER,
    repo: REPO_NAME,
    path: 'DEPS',
    content: Buffer.from(newContent).toString('base64'),
    message: `chore: bump libcc in DEPS to ${libccRef}`,
    sha: existing.data.sha,
    branch: forkRef.substr(11),
  });

  return true;
};

const updateGitSubmodule = async (forkRef: string, electronSha: string, libccRef: string) => {
  d(`updating git submodule for: ${forkRef}`);
  const github = await getOctokit();

  const tree = await github.git.createTree({
    owner: REPO_OWNER,
    repo: REPO_NAME,
    base_tree: electronSha,
    tree: [
      {
        path: 'vendor/libchromiumcontent',
        mode: '160000',
        type: 'commit',
        sha: libccRef,
      },
    ],
  });

  const commit = await github.git.createCommit({
    owner: REPO_OWNER,
    repo: REPO_NAME,
    message: `chore: bump libcc submodule to ${libccRef}`,
    tree: tree.data.sha,
    parents: [electronSha],
  });

  await github.git.updateRef({
    owner: REPO_OWNER,
    repo: REPO_NAME,
    ref: forkRef.substr(5),
    sha: commit.data.sha,
  });
};

/**
 * Roll Chromium 🎢
 *
 * @param {string} electronBranch
 * @param {string} libccRef
 * @returns {Promise<boolean>}
 */
export async function rollChromium(
  electronBranch: string, libccRef: string,
): Promise<string | null> {
  d(`triggered for electronBranch=${electronBranch} libccRef=${libccRef}`);
  const github = await getOctokit();
  // Get current SHA of {electronBranch} on electron/electron
  const electronReference = await github.git.getRef({
    owner: 'electron',
    repo: 'electron',
    ref: `heads/${electronBranch}`,
  });
  const electronSha = electronReference.data.object.sha;
  const forkRef = `refs/heads/roller/libcc-${libccRef}-${Date.now()}`;

  // Create new reference in electron-bot/electron for that SHA
  try {
    await github.git.createRef({
      owner: REPO_OWNER,
      repo: REPO_NAME,
      ref: forkRef,
      sha: electronSha,
    });

    await updateGitSubmodule(forkRef, electronSha, libccRef);
    await updateDepsFile(forkRef, libccRef);
  } catch (error) {
    d(`failed`, error);
    return null;
  }

  return forkRef.substr(11);
}

function prText(previousChromiumVersion: string, chromiumVersion: string, branchName: string) {
  const isLKGR = !chromiumVersion.includes('.');
  const shortVersion = isLKGR ? chromiumVersion.substr(11) : chromiumVersion;
  const shortPreviousVersion = isLKGR ? previousChromiumVersion.substr(11) : previousChromiumVersion;
  const diffLink = `https://chromium.googlesource.com/chromium/src/+log/` +
                   `${previousChromiumVersion}..${chromiumVersion}?n=10000&pretty=fuller`;
  return {
    title: `chore: bump chromium to ${shortVersion} (${branchName})`,
    body: `Updating Chromium to ${shortVersion}${isLKGR ? ' (lkgr)' : ''}.

See [all changes in ${shortPreviousVersion}..${shortVersion}](${diffLink})

<!--
Original-Chromium-Version: ${previousChromiumVersion}
-->

Notes: ${isLKGR ? 'no-notes' : `Updated Chromium to ${chromiumVersion}.`}`,
  };
}

export async function rollChromium4(
  electronBranch: {name: string, commit: {sha: string}},
  chromiumVersion: string,
): Promise<void> {
  d(`roll triggered triggered for electronBranch=${electronBranch.name} chromiumVersion=${chromiumVersion}`);
  const github = await getOctokit();

  // Look for a pre-existing PR that targets this branch to see if we can update that.
  const existingPrsForBranch = await github.pulls.list({
    per_page: 100, // TODO: paginate
    base: electronBranch.name,
    owner: 'electron',
    repo: 'electron',
    state: 'open',
  });
  const myPrs = existingPrsForBranch.data.filter((pr) => pr.user.login === PR_USER);

  if (myPrs.length) {
    // Update the existing PR (s?)
    for (const pr of myPrs) {
      d(`found existing PR: #${pr.number}, updating`);
      const previousVersion = await updateDepsFile4(pr.head.ref, chromiumVersion);
      if (previousVersion === chromiumVersion) {
        d(`version unchanged, skipping PR body update`);
        continue;
      }
      d(`version changed, updating PR body`);
      const m = /^Original-Chromium-Version: (\S+)/m.exec(pr.body);
      const previousChromiumVersion = m ? m[1] : /chromium\/src\/\+\/(.+?)\.\./.exec(pr.body)[1];
      await github.pulls.update({
        owner: 'electron',
        repo: 'electron',
        pull_number: pr.number,
        ...prText(previousChromiumVersion, chromiumVersion, electronBranch.name),
      });
    }
  } else {
    d(`no existing PR found, raising a new PR`);
    // Create a new ref that the PR will point to
    const electronSha = electronBranch.commit.sha;
    const branchName = `roller/chromium/${electronBranch.name}`;
    const newRef = `refs/heads/${branchName}`;

    d(`creating ref=${newRef} at sha=${electronSha}`);

    await github.git.createRef({
      owner: REPO_OWNER,
      repo: REPO_NAME,
      ref: newRef,
      sha: electronSha,
    });

    // Update the ref
    d(`updating the new ref with chromiumVersion=${chromiumVersion}`);
    const previousChromiumVersion = await updateDepsFile4(branchName, chromiumVersion);

    // Raise a PR
    d(`raising a PR for ${branchName} to ${electronBranch.name}`);
    const newPr = await github.pulls.create({
      owner: 'electron',
      repo: 'electron',
      base: electronBranch.name,
      head: `${REPO_OWNER}:${branchName}`,
      ...prText(previousChromiumVersion, chromiumVersion, electronBranch.name),
    });
    d(`new PR: ${newPr.data.html_url}`);
    // TODO: add comment with commit list to new PR.
  }
}
