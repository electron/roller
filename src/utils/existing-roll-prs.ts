import Octokit, { PullsListResponseItem } from '@octokit/rest';
import { REPOS, RollTarget } from '../constants';

export const getExistingRollPrs = async (
  github: Octokit,
  branchName: string,
  rollTarget: RollTarget,
) => {
  const existingPrsForBranch = (await github.paginate('GET /repos/:owner/:repo/pulls', {
    base: branchName,
    ...REPOS.electron,
    state: 'open',
  })) as PullsListResponseItem[];

  return existingPrsForBranch.filter(pr => pr.title.startsWith(`chore: bump ${rollTarget.name}`));
};
