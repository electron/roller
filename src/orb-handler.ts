import * as debug from 'debug';

import * as semver from 'semver';
import { ORB_TARGETS, OrbTarget, REPO_OWNER } from './constants';
import { getOctokit } from './utils/octokit';
import { rollOrb } from './utils/roll-orb';

async function getLatestTagForOrb(orbTarget: OrbTarget) {
  const octokit = await getOctokit();
  // return a list of tags for the repo, filter out any that aren't valid semver
  const tags = await (
    await octokit.paginate('GET /repos/{owner}/{repo}/tags', {
      owner: orbTarget.owner,
      repo: orbTarget.repo,
    })
  )
    .map((tag) => tag.name)
    .map((tag) => semver.valid(tag))
    .map((tag) => semver.clean(tag))
    .filter((tag) => tag !== null);

  if (!tags.length) {
    throw new Error(`Failed to get the current release version from tags.`);
  }
  return semver.rsort(tags)[0];
}

// return a list of repositories with a .circleci/config.yml that are under the `electron` namespace and are unarchived
export async function getRelevantReposList() {
  const d = debug(`roller/orb:getRelevantReposList()`);
  const octokit = await getOctokit();
  const filePath = '.circleci/config.yml';

  d("fetching list of repos in the electron organization that aren't archived");
  const reposList = await (
    await octokit.paginate('GET /orgs/{org}/repos', {
      org: REPO_OWNER,
      type: 'sources',
    })
  ).filter((repo) => {
    return !repo.archived;
  });

  d('filtering repos that have a .circleci/config.yml file and return a list of OrbTarget');
  const repos = await Promise.all(
    reposList.map(async (repo) => {
      try {
        await octokit.repos.getContent({
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
  return repos.filter((repo) => repo !== null);
}

// Rolls each orb defined in ORB_TARGETS in constants.ts to the latest version
// across all relevant repositories in the electron organization
export async function rollMainBranch() {
  const d = debug(`roller/orb:rollMainBranch()`);
  const octokit = await getOctokit();
  const repos = await getRelevantReposList();

  for (const orbTarget of ORB_TARGETS) {
    d(`Fetching latest version of ${orbTarget.name}`);
    let latestRelease;
    try {
      const { data } = await octokit.repos.getLatestRelease({
        owner: orbTarget.owner,
        repo: orbTarget.repo,
      });
      latestRelease = data;
    } catch (e) {
      if (e.status === 404) {
        latestRelease = getLatestTagForOrb(orbTarget);
      }
    }

    const latestReleaseTagName = latestRelease.tag_name.startsWith('v')
      ? latestRelease.tag_name.slice(1)
      : latestRelease.tag_name;

    for (const repo of repos) {
      const repoData = await octokit.repos.get(repo);
      const defaultBranchName = repoData.data.default_branch;
      d(`Fetching ${defaultBranchName} branch from ${repo.owner}/${repo.repo}`);
      const { data: mainBranch } = await octokit.repos.getBranch({
        owner: repo.owner,
        repo: repo.repo,
        branch: defaultBranchName,
      });

      try {
        await rollOrb(
          orbTarget,
          mainBranch.commit.sha,
          latestReleaseTagName,
          repo,
          defaultBranchName,
        );
      } catch (e) {
        d(`Error rolling ${repo.owner}/${repo.repo} to ${latestReleaseTagName}`, e);
        throw new Error(
          `Failed to roll ${repo.owner}/${repo.repo} to ${latestReleaseTagName}: ${e.message}`,
        );
      }
    }
  }
}
