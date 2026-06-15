import { REPOS } from '../constants.js';
import { getContent } from './github-utils.js';
import { getOctokit } from './octokit.js';

export interface UpdateDepsParams {
  depName: string;
  depKey: string;
  branch: string;
  targetVersion: string;
}

export async function updateDepsFile({ depName, depKey, branch, targetVersion }: UpdateDepsParams) {
  const github = await getOctokit();

  const deps = await getContent(github, {
    ...REPOS.electron,
    path: 'DEPS',
    ref: branch,
  });

  if (deps === null) return;

  const previousRegex = new RegExp(`${depKey}':\n +'(.+?)',`, 'm');
  const [, previousDEPSVersion] = previousRegex.exec(deps.content);

  if (targetVersion !== previousDEPSVersion) {
    const regexToReplace = new RegExp(`(${depKey}':\n +').+?',`, 'gm');
    const newContent = deps.content.replace(regexToReplace, `$1${targetVersion}',`);
    await github.repos.createOrUpdateFileContents({
      ...REPOS.electron,
      path: 'DEPS',
      content: Buffer.from(newContent).toString('base64'),
      message: `chore: bump ${depName} in DEPS to ${targetVersion}`,
      sha: deps.sha,
      branch,
    });
  }

  return { previousDEPSVersion, newDEPSVersion: targetVersion };
}
