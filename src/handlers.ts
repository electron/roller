import * as debug from 'debug';

import { REPOS, ROLL_TARGETS } from './constants';
import { getChromiumCommits, getChromiumLkgr, getChromiumTags } from './get-chromium-tags';
import { getExtraCommits } from './get-extra-commits';
import { raisePR } from './pr';
import { rollChromium, rollChromium4 } from './roll-chromium';
import { branchFromRef } from './utils/branch-from-ref';
import { getOctokit } from './utils/octokit';
import { roll } from './utils/roll';

/**
 * Handle a push to `/libcc-hook`.
 *
 * @param {*} _
 * @param {(GitdataCreateReferenceParams & ReposMergeParams)} data
 * @returns {Promise void}
 */
export async function handleLibccPush(
  _,
  data?: { ref: string, after: string },
): Promise<void> {
  const d = debug('roller/chromium:handleLibccPush()');
  if (data && data.ref) {
    d('handling push');
    const { ref } = data;
    const branch = branchFromRef(ref);

    if (branch) {
      d('upgrading chromium in fork');
      const forkBranchName = await rollChromium(branch, data.after);
      if (forkBranchName) {
        d('raising PR');
        await raisePR(forkBranchName, branch, await getExtraCommits(branch, data.after));
        return;
      } else {
        d('libcc upgrade failed, not raising any PRs');
        return;
      }
    } else {
      d(`received ${ref}, could not detect target branch, not doing anything`);
      return;
    }
  }

  d(`received unknown request, not doing anything`);
}

function lexicographical(a: number[], b: number[]) {
  for (const i in a) {
    if (a[i] !== b[i]) {
      return a[i] - b[i];
    }
  }
  return 0;
}
function compareVersions(a: string, b: string): number {
  return lexicographical(a.split('.').map(Number), b.split('.').map(Number));
}

export async function handleChromiumCheck(): Promise<void> {
  const d = debug('roller/chromium:handleChromiumCheck()');
  d('fetching chromium tags');
  const chromiumTags = await getChromiumTags();

  const github = await getOctokit();
  d('getting electron branches');
  const branches = await github.repos.listBranches({
    owner: REPOS.ELECTRON.OWNER,
    repo: REPOS.ELECTRON.NAME,
    protected: true,
  });
  const post4Branches = branches.data
    .filter((branch) => Number(branch.name.split(/-/)[0]) >= 4);

  let thisIsFine = true;

  for (const branch of post4Branches) {
    d(`getting DEPS for ${branch.name}`);
    const depsData = await github.repos.getContents({
      owner: REPOS.ELECTRON.OWNER,
      repo: REPOS.ELECTRON.NAME,
      path: 'DEPS',
      ref: branch.commit.sha,
    });
    const deps = Buffer.from(depsData.data.content, 'base64').toString('utf8');
    const [, chromiumVersion] = /chromium_version':\n +'(.+?)',/m.exec(deps);

    const chromiumMajorVersion = Number(chromiumVersion.split('.')[0]);
    d(`computing latest upstream version for Chromium ${chromiumMajorVersion}`);
    const upstreamVersions = Object.keys(chromiumTags)
      .filter((v) => Number(v.split('.')[0]) === chromiumMajorVersion)
      .sort(compareVersions);
    const latestUpstreamVersion = upstreamVersions[upstreamVersions.length - 1];
    if (compareVersions(latestUpstreamVersion, chromiumVersion) > 0) {
      d(`branch ${branch.name} could upgrade from ${chromiumVersion} to ${latestUpstreamVersion}`);

      try {
        await roll({
          rollTarget: ROLL_TARGETS.CHROMIUM,
          electronBranch: branch,
          newVersion: latestUpstreamVersion,
        });
      } catch (e) {
        d(`Error rolling ${branch.name} to ${latestUpstreamVersion}`, e);
        thisIsFine = false;
      }
    }
  }

  {
    d('getting DEPS for master');
    const masterBranch = branches.data.find((branch) => branch.name === 'master');
    const depsData = await github.repos.getContents({
      owner: REPOS.ELECTRON.OWNER,
      repo: REPOS.ELECTRON.NAME,
      path: 'DEPS',
      ref: masterBranch.commit.sha,
    });
    const deps = Buffer.from(depsData.data.content, 'base64').toString('utf8');
    const [, chromiumHash] = /chromium_version':\n +'(.+?)',/m.exec(deps);
    const lkgr = await getChromiumLkgr();
    if (chromiumHash !== lkgr.commit) {
      d(`updating master from ${chromiumHash} to ${lkgr.commit}`);
      try {
        await roll({
          rollTarget: ROLL_TARGETS.CHROMIUM,
          electronBranch: masterBranch,
          newVersion: lkgr.commit,
        });
      } catch (e) {
        d(`Error rolling ${masterBranch.name} to ${lkgr.commit}`, e);
        thisIsFine = false;
      }
    }
  }

  if (!thisIsFine) {
    throw new Error(`One or more upgrade checks failed; see the logs for details`);
  }
}

export async function handleNodeCheck(): Promise<void> {
  let thisIsFine = true;
  const d = debug('roller/node:handleNodeCheck()');
  const github = await getOctokit();

  d('fetching nodejs/node releases');
  const { data: releases } = await github.repos.listReleases({
    owner: REPOS.NODE.OWNER,
    repo: REPOS.NODE.NAME,
  });
  const releaseTags = releases.map((r) => r.tag_name);

  d('fetching electron/electron branches');
  const { data: branches } = await github.repos.listBranches({
    owner: REPOS.ELECTRON.OWNER,
    repo: REPOS.ELECTRON.NAME,
    protected: true,
  });

  // TODO: Implement node roller rules for release branches
  const masterBranch = branches.find((branch) => branch.name === 'master');

  d(`getting DEPS for branch ${masterBranch} in electron/electron`);
  const depsData = await github.repos.getContents({
    owner:  REPOS.ELECTRON.OWNER,
    repo: REPOS.ELECTRON.NAME,
    path: 'DEPS',
    ref: masterBranch.commit.sha,
  });
  const deps = Buffer.from(depsData.data.content, 'base64').toString('utf8');

  // find node version from DEPS
  const [, depsNodeVersion] = /node_version':\n +'(.+?)',/m.exec(deps);
  const nodeMajorVersion = depsNodeVersion.split('.')[0];

  d(`computing latest upstream version for Node ${nodeMajorVersion}`);
  const upstreamVersions =
    releaseTags.filter((r) => r.split('.')[0] === nodeMajorVersion);
  const latestUpstreamVersion = upstreamVersions[0];

  if (compareVersions(latestUpstreamVersion.substr(1), depsNodeVersion.substr(1)) > 0) {
    d(`branch ${masterBranch.name} could upgrade from ${depsNodeVersion} to ${latestUpstreamVersion}`);
    try {
      await roll({
        rollTarget: ROLL_TARGETS.NODE,
        electronBranch: masterBranch,
        newVersion: latestUpstreamVersion,
      });
    } catch (e) {
      d(`Error rolling ${masterBranch.name} to ${latestUpstreamVersion}`, e);
      thisIsFine = false;
    }
  }

  if (!thisIsFine) {
    throw new Error(`One or more upgrade checks failed; see the logs for details`);
  }
}
