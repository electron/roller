import * as debug from 'debug';
import * as semver from 'semver';

import { MAIN_BRANCH, REPOS, ROLL_TARGETS } from './constants';
import { getOctokit } from './utils/octokit';
import { roll } from './utils/roll';

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
  const { data: depsData } = await github.repos.getContent({
    owner: REPOS.electron.owner,
    repo: REPOS.electron.repo,
    path: 'DEPS',
    ref: MAIN_BRANCH,
  });

  if (!('content' in depsData)) {
    d(`Error - incorrectly got array when fetching DEPS content for ${MAIN_BRANCH}`);
    throw new Error(`Upgrade check failed - see logs for more details`);
  }

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
