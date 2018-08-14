import * as debug from 'debug';

import { getOctokit } from './utils/octokit';
import { Commit } from './constants';

const d = debug('roller:getExtraCommits()');

export const getExtraCommits = async (electronBranch, libccCommit): Promise<Commit[]> => {
  const github = await getOctokit();
  let currentLibccCommit: string;
  d(`getting extra commits between ${electronBranch}...${libccCommit}`);
  try {
    const currentSubmodule = await github.repos.getContent({
      owner: 'electron',
      repo: 'electron',
      path: 'vendor/libchromiumcontent',
      ref: `refs/heads/${electronBranch}`,
    });
    currentLibccCommit = currentSubmodule.data.sha;
  } catch (err) {
    const currentDeps = await github.repos.getContent({
      owner: 'electron',
      repo: 'electron',
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
    owner: 'electron',
    repo: 'libchromiumcontent',
    base: currentLibccCommit,
    head: libccCommit,
  });

  return diff.data.commits.map((commit) => ({
    sha: commit.sha,
    message: commit.commit.message,
  }));
};
