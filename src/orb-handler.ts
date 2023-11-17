import * as debug from 'debug';

import { MAIN_BRANCH, ORB_TARGETS, REPO_OWNER } from './constants';
import { getOctokit } from './utils/octokit';
import { rollOrb } from './utils/roll-orb';

// return a list of repositories with a .circleci/config.yml that are under the `electron` namespace and are unarchived
export async function getRelevantReposList() {
  const d = debug(`roller/orb:getRelevantReposList()`);
  const github = await getOctokit();
  const filePath = '.circleci/config.yml';

  d("fetching list of repos in the electron organization that aren't archived");
  const reposList = await (
    await github.paginate('GET /orgs/{org}/repos', {
      org: REPO_OWNER,
      type: 'sources',
    })
  ).filter(repo => {
    return !repo.archived;
  });

  d('filtering repos that have a .circleci/config.yml file and return a list of OrbTarget');
  const repos = await Promise.all(
    reposList.map(async repo => {
      try {
        await github.repos.getContent({
          owner: REPO_OWNER,
          repo: repo.name,
          path: filePath,
        });

        return {
          repo: repo.name,
          owner: REPO_OWNER,
        };
      } catch (e) {
        if (e.status === 404) return null;
        d('Error getting content for repo - ignoring', repo.name, e);
        return null;
      }
    }),
  );
  return repos.filter(repo => repo !== null);
}

// Rolls each orb defined in ORB_TARGETS in constants.ts to the latest version
// across all relevant repositories in the electron organization
export async function rollMainBranch() {
  const d = debug(`roller/orb:rollMainBranch()`);
  const github = await getOctokit();
  const repos = await getRelevantReposList();

  for (const orbTarget of ORB_TARGETS) {
    d(`Fetching latest version of ${orbTarget.name}`);
    const { data: latestRelease } = await github.repos.getLatestRelease({
      owner: orbTarget.owner,
      repo: orbTarget.repo,
    });
    const latestReleaseTagName = latestRelease.tag_name.startsWith('v')
      ? latestRelease.tag_name.slice(1)
      : latestRelease.tag_name;

    for (const repo of repos) {
      d(`Fetching ${MAIN_BRANCH} branch from ${repo.owner}/${repo.repo}`);
      const { data: mainBranch } = await github.repos.getBranch({
        owner: repo.owner,
        repo: repo.repo,
        branch: MAIN_BRANCH,
      });

      try {
        await rollOrb({
          orbTarget,
          sha: mainBranch.commit.sha,
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
