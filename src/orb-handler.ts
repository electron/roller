import * as debug from 'debug';

import { MAIN_BRANCH, REPOS, ORB_TARGETS, ORB_OWNER } from './constants';
import { getOctokit } from './utils/octokit';
import { rollOrb } from './utils/roll-orb';

// use octokit and find a list of repos that are under the electron org and are not archived
export async function getRelevantReposList() {
  const d = debug(`roller/orb-handler:getRelevantReposList()`);
  const github = await getOctokit();
  const filePath = '.circleci/config.yml';

  d("fetching list of repos in the electron organization that aren't archived");
  const reposList = await (
    await github.paginate('GET /orgs/{org}/repos', {
      org: ORB_OWNER,
      type: 'all',
    })
  ).filter(repo => {
    return !repo.archived;
  });

  d('filtering repos that have a .circleci/config.yml file and return a list of OrbTarget');
  const repos = await Promise.all(
    reposList.map(async repo => {
      try {
        await github.repos.getContent({
          owner: ORB_OWNER,
          repo: repo.name,
          path: filePath,
        });

        return {
          repo: repo.name,
          owner: ORB_OWNER,
        };
      } catch (e) {
        d('Error getting content for repo - ignoring', repo.name, e);
        return null;
      }
    }),
  );
  return repos.filter(repo => repo !== null);
}

export async function rollMainBranch() {
  const d = debug(`roller/orb-handler:rollMainBranch()`);
  const github = await getOctokit();

  for (const orbTarget of ORB_TARGETS) {
    d(`Fetching latest version of ${orbTarget.name}`);
    const { data: latestRelease } = await github.repos.getLatestRelease({
      owner: orbTarget.owner,
      repo: orbTarget.repo,
    });
    const latestReleaseTagName = latestRelease.tag_name;

    const repos = await getRelevantReposList();
    for (const repo of repos) {
      d(`Fetching ${MAIN_BRANCH} branch from ${repo.owner}/${repo.repo}`);
      const { data: mainBranch } = await github.repos.getBranch({
        owner: repo.owner,
        repo: repo.repo,
        branch: MAIN_BRANCH,
      });

      try {
        await rollOrb({
          orbTarget: orbTarget,
          electronBranch: mainBranch,
          targetValue: latestReleaseTagName,
          repository: repo,
        });
      } catch (e) {
        d(`Error rolling ${repo.owner}/${repo.repo} to ${latestReleaseTagName}`, e);
        throw new Error(
          `Failed to roll ${repo.owner}/${repo.repo} to ${latestReleaseTagName}: ${e.message}`,
        );
      }
    }
  }
}
