import * as debug from 'debug';

import { Commit, REPOS } from './constants';
import { getOctokit } from './utils/octokit';

const d = debug('roller:getExtraCommits()');

export const getExtraCommits = async (electronBranch, libccCommit): Promise<Commit[]> => {
  const github = await getOctokit();
  let currentLibccCommit: string;
  d(`getting extra commits between ${electronBranch}...${libccCommit}`);
  try {
    const currentSubmodule = await github.repos.getContents({
      owner: REPOS.ELECTRON.OWNER,
      repo: REPOS.ELECTRON.NAME,
      path: 'vendor/libchromiumcontent',
      ref: `refs/heads/${electronBranch}`,
    });
    currentLibccCommit = currentSubmodule.data.sha;
  } catch (err) {
    const currentDeps = await github.repos.getContents({
      owner: REPOS.ELECTRON.OWNER,
      repo: REPOS.ELECTRON.NAME,
      path: 'DEPS',
      ref: `refs/heads/${electronBranch}`,
    });
    const deps = Buffer.from(currentDeps.data.content, 'base64').toString('utf8');
    const libccMatch = deps.match(/'libchromiumcontent_revision':\n.+'(.+?)',/gm);
    if (!libccMatch) {
      throw new Error('Failed to find libcc commit on current master');
    }
    currentLibccCommit = libccMatch[1];
  }

  const diff = await github.repos.compareCommits({
    owner: REPOS.LIBCC.OWNER,
    repo: REPOS.LIBCC.NAME,
    base: currentLibccCommit,
    head: libccCommit,
  });

  return diff.data.commits.map((commit) => ({
    sha: commit.sha,
    message: commit.commit.message,
  }));
};
