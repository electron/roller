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

  const { data } = await github.repos.getContent({
    ...REPOS.electron,
    path: 'DEPS',
    ref: branch,
  });

  if (!('content' in data)) return;

  const content = Buffer.from(data.content, 'base64').toString('utf8');
  const previousRegex = new RegExp(`${depKey}':\n +'(.+?)',`, 'm');
  const [, previousDEPSVersion] = previousRegex.exec(content);

  if (targetVersion !== previousDEPSVersion) {
    const regexToReplace = new RegExp(`(${depKey}':\n +').+?',`, 'gm');
    const newContent = content.replace(regexToReplace, `$1${targetVersion}',`);
    await github.repos.createOrUpdateFileContents({
      ...REPOS.electron,
      path: 'DEPS',
      content: Buffer.from(newContent).toString('base64'),
      message: `chore: bump ${depName} in DEPS to ${targetVersion}`,
      sha: data.sha,
      branch,
    });
  }

  return { previousDEPSVersion, newDEPSVersion: targetVersion };
}
