import { REPOS } from '../constants';
import { getOctokit } from './octokit';

export interface UpdateDepsParams {
  depName: string;
  depKey: string;
  branch: string;
  targetVersion: string;
}

export async function updateDepsFile({ depName, depKey, branch, targetVersion }: UpdateDepsParams) {
  const github = await getOctokit();

  const existing = await github.repos.getContents({
    ...REPOS.electron,
    path: 'DEPS',
    ref: branch,
  });

  const content = Buffer.from(existing.data.content, 'base64').toString('utf8');
  const previousRegex = new RegExp(`${depKey}':\n +'(.+?)',`, 'm');
  const [, previousDEPSVersion] = previousRegex.exec(content);

  if (targetVersion !== previousDEPSVersion) {
    const regexToReplace = new RegExp(`(${depKey}':\n +').+?',`, 'gm');
    const newContent = content.replace(regexToReplace, `$1${targetVersion}',`);
    await github.repos.updateFile({
      ...REPOS.electron,
      path: 'DEPS',
      content: Buffer.from(newContent).toString('base64'),
      message: `chore: bump ${depName} in DEPS to ${targetVersion}`,
      sha: existing.data.sha,
      branch,
    });
  }

  return { previousDEPSVersion, newDEPSVersion: targetVersion };
}
