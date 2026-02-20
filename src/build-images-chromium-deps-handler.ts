import debug from 'debug';

import { REPOS, BUILD_IMAGES_INSTALL_DEPS_FILE, CHROMIUM_DEPS_FILES } from './constants';
import { getOctokit } from './utils/octokit';
import { getChromiumHeadSha, didChromiumFilesChange } from './utils/chromium-gitiles';
import { rollBuildImages, getFileContentFromBuildImages } from './utils/roll-build-images';

// Regex to extract CHROMIUM_SRC_SHA from install-deps.sh
const CHROMIUM_SHA_REGEX = /CHROMIUM_SRC_SHA="([a-f0-9]{40})"/;

/**
 * Get the currently pinned Chromium SHA from the build-images repo
 */
async function getCurrentPinnedSha(): Promise<string> {
  const octokit = await getOctokit();
  const { raw: content } = await getFileContentFromBuildImages(
    octokit,
    BUILD_IMAGES_INSTALL_DEPS_FILE,
  );

  const match = content.match(CHROMIUM_SHA_REGEX);
  if (!match || !match[1]) {
    throw new Error(`Could not find CHROMIUM_SRC_SHA in ${BUILD_IMAGES_INSTALL_DEPS_FILE}`);
  }

  return match[1];
}

/**
 * Update the install-deps.sh file with a new Chromium SHA
 */
function updateInstallDepsContent(content: string, newSha: string): string {
  return content.replace(CHROMIUM_SHA_REGEX, `CHROMIUM_SRC_SHA="${newSha}"`);
}

export async function handleBuildImagesChromiumDepsCheck(): Promise<void> {
  const d = debug('roller/build-images-chromium-deps:handleBuildImagesChromiumDepsCheck()');

  const octokit = await getOctokit();

  d('Getting current pinned SHA from build-images');
  const currentPinnedSha = await getCurrentPinnedSha();
  d(`Current pinned SHA: ${currentPinnedSha}`);

  d('Getting current HEAD SHA from Chromium');
  const currentHeadSha = await getChromiumHeadSha();
  d(`Current HEAD SHA: ${currentHeadSha}`);

  if (currentPinnedSha === currentHeadSha) {
    d('Pinned SHA is already at HEAD, nothing to do');
    return;
  }

  d(
    `Checking if any of ${CHROMIUM_DEPS_FILES.join(', ')} changed between ${currentPinnedSha} and ${currentHeadSha}`,
  );
  const filesChanged = await didChromiumFilesChange(
    CHROMIUM_DEPS_FILES,
    currentPinnedSha,
    currentHeadSha,
  );

  if (!filesChanged) {
    d('No changes detected in monitored files, skipping roll');
    return;
  }

  d('Changes detected, creating PR to update SHA');

  const { raw: currentContent } = await getFileContentFromBuildImages(
    octokit,
    BUILD_IMAGES_INSTALL_DEPS_FILE,
  );

  const newContent = updateInstallDepsContent(currentContent, currentHeadSha);

  await rollBuildImages(
    'chromium-deps',
    'chromium deps',
    currentPinnedSha,
    currentHeadSha,
    BUILD_IMAGES_INSTALL_DEPS_FILE,
    newContent,
  );

  d('Successfully created/updated PR');
}
