import * as debug from 'debug';
import * as yaml from 'yaml';

import { MAIN_BRANCH, ORB_KEY, OrbTarget } from '../constants';
import { getOctokit } from './octokit';
import { getOrbPRText } from './pr-text-orb';

// Rolls an orb in a .circleci/config.yml file to a new version
export async function rollOrb({
  orbTarget: rollTarget,
  sha,
  targetValue,
  repository,
}): Promise<any> {
  const d = debug(`roller/orb/${rollTarget.name}:rollOrb()`);
  const github = await getOctokit();

  try {
    d(`roll triggered for  ${rollTarget.name}=${targetValue}`);

    const filePath = '.circleci/config.yml';
    const branchName = `roller/orb/${rollTarget.name}/${MAIN_BRANCH}`;
    const shortRef = `heads/${branchName}`;
    const ref = `refs/${shortRef}`;
    const { owner, repo } = repository;

    const response = await github.repos.getContent({
      owner,
      repo,
      path: filePath,
    });

    if ('type' in response.data && 'content' in response.data && response.data.type == 'file') {
      const content = Buffer.from(response.data.content, 'base64').toString();
      const yamlData = yaml.parse(content);
      let curr = yamlData[ORB_KEY];

      // attempt to find the orb in .circleci/config.yml whos value includes `orbTarget.name`
      const targetKey = Object.entries(curr as string).find(([_, value]) =>
        value.startsWith(`${rollTarget.name}@`),
      )?.[0];

      if (targetKey === undefined) {
        d(`Key for ${rollTarget.name} not found - skipping.`);
        return;
      }

      // don't set the new value if the version is up to date
      const previousVersion = curr[targetKey].split('@')[1];
      if (targetValue === previousVersion) {
        d(`No roll needed - ${rollTarget.name} is already at ${targetValue}`);
        return;
      }
      curr[targetKey] = `${rollTarget.name}@${targetValue}`;

      const newYamlData = yaml.stringify(yamlData);

      d(`Creating ref=${ref} at sha=${sha}`);
      await github.git.createRef({ owner, repo, ref, sha });

      d(`Updating the new ref with value=${targetValue}`);
      await github.repos.createOrUpdateFileContents({
        owner,
        repo,
        path: filePath,
        message: `chore: bump ${rollTarget.name} in .circleci/config.yml to ${targetValue}`,
        content: Buffer.from(newYamlData).toString('base64'),
        branch: branchName,
      });

      d(`Raising a PR for ${branchName} to ${repo}`);
      await github.pulls.create({
        ...repository,
        base: MAIN_BRANCH,
        head: `${owner}:${branchName}`,
        ...getOrbPRText(rollTarget, {
          previousVersion: previousVersion,
          newVersion: targetValue,
          branchName: MAIN_BRANCH,
        }),
      });
    }
  } catch (e) {
    d(`Error rolling ${repository.owner}/${repository.repo} to ${targetValue}`, e);
    throw new Error(
      `Failed to roll ${repository.owner}/${repository.repo} to ${targetValue}: ${e.message}`,
    );
  }
}
