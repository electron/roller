import * as debug from 'debug';
import * as jsyaml from 'js-yaml';

import { ORBS, OrbTarget } from '../constants';
import { getOctokit } from './octokit';
import { getOrbPRText } from './pr-text-orb';

export interface RollOrbParams {
  orbTarget: OrbTarget;
  electronBranch;
  targetValue: string;
  repository: {
    owner: string;
    repo: string;
  };
}

// Rolls an orb in a .circleci/config.yml file to a new version
export async function rollOrb({
  orbTarget: rollTarget,
  electronBranch,
  targetValue,
  repository,
}: RollOrbParams): Promise<any> {
  const d = debug(`roller/${rollTarget.name}:rollOrb()`);
  const github = await getOctokit();

  try {
    d(`roll triggered for  ${rollTarget.name}=${targetValue}`);

    const sha = electronBranch.commit.sha;
    const filePath = '.circleci/config.yml';
    const branchName = `roller/${rollTarget.name}/${electronBranch.name}`;
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
      const yamlData = jsyaml.load(content);
      let curr = yamlData[ORBS];

      // attempt to find the orb in .circleci/config.yml whos value includes `orbTarget.name`
      let targetKey;
      for (const key of Object.keys(curr)) {
        if (curr[key].includes(rollTarget.name)) {
          targetKey = key;
          break;
        }
      }

      if (targetKey === undefined) {
        d(`Key for ${rollTarget.name} not found.`);
        throw new Error(`Key for "${rollTarget.name}" not found.`);
      }

      // don't set the new value if the version is up to date
      const previousVersion = curr[targetKey].split('@')[1];
      if (targetValue === previousVersion) {
        d(`No roll needed - ${rollTarget.name} is already at ${targetValue}`);
        return;
      }
      curr[targetKey] = `${rollTarget.name}@${targetValue}`;

      const newYamlData = jsyaml.dump(yamlData);

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
        base: electronBranch.name,
        head: `${owner}:${branchName}`,
        ...getOrbPRText(rollTarget, {
          previousVersion: previousVersion,
          newVersion: targetValue,
          branchName: electronBranch.name,
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
