import * as debug from 'debug';

import {
  REPOS,
  WINDOWS_DOCKER_IMAGE_NAME,
  ARC_RUNNER_ENVIRONMENTS,
  MAIN_BRANCH,
} from './constants';
import { getOctokit } from './utils/octokit';
import { currentWindowsImage, didFileChangeBetweenShas } from './utils/arc-image';
import { rollInfra } from './utils/roll-infra';

async function getLatestVersionOfImage() {
  const octokit = await getOctokit();
  // return a list of tags for the repo, filter out any that aren't valid semver
  const versions = await octokit.paginate(
    'GET /orgs/{org}/packages/{package_type}/{package_name}/versions',
    {
      org: REPOS.electronInfra.owner,
      package_type: 'container',
      package_name: WINDOWS_DOCKER_IMAGE_NAME,
    },
  );

  let best = null;
  let bestMainTag = null;
  for (const version of versions) {
    // Only images built from main should be bumped to
    const mainTag = version.metadata?.container?.tags?.find((t) => t.startsWith(`${MAIN_BRANCH}-`));
    if (!mainTag) continue;
    if (!best) {
      best = version;
      bestMainTag = mainTag;
      continue;
    }

    if (new Date(best.created_at).getTime() < new Date(version.created_at).getTime()) {
      best = version;
      bestMainTag = mainTag;
    }
  }
  return [`electronarc.azurecr.io/win-actions-runner:${bestMainTag}@${best.name}`, bestMainTag];
}

const WINDOWS_IMAGE_DOCKERFILE_PATH = 'docker/windows-actions-runner/Dockerfile';

export async function rollWindowsArcImage() {
  const d = debug(`roller/infra:rollWindowsArcImage()`);
  const octokit = await getOctokit();

  const [latestWindowsImage, shortLatestTag] = await getLatestVersionOfImage();

  for (const arcEnv of Object.keys(ARC_RUNNER_ENVIRONMENTS)) {
    d(`Fetching current version of "${arcEnv}" arc image in: ${ARC_RUNNER_ENVIRONMENTS[arcEnv]}`);

    const currentVersion = await octokit.repos.getContent({
      owner: REPOS.electronInfra.owner,
      repo: REPOS.electronInfra.repo,
      path: ARC_RUNNER_ENVIRONMENTS[arcEnv],
    });
    const data = currentVersion.data;
    if ('content' in data) {
      const currentContent = Buffer.from(data.content, 'base64').toString('utf8');
      const currentImage = currentWindowsImage(currentContent);

      if (currentImage !== latestWindowsImage) {
        const currentSha = currentImage.split(`${MAIN_BRANCH}-`)[1].split('@')[0];
        if (
          await didFileChangeBetweenShas(
            WINDOWS_IMAGE_DOCKERFILE_PATH,
            currentSha,
            shortLatestTag.split('-')[1],
          )
        ) {
          d(`Current image in "${arcEnv}" is outdated, updating...`);
          const newContent = currentContent.replace(currentImage, latestWindowsImage);
          await rollInfra(
            `${arcEnv}/windows-image`,
            'windows arc image',
            shortLatestTag,
            ARC_RUNNER_ENVIRONMENTS[arcEnv],
            newContent,
          );
        } else {
          d(
            `Current image in "${arcEnv}" (sha: ${currentSha}) is not latest sha (${shortLatestTag.split('-')[1]}) but is considered up-to-date, skipping...`,
          );
        }
      }
    }
  }
}
