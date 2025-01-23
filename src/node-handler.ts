import debug from 'debug';
import * as semver from 'semver';

import { MAIN_BRANCH, REPOS, ROLL_TARGETS } from './constants';
import { getOctokit } from './utils/octokit';
import { roll } from './utils/roll';
import { ReposListBranchesResponseItem } from './types';
import { getSupportedBranches } from './utils/get-supported-branches';
import { getLatestLTSVersion } from './utils/get-nodejs-lts';

export async function handleNodeCheck(target?: string): Promise<void> {
  const d = debug('roller/node:handleNodeCheck()');

  const github = await getOctokit();

  d('Fetching release branches for electron/electron');
  const branches: ReposListBranchesResponseItem[] = await github.paginate(
    github.repos.listBranches.endpoint.merge({
      ...REPOS.electron,
      protected: true,
    }),
  );

  const supported = getSupportedBranches(branches, 3);
  const releaseBranches = branches.filter((branch) => supported.includes(branch.name));
  d(`Found ${releaseBranches.length} release branches`);

  let failed = false;
  if (target) {
    try {
      await rollBranch(target, true);
    } catch (e) {
      d(`Failed to roll ${target}: ${e.message}`);
      failed = true;
    }
  } else {
    // Roll all non-main release branches.
    for (const branch of releaseBranches) {
      try {
        await rollBranch(branch.name, false);
      } catch (e) {
        failed = true;
        continue;
      }
    }

    // Roll the main branch.
    try {
      await rollBranch(MAIN_BRANCH, true);
    } catch (e) {
      failed = true;
    }
  }

  if (failed) {
    throw new Error('One or more upgrade checks failed - see logs for more details');
  }
}

async function rollBranch(branch: string, isMain: boolean): Promise<void> {
  const d = debug(`roller/node:handleNodeBranch():${branch}`);
  const github = await getOctokit();

  d('Fetching nodejs/node releases');
  const { data: releases } = await github.repos.listReleases({
    owner: REPOS.node.owner,
    repo: REPOS.node.repo,
    per_page: 100,
  });
  const releaseTags = releases.map((r) => r.tag_name);

  d(`Fetching ${branch} branch from electron/electron`);
  const { data: targetBranch } = await github.repos.getBranch({
    ...REPOS.electron,
    branch: branch,
  });

  d(`Fetching DEPS for branch ${targetBranch.name} in electron/electron`);
  const { data: depsData } = await github.repos.getContent({
    owner: REPOS.electron.owner,
    repo: REPOS.electron.repo,
    path: 'DEPS',
    ref: branch,
  });

  if (!('content' in depsData)) {
    d(`Error - incorrectly got array when fetching DEPS content for ${branch}`);
    throw new Error(`Upgrade check failed - see logs for more details`);
  }

  const deps = Buffer.from(depsData.content, 'base64').toString('utf8');

  // find node version from DEPS
  const versionRegex = new RegExp(`${ROLL_TARGETS.node.depsKey}':\n +'(.+?)',`, 'm');
  const [, depsNodeVersion] = versionRegex.exec(deps);
  const majorVersion = semver.major(semver.clean(depsNodeVersion));

  d(`Computing latest upstream version for Node ${majorVersion}`);
  let acceptableRange = `^${majorVersion}`;
  if (isMain) {
    // The main branch can roll ahead to the next active LTS.
    const nextLTS = await getLatestLTSVersion();
    if (semver.major(nextLTS) > majorVersion) {
      acceptableRange = `^${majorVersion} || ^${nextLTS}`;
    }
  }
  const latestUpstreamVersion = semver.maxSatisfying(releaseTags, acceptableRange);

  // Only roll for LTS release lines of Node.js (even-numbered major versions).
  if (majorVersion % 2 === 0 && semver.gt(latestUpstreamVersion, depsNodeVersion)) {
    d(
      `Upgrade possible: ${targetBranch.name} can roll from ${depsNodeVersion} to ${latestUpstreamVersion}`,
    );
    try {
      await roll({
        rollTarget: ROLL_TARGETS.node,
        electronBranch: targetBranch,
        targetVersion: latestUpstreamVersion,
      });
    } catch (e) {
      d(`Error rolling ${targetBranch.name} to ${latestUpstreamVersion}`, e);
      throw new Error(`Upgrade check failed - see logs for more details`);
    }
  } else {
    d(`No upgrade found - ${depsNodeVersion} is the most recent known in its release line.`);
  }
}
