import { PullsListResponseItem } from '@octokit/rest';
import * as debug from 'debug';

import { PR_USER, REPOS } from './constants';
import { getOctokit } from './utils/octokit';
import { updateDepsFile as updateDepsFile4 } from './utils/update-deps';

const d = debug('roller/chromium:rollChromium()');

// TODO: Remove once Electron 3 is EOL
const updateDepsFile = async (forkRef: string, libccRef: string) => {
  d(`updating deps file for: ${forkRef}`);
  const github = await getOctokit();
  let existing;

  try {
    existing = await github.repos.getContents({
      owner: REPOS.ELECTRON.OWNER,
      repo: REPOS.ELECTRON.NAME,
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

  await github.repos.updateFile({
    owner: REPOS.ELECTRON.OWNER,
    repo: REPOS.ELECTRON.NAME,
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
    owner: REPOS.ELECTRON.OWNER,
    repo: REPOS.ELECTRON.NAME,
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
    owner: REPOS.ELECTRON.OWNER,
    repo: REPOS.ELECTRON.NAME,
    message: `chore: bump libcc submodule to ${libccRef}`,
    tree: tree.data.sha,
    parents: [electronSha],
  });

  await github.git.updateRef({
    owner: REPOS.ELECTRON.OWNER,
    repo: REPOS.ELECTRON.NAME,
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
    owner: REPOS.ELECTRON.OWNER,
    repo: REPOS.ELECTRON.NAME,
    ref: `heads/${electronBranch}`,
  });
  const electronSha = electronReference.data.object.sha;
  const forkRef = `refs/heads/roller/libcc-${libccRef}-${Date.now()}`;

  // Create new reference in electron-bot/electron for that SHA
  try {
    await github.git.createRef({
      owner: REPOS.ELECTRON.OWNER,
      repo: REPOS.ELECTRON.NAME,
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
