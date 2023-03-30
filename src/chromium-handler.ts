import * as debug from 'debug';

import { MAIN_BRANCH, REPOS, ROLL_TARGETS } from './constants';
import { compareChromiumVersions } from './utils/compare-chromium-versions';
import { getChromiumReleases, Release } from './utils/get-chromium-tags';
import { getSupportedBranches } from './utils/get-supported-branches';
import { getOctokit } from './utils/octokit';
import { roll } from './utils/roll';
import { ReposGetBranchResponseItem, ReposListBranchesResponseItem } from './types';
import { Octokit } from '@octokit/rest';

type BranchItem = ReposGetBranchResponseItem | ReposListBranchesResponseItem;

async function rollReleaseBranch(github: Octokit, branch: BranchItem, chromiumReleases: Release[]) {
  const d = debug(`roller/chromium:rollReleaseBranch('${branch}')`);

  d(`Fetching DEPS for ${branch.name}`);
  const { data: depsData } = await github.repos.getContent({
    ...REPOS.electron,
    path: 'DEPS',
    ref: branch.commit.sha,
  });

  if (!('content' in depsData)) {
    throw new Error(`Incorrectly received array when fetching DEPS content for ${branch}`);
  }

  const deps = Buffer.from(depsData.content, 'base64').toString('utf8');
  const versionRegex = new RegExp(`${ROLL_TARGETS.chromium.depsKey}':\n +'(.+?)',`, 'm');
  const [, chromiumVersion] = versionRegex.exec(deps);

  const chromiumMajorVersion = Number(chromiumVersion.split('.')[0]);

  // We should be able to parse major version as a number.
  if (Number.isNaN(chromiumMajorVersion)) {
    const SHAPattern = /\b[0-9a-f]{5,40}\b/;
    // On newer release branches we may not yet have updated the branch to use tags
    if (`${chromiumMajorVersion}`.match(SHAPattern)) {
      throw new Error(`${branch.name} roll failed: ${chromiumMajorVersion} should be a tag.`);
    } else {
      throw new Error(
        `${branch.name} roll failed: ${chromiumVersion} is not a valid version number`,
      );
    }
  }

  d(`Computing latest upstream version for Chromium ${chromiumMajorVersion}`);
  const upstreamVersions = chromiumReleases
    .filter(
      r =>
        ['Win32', 'Windows', 'Linux', 'Mac'].includes(r.platform) &&
        r.milestone === chromiumMajorVersion,
    )
    .sort((a, b) => a.time - b.time)
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
      throw new Error(`Failed to roll ${branch.name} to ${latestUpstreamVersion}: ${e.message}`);
    }
  } else {
    d(`No upgrade found, ${chromiumVersion} is the most recent known in its release line.`);
  }
}

async function rollMainBranch(github: Octokit, chromiumReleases: Release[]) {
  const d = debug('roller/chromium:rollMainBranch()');

  d(`Fetching ${MAIN_BRANCH} branch for electron/electron`);
  const { data: mainBranch } = await github.repos.getBranch({
    ...REPOS.electron,
    branch: MAIN_BRANCH,
  });

  if (!mainBranch) {
    throw new Error(`${MAIN_BRANCH} does not exist on ${REPOS.electron.owner}`);
  }

  d(`Fetching DEPS for ${MAIN_BRANCH}`);
  const { data: depsData } = await github.repos.getContent({
    owner: REPOS.electron.owner,
    repo: REPOS.electron.repo,
    path: 'DEPS',
    ref: MAIN_BRANCH,
  });

  if (!('content' in depsData)) {
    throw new Error(`Incorrectly received array when fetching DEPS content for ${MAIN_BRANCH}`);
  }

  const deps = Buffer.from(depsData.content, 'base64').toString('utf8');
  const versionRegex = new RegExp(`${ROLL_TARGETS.chromium.depsKey}':\n +'(.+?)',`, 'm');
  const [, currentVersion] = versionRegex.exec(deps);

  // We should be able to parse major version as a number.
  const chromiumMajorVersion = Number(currentVersion.split('.')[0]);
  if (Number.isNaN(chromiumMajorVersion)) {
    throw new Error(`${MAIN_BRANCH} roll failed: ${currentVersion} is not a valid version number`);
  }

  const upstreamVersions = chromiumReleases
    .filter(
      r => ['Windows', 'Win32', 'Linux', 'Mac'].includes(r.platform) && r.channel === 'Canary',
    )
    .sort((a, b) => a.time - b.time)
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
      throw new Error(`Failed to roll ${MAIN_BRANCH} to ${latestUpstreamVersion}: ${e.message}`);
    }
  }

  return true;
}

export async function handleChromiumCheck(target?: string): Promise<void> {
  const d = debug('roller/chromium:handleChromiumCheck()');
  d('Fetching Chromium releases');
  const chromiumReleases = await getChromiumReleases();

  const github = await getOctokit();

  let failed = false;
  if (target) {
    if (target !== 'main') {
      try {
        const { data: branch }: { data: ReposGetBranchResponseItem } = await github.repos.getBranch(
          {
            ...REPOS.electron,
            branch: target,
          },
        );

        await rollReleaseBranch(github, branch, chromiumReleases);
      } catch (e) {
        d(`Failed to roll ${target}: ${e.message}`);
        failed = true;
      }
    } else {
      try {
        await rollMainBranch(github, chromiumReleases);
      } catch (e) {
        d(`Failed to roll ${MAIN_BRANCH}: ${e.message}`);
        failed = true;
      }
    }
  } else {
    d('Fetching release branches for electron/electron');
    const branches: ReposListBranchesResponseItem[] = await github.paginate(
      github.repos.listBranches.endpoint.merge({
        ...REPOS.electron,
        protected: true,
      }),
    );

    const supported = getSupportedBranches(branches);
    const releaseBranches = branches.filter(branch => supported.includes(branch.name));
    d(`Found ${releaseBranches.length} release branches`);

    // Roll all non-main release branches.
    for (const branch of releaseBranches) {
      try {
        await rollReleaseBranch(github, branch, chromiumReleases);
      } catch (e) {
        failed = true;
        continue;
      }
    }

    try {
      await rollMainBranch(github, chromiumReleases);
    } catch (e) {
      failed = true;
    }
  }

  if (failed) {
    throw new Error('One or more upgrade checks failed - see logs for more details');
  }
}
