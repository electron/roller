import { REPOS } from '../constants';
import { getOctokit } from './octokit';

export interface UpdateDepsParams {
  depName: string;
  depKey: string;
  branch: string;
  newVersion: string;
}
export async function updateDepsFile(params: UpdateDepsParams) {
  const github = await getOctokit();
  const { depName, depKey, branch, newVersion } = params;

  const existing = await github.repos.getContents({
    owner: REPOS.ELECTRON.OWNER,
    repo: REPOS.ELECTRON.NAME,
    path: 'DEPS',
    ref: branch,
  });

  const content = Buffer.from(existing.data.content, 'base64').toString('utf8');
  const previousRegex = new RegExp(`${depKey}':\n +'(.+?)',`, 'm');
  const [, previousVersion] = previousRegex.exec(content);

  if (newVersion !== previousVersion) {
    const regexToReplace = new RegExp(`(${depKey}':\n +').+?',`, 'gm');
    const newContent = content.replace(regexToReplace, `$1${newVersion}',`);
    await github.repos.updateFile({
      owner: REPOS.ELECTRON.OWNER,
      repo: REPOS.ELECTRON.NAME,
      path: 'DEPS',
      content: Buffer.from(newContent).toString('base64'),
      message: `chore: bump ${depName} in DEPS to ${newVersion}`,
      sha: existing.data.sha,
      branch,
    });
  }

  return previousVersion;
}
