import * as debug from 'debug';
import * as semver from 'semver';

import { NUM_SUPPORTED_VERSIONS, REPOS, ROLL_TARGETS } from './constants';
import { compareChromiumVersions } from './utils/compare-chromium-versions';
import { getChromiumLkgr, getChromiumTags } from './utils/get-chromium-tags';
import { getOctokit } from './utils/octokit';
import { roll } from './utils/roll';

// Get array of currently supported branches
export function getSupportedBranches(branches: { name: string }[]): string[] {
  const releaseBranches = branches
    .filter(branch => {
      const releasePattern = /^[0-9]+-([0-9]+-x|x-y)$/;
      return releasePattern.test(branch.name);
    })
    .map(b => b.name);

  const filtered: Record<string, string> = {};
  releaseBranches.sort().forEach((branch: string) => {
    return (filtered[branch.split('-')[0]] = branch);
  });

  const values = Object.values(filtered);
  return values.sort().slice(-NUM_SUPPORTED_VERSIONS);
}

export async function handleChromiumCheck(): Promise<void> {
  const d = debug('roller/chromium:handleChromiumCheck()');
  d('Fetching Chromium tags');
  const chromiumTags = await getChromiumTags();

  const github = await getOctokit();
  d('Fetching release branches for electron/electron');
  const { data: branches } = await github.repos.listBranches({
    ...REPOS.electron,
    protected: true,
  });

  const supported = getSupportedBranches(branches);
  const releaseBranches = branches.filter(branch => supported.includes(branch.name));
  d(`Found ${releaseBranches.length} release branches`);

  let thisIsFine = true;

  // Roll all non-master release branches
  for (const branch of releaseBranches) {
    d(`Fetching DEPS for ${branch.name}`);
    const { data: depsData } = await github.repos.getContents({
      ...REPOS.electron,
      path: 'DEPS',
      ref: branch.commit.sha,
    });

    const deps = Buffer.from(depsData.content, 'base64').toString('utf8');
    const versionRegex = new RegExp(`${ROLL_TARGETS.chromium.depsKey}':\n +'(.+?)',`, 'm');
    const [, chromiumVersion] = versionRegex.exec(deps);

    const chromiumMajorVersion = Number(chromiumVersion.split('.')[0]);

    // We should be able to parse major version as a number
    if (Number.isNaN(chromiumMajorVersion)) {
      const SHAPattern = /\b[0-9a-f]{5,40}\b/;
      // On newer release branches we may not yet have updated the branch to use tags
      if (`${chromiumMajorVersion}`.match(SHAPattern)) {
        d(`${branch.name} roll failed: ${chromiumMajorVersion} should be a tag.`);
      } else {
        d(`${branch.name} roll failed: ${chromiumVersion} is not a valid version number`);
      }
      thisIsFine = false;
      continue;
    }

    d(`Computing latest upstream version for Chromium ${chromiumMajorVersion}`);
    const upstreamVersions = Object.keys(chromiumTags)
      .filter(v => Number(v.split('.')[0]) === chromiumMajorVersion)
      // NB. Chromium rolled a 3905 branch on m78 but abandoned it and continued with 3904.
      .filter(v => !v.startsWith('78.0.3905.'))
      .sort(compareChromiumVersions);
    const latestUpstreamVersion = upstreamVersions[upstreamVersions.length - 1];
    if (compareChromiumVersions(latestUpstreamVersion, chromiumVersion) > 0) {
      d(
        `Upgrade possible: ${branch.name} can roll from ${chromiumVersion} to ${latestUpstreamVersion}`,
      );
      try {
        await roll({
          rollTarget: ROLL_TARGETS.chromium,
          electronBranch: branch,
          targetVersion: latestUpstreamVersion,
        });
      } catch (e) {
        d(`Error rolling ${branch.name} to ${latestUpstreamVersion}: `, e);
        thisIsFine = false;
      }
    }
  }

  {
    d('Fetching DEPS for master');
    const masterBranch = branches.find(branch => branch.name === 'master');
    if (!!masterBranch) {
      const { data: depsData } = await github.repos.getContents({
        owner: REPOS.electron.owner,
        repo: REPOS.electron.repo,
        path: 'DEPS',
        ref: 'master',
      });
      const deps = Buffer.from(depsData.content, 'base64').toString('utf8');
      const hashRegex = new RegExp(`${ROLL_TARGETS.chromium.depsKey}':\n +'(.+?)',`, 'm');
      const [, chromiumHash] = hashRegex.exec(deps);
      const lkgr = await getChromiumLkgr();
      if (chromiumHash !== lkgr.commit) {
        d(`Updating master from ${chromiumHash} to ${lkgr.commit}`);
        try {
          await roll({
            rollTarget: ROLL_TARGETS.chromium,
            electronBranch: masterBranch,
            targetVersion: lkgr.commit,
          });
        } catch (e) {
          d(`Error rolling ${masterBranch.name} to ${lkgr.commit}`, e);
          thisIsFine = false;
        }
      }
    } else {
      d('master branch not found!');
    }
  }

  if (!thisIsFine) {
    throw new Error(`One or more upgrade checks failed - see logs for more details`);
  }
}

export async function handleNodeCheck(): Promise<void> {
  const d = debug('roller/node:handleNodeCheck()');
  const github = await getOctokit();

  d('Fetching nodejs/node releases');
  const { data: releases } = await github.repos.listReleases({
    owner: REPOS.node.owner,
    repo: REPOS.node.repo,
  });
  const releaseTags = releases.map(r => r.tag_name);

  d('Fetching master branch from electron/electron');
  const { data: masterBranch } = await github.repos.getBranch({
    ...REPOS.electron,
    branch: 'master',
  });

  d(`Fetching DEPS for branch ${masterBranch.name} in electron/electron`);
  const { data: depsData } = await github.repos.getContents({
    owner: REPOS.electron.owner,
    repo: REPOS.electron.repo,
    path: 'DEPS',
    ref: 'master',
  });

  const deps = Buffer.from(depsData.content, 'base64').toString('utf8');

  // find node version from DEPS
  const versionRegex = new RegExp(`${ROLL_TARGETS.node.depsKey}':\n +'(.+?)',`, 'm');
  const [, depsNodeVersion] = versionRegex.exec(deps);
  const majorVersion = semver.major(semver.clean(depsNodeVersion));

  d(`Computing latest upstream version for Node ${majorVersion}`);
  const latestUpstreamVersion = semver.maxSatisfying(releaseTags, `^${majorVersion}`);

  // only roll for LTS release lines of Node.js (even-numbered major versions)
  if (majorVersion % 2 === 0 && semver.gt(latestUpstreamVersion, depsNodeVersion)) {
    d(
      `Upgrade possible: ${masterBranch.name} can roll from ${depsNodeVersion} to ${latestUpstreamVersion}`,
    );
    try {
      await roll({
        rollTarget: ROLL_TARGETS.node,
        electronBranch: masterBranch,
        targetVersion: latestUpstreamVersion,
      });
    } catch (e) {
      d(`Error rolling ${masterBranch.name} to ${latestUpstreamVersion}`, e);
      throw new Error(`Upgrade check failed - see logs for more details`);
    }
  }
}
