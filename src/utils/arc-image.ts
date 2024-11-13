import { Octokit } from '@octokit/rest';
import { MAIN_BRANCH, REPOS } from '../constants';
import { getOctokit } from './octokit';

const WINDOWS_IMAGE_REGEX =
  /electronarc\.azurecr\.io\/win-actions-runner:main-[a-f0-9]{7}@sha256:[a-f0-9]{64}/;
const LINUX_IMAGE_REGEX =
  /ghcr\.io\/actions\/actions-runner:[0-9]+\.[0-9]+\.[0-9]+@sha256:[a-f0-9]{64}/;

export async function getFileContent(octokit: Octokit, filePath: string, ref = MAIN_BRANCH) {
  const { data } = await octokit.repos.getContent({
    ...REPOS.electronInfra,
    path: filePath,
    ref,
  });
  if ('content' in data) {
    return { raw: Buffer.from(data.content, 'base64').toString('utf8'), sha: data.sha };
  }
  throw 'wat';
}

export const currentWindowsImage = (content: string) => {
  return content.match(WINDOWS_IMAGE_REGEX)?.[0];
};

export const didFileChangeBetweenShas = async (file: string, sha1: string, sha2: string) => {
  const octokit = await getOctokit();
  const [start, end] = await Promise.all([
    await getFileContent(octokit, file, sha1),
    await getFileContent(octokit, file, sha2),
  ]);

  return start.raw.trim() !== end.raw.trim();
};
