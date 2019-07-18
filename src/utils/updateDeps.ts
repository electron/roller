import { Repo } from '../constants';
import { getOctokit } from './octokit';

export interface UpdateDepsParams {
  repo: Repo;
  depName: string;
  depKey: string;
  branch: string;
  newVersion: string;
}
export async function updateDepsFile(params: UpdateDepsParams) {
  const github = await getOctokit();
  const { repo, depName, depKey, branch, newVersion } = params;

  const existing = await github.repos.getContents({
    owner: repo.OWNER,
    repo: repo.NAME,
    path: 'DEPS',
    ref: branch,
  });

  const content = Buffer.from(existing.data.content, 'base64').toString('utf8');
  const reg = new RegExp(`${depKey}':\n +'(.+?)',`, 'm');
  const [, previousVersion] = reg.exec(content);

  if (newVersion !== previousVersion) {
    const reg2 = new RegExp(`${depKey}':\n +').+?',`, 'gm');
    const newContent = content.replace(reg2, `$1${newVersion}',`);
    await github.repos.updateFile({
      owner: repo.OWNER,
      repo: repo.NAME,
      path: 'DEPS',
      content: Buffer.from(newContent).toString('base64'),
      message: `chore: bump ${depName} in DEPS to ${newVersion}`,
      sha: existing.data.sha,
      branch,
    });
  }

  return previousVersion;
}
