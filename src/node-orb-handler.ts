import * as debug from 'debug';

import { MAIN_BRANCH, NODE_ORB_REPOS, REPOS, YAML_ROLL_TARGETS, YamlRollTarget } from './constants';
import { getOctokit } from './utils/octokit';
import { yamlRoll } from './utils/roll-yaml';

async function rollMainBranch() {
  const d = debug(`roller/node-orb:rollMainBranch()`);
  const github = await getOctokit();

  d(`Fetching latest version of electron/node-orb`);
  const { data: latestRelease } = await github.repos.getLatestRelease({
    owner: REPOS.nodeOrb.owner,
    repo: REPOS.nodeOrb.repo,
  });
  const latestReleaseTagName = latestRelease.tag_name;

  for (const repo of NODE_ORB_REPOS) {
    d(`Fetching ${MAIN_BRANCH} branch from ${repo.owner}/${repo.repo}`);
    const { data: mainBranch } = await github.repos.getBranch({
      ...repo,
      branch: MAIN_BRANCH,
    });

    try {
      await yamlRoll({
        rollTarget: YAML_ROLL_TARGETS.nodeOrb,
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

module.exports = rollMainBranch;