import debug from 'debug';

import { WINDOWS_DOCKER_FILE, ARC_RUNNER_ENVIRONMENTS } from './constants';
import { getOctokit } from './utils/octokit';

import { getLatestRunnerImages } from './utils/get-latest-runner-images';
import {
  getCurrentWindowsRunnerVersion,
  getFileContent,
  currentLinuxImages,
} from './utils/arc-image';
import { rollInfra } from './utils/roll-infra';

export async function rollActionsRunner() {
  const d = debug(`roller/infra:rollActionsRunner()`);

  const octokit = await getOctokit();
  const { archDigests, latestVersion } = (await getLatestRunnerImages(octokit)) ?? {
    archDigests: {},
    latestVersion: '',
  };
  if (latestVersion === '') {
    d('No latest version found for github actions runner, exiting...');
    return;
  }

  const windowsDockerFile = await getFileContent(octokit, WINDOWS_DOCKER_FILE);
  const currentWindowsRunnerVersion = await getCurrentWindowsRunnerVersion(windowsDockerFile.raw);
  if (currentWindowsRunnerVersion !== latestVersion) {
    d(`Runner version ${currentWindowsRunnerVersion} is outdated, updating to ${latestVersion}.`);
    const newDockerFile = windowsDockerFile.raw.replace(currentWindowsRunnerVersion, latestVersion);
    await rollInfra(
      `prod/actions-runner`,
      'github actions runner images',
      latestVersion,
      WINDOWS_DOCKER_FILE,
      newDockerFile,
    );
  }

  for (const arcEnv of Object.keys(ARC_RUNNER_ENVIRONMENTS)) {
    d(`Fetching current version of "${arcEnv}" arc image in: ${ARC_RUNNER_ENVIRONMENTS[arcEnv]}`);

    const runnerFile = await getFileContent(octokit, ARC_RUNNER_ENVIRONMENTS['prod']);

    const currentImages = currentLinuxImages(runnerFile.raw);
    if (currentImages.amd64 !== archDigests.amd64 || currentImages.arm64 !== archDigests.arm64) {
      d(`Current linux images in "${arcEnv}" are outdated, updating to ${latestVersion}.`);
      let newContent = runnerFile.raw.replace(currentImages.amd64, archDigests.amd64);
      newContent = newContent.replace(currentImages.arm64, archDigests.arm64);
      await rollInfra(
        `${arcEnv}/actions-runner`,
        'github actions runner images',
        latestVersion,
        ARC_RUNNER_ENVIRONMENTS[arcEnv],
        newContent,
      );
    } else {
      d(`Current linux images in "${arcEnv}" are up-to-date, skipping...`);
    }
  }
}
