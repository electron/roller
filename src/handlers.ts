import * as debug from 'debug';
import * as semver from 'semver';

import { MAIN_BRANCH, NUM_SUPPORTED_VERSIONS, REPOS, ROLL_TARGETS } from './constants';
import { compareChromiumVersions } from './utils/compare-chromium-versions';
import { getChromiumReleases } from './utils/get-chromium-tags';
import { getOctokit } from './utils/octokit';
import { roll } from './utils/roll';

// Get array of currently supported branches
export function getSupportedBranches(branches: { name: string }[]): string[] {
  const releaseBranches = branches
    .filter(branch => {
      const releasePattern = /^(\d)+-(?:(?:[0-9]+-x$)|(?:x+-y$))$/;
      return releasePattern.test(branch.name);
    })
    .map(b => b.name);

  const filtered: Record<string, string> = {};
  releaseBranches
    .sort((a, b) => {
      const aParts = a.split('-');
      const bParts = b.split('-');
      for (let i = 0; i < aParts.length; i += 1) {
        if (aParts[i] === bParts[i]) continue;
        return parseInt(aParts[i], 10) - parseInt(bParts[i], 10);
      }
      return 0;
    })
    .forEach(branch => {
      return (filtered[branch.split('-')[0]] = branch);
    });

  const values = Object.values(filtered);
  return values.sort((a, b) => parseInt(a, 10) - parseInt(b, 10)).slice(-NUM_SUPPORTED_VERSIONS);
}

export async function handleChromiumCheck(): Promise<void> {
  const d = debug('roller/chromium:handleChromiumCheck()');
  d('Fetching Chromium releases');
  const chromiumReleases = await getChromiumReleases();

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

  // Roll all non-main release branches.
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

    // We should be able to parse major version as a number.
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
    const upstreamVersions = chromiumReleases
      .filter(
        r =>
          /^win|win64|mac|linux$/.test(r.os) &&
          r.channel !== 'canary_asan' &&
          Number(r.version.split('.')[0]) === chromiumMajorVersion,
      )
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
      .map(r => r.version);
    const latestUpstreamVersion = upstreamVersions[upstreamVersions.length - 1];
    if (
      latestUpstreamVersion &&
      compareChromiumVersions(latestUpstreamVersion, chromiumVersion) > 0
    ) {
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
    } else {
      d(`No upgrade found, ${chromiumVersion} is the most recent known in its release line.`);
    }
  }

  const mainBranch = branches.find(branch => branch.name === MAIN_BRANCH);

  d(`Fetching DEPS for ${MAIN_BRANCH}`);
  const { data: depsData } = await github.repos.getContents({
    owner: REPOS.electron.owner,
    repo: REPOS.electron.repo,
    path: 'DEPS',
    ref: MAIN_BRANCH,
  });
  const deps = Buffer.from(depsData.content, 'base64').toString('utf8');
  const versionRegex = new RegExp(`${ROLL_TARGETS.chromium.depsKey}':\n +'(.+?)',`, 'm');
  const [, currentVersion] = versionRegex.exec(deps);

  // We should be able to parse major version as a number.
  const chromiumMajorVersion = Number(currentVersion.split('.')[0]);
  if (Number.isNaN(chromiumMajorVersion)) {
    d(`${MAIN_BRANCH} roll failed: ${currentVersion} is not a valid version number`);
    thisIsFine = false;
  }

  const upstreamVersions = chromiumReleases
    .filter(r => /^win|win64|mac|linux$/.test(r.os) && r.channel === 'canary')
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    .map(r => r.version);
  const latestUpstreamVersion = upstreamVersions[upstreamVersions.length - 1];

  if (latestUpstreamVersion && currentVersion !== latestUpstreamVersion) {
    d(`Updating ${MAIN_BRANCH} from ${currentVersion} to ${latestUpstreamVersion}`);
    try {
      await roll({
        rollTarget: ROLL_TARGETS.chromium,
        electronBranch: mainBranch,
        targetVersion: latestUpstreamVersion,
      });
    } catch (e) {
      d(`Error rolling ${mainBranch.name} to ${latestUpstreamVersion}`, e);
      thisIsFine = false;
    }
  }

  if (!thisIsFine) {
    throw new Error('One or more upgrade checks failed - see logs for more details');
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

  d(`Fetching ${MAIN_BRANCH} branch from electron/electron`);
  const { data: mainBranch } = await github.repos.getBranch({
    ...REPOS.electron,
    branch: MAIN_BRANCH,
  });

  d(`Fetching DEPS for branch ${mainBranch.name} in electron/electron`);
  const { data: depsData } = await github.repos.getContents({
    owner: REPOS.electron.owner,
    repo: REPOS.electron.repo,
    path: 'DEPS',
    ref: MAIN_BRANCH,
  });

  const deps = Buffer.from(depsData.content, 'base64').toString('utf8');

  // find node version from DEPS
  const versionRegex = new RegExp(`${ROLL_TARGETS.node.depsKey}':\n +'(.+?)',`, 'm');
  const [, depsNodeVersion] = versionRegex.exec(deps);
  const majorVersion = semver.major(semver.clean(depsNodeVersion));

  d(`Computing latest upstream version for Node ${majorVersion}`);
  const latestUpstreamVersion = semver.maxSatisfying(releaseTags, `^${majorVersion}`);

  // Only roll for LTS release lines of Node.js (even-numbered major versions).
  if (majorVersion % 2 === 0 && semver.gt(latestUpstreamVersion, depsNodeVersion)) {
    d(
      `Upgrade possible: ${mainBranch.name} can roll from ${depsNodeVersion} to ${latestUpstreamVersion}`,
    );
    try {
      await roll({
        rollTarget: ROLL_TARGETS.node,
        electronBranch: mainBranch,
        targetVersion: latestUpstreamVersion,
      });
    } catch (e) {
      d(`Error rolling ${mainBranch.name} to ${latestUpstreamVersion}`, e);
      throw new Error(`Upgrade check failed - see logs for more details`);
    }
  } else {
    d(`No upgrade found - ${depsNodeVersion} is the most recent known in its release line.`);
  }
}
