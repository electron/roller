import debug from 'debug';

import { MAIN_BRANCH, REPOS, ROLL_TARGETS } from './constants.js';
import { compareChromiumVersions } from './utils/compare-chromium-versions.js';
import { getChromiumReleases, Release } from './utils/get-chromium-tags.js';
import { getSupportedBranches } from './utils/get-supported-branches.js';
import { getContent } from './utils/github-utils.js';
import { getOctokit } from './utils/octokit.js';
import { roll } from './utils/roll.js';
import { Branch } from './types.js';
import { Octokit } from '@octokit/rest';

// The outcome of a main branch roll: the Chromium version main is currently on
// (its landed DEPS version, not the version the open roll PR targets) and the
// release branches the roll PR covers with `target/N-x-y` labels.
interface MainRollResult {
  currentVersion: string;
  coveredBranches: string[];
}

async function rollReleaseBranch(
  github: Octokit,
  branch: Branch,
  mainRoll?: MainRollResult | null,
) {
  const d = debug(`roller/chromium:rollReleaseBranch('${branch.name}')`);

  d(`Fetching DEPS for ${branch.name}`);
  const deps = await getContent(github, {
    ...REPOS.electron,
    path: 'DEPS',
    ref: branch.commit.sha,
  });

  if (deps === null) {
    throw new Error(`Could not fetch DEPS content for ${branch.name}`);
  }

  const versionRegex = new RegExp(`${ROLL_TARGETS.chromium.depsKey}':\n +'(.+?)',`, 'm');
  const [, chromiumVersion] = versionRegex.exec(deps.content);

  const chromiumMajorVersion = Number(chromiumVersion.split('.')[0]);

  // We should be able to parse major version as a number.
  if (Number.isNaN(chromiumMajorVersion)) {
    throw new Error(`${branch.name} roll failed: ${chromiumVersion} is not a valid version number`);
  }

  // A branch covered by a target/ label on the main roll PR receives the main
  // roll as a backport instead of an independent roll - but only skip it while
  // it has kept pace with the Chromium version main has actually landed, so a
  // branch whose backports stall can pull itself forward with its own roll.
  // Explicitly targeted rolls pass no main roll info and are never suppressed.
  if (
    mainRoll?.coveredBranches.includes(branch.name) &&
    compareChromiumVersions(chromiumVersion, mainRoll.currentVersion) >= 0
  ) {
    d(
      `${branch.name} is covered by the ${MAIN_BRANCH} roll and has kept pace with ${MAIN_BRANCH} at ${mainRoll.currentVersion} - skipping independent roll`,
    );
    return;
  }

  d(`Computing latest upstream version for Chromium ${chromiumMajorVersion}`);
  const chromiumReleases = await getChromiumReleases({ milestone: chromiumMajorVersion });
  const latestUpstreamVersion = chromiumReleases[chromiumReleases.length - 1];

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

async function rollMainBranch(github: Octokit): Promise<MainRollResult | null> {
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
  const deps = await getContent(github, {
    owner: REPOS.electron.owner,
    repo: REPOS.electron.repo,
    path: 'DEPS',
    ref: MAIN_BRANCH,
  });

  if (deps === null) {
    throw new Error(`Could not fetch DEPS content for ${MAIN_BRANCH}`);
  }

  const versionRegex = new RegExp(`${ROLL_TARGETS.chromium.depsKey}':\n +'(.+?)',`, 'm');
  const [, currentVersion] = versionRegex.exec(deps.content);

  // We should be able to parse major version as a number.
  const chromiumMajorVersion = Number(currentVersion.split('.')[0]);
  if (Number.isNaN(chromiumMajorVersion)) {
    throw new Error(`${MAIN_BRANCH} roll failed: ${currentVersion} is not a valid version number`);
  }

  const chromiumReleases = await getChromiumReleases({ channel: 'Canary' });
  const latestUpstreamVersion = chromiumReleases[chromiumReleases.length - 1];

  if (latestUpstreamVersion && currentVersion !== latestUpstreamVersion) {
    d(`Updating ${MAIN_BRANCH} from ${currentVersion} to ${latestUpstreamVersion}`);
    try {
      const coveredBranches = await roll({
        rollTarget: ROLL_TARGETS.chromium,
        electronBranch: mainBranch,
        targetVersion: latestUpstreamVersion,
      });
      return { currentVersion, coveredBranches: coveredBranches ?? [] };
    } catch (e) {
      throw new Error(`Failed to roll ${MAIN_BRANCH} to ${latestUpstreamVersion}: ${e.message}`);
    }
  }

  return null;
}

export async function handleChromiumCheck(target?: string): Promise<void> {
  const d = debug('roller/chromium:handleChromiumCheck()');

  const github = await getOctokit();

  let failed = false;
  if (target) {
    if (target !== 'main') {
      try {
        const { data: branch } = await github.repos.getBranch({
          ...REPOS.electron,
          branch: target,
        });

        await rollReleaseBranch(github, branch);
      } catch (e) {
        d(`Failed to roll ${target}: ${e.message}`);
        failed = true;
      }
    } else {
      try {
        await rollMainBranch(github);
      } catch (e) {
        d(`Failed to roll ${MAIN_BRANCH}: ${e.message}`);
        failed = true;
      }
    }
  } else {
    d('Fetching release branches for electron/electron');
    const releaseBranches = await getSupportedBranches(github);
    d(`Found ${releaseBranches.length} release branches`);

    // Roll main first, so that the release branches its roll PR covers with
    // target/ labels can skip their own rolls in favor of the backports.
    let mainRoll: MainRollResult | null = null;
    try {
      mainRoll = await rollMainBranch(github);
    } catch (e) {
      failed = true;
    }

    // Roll all non-main release branches.
    for (const branch of releaseBranches) {
      try {
        await rollReleaseBranch(github, branch, mainRoll);
      } catch (e) {
        failed = true;
        continue;
      }
    }
  }

  if (failed) {
    throw new Error('One or more upgrade checks failed - see logs for more details');
  }
}
