import * as debug from 'debug';
import * as jsyaml from 'js-yaml';

import { YamlRollTarget } from '../constants';
import { getOctokit } from './octokit';
import { getYamlPRText } from './yaml-pr-text';

export interface YamlRollParams {
  rollTarget: YamlRollTarget;
  electronBranch;
  targetValue: string;
  repository: {
    owner: string;
    repo: string;
  };
}

// Rolls a key in a .circleci/circleci.yml file to a new version
export async function yamlRoll({
  rollTarget,
  electronBranch,
  targetValue,
  repository,
}: YamlRollParams): Promise<any> {
  const d = debug(`roller/${rollTarget.name}:yamlRoll()`);
  const github = await getOctokit();

  try {
    d(`roll triggered for  ${rollTarget.key.join()}=${targetValue}`);

    const sha = electronBranch.commit.sha;
    const filePath = '.circleci/config.yml';
    const branchName = `roller/${rollTarget.name}/${electronBranch.name}`;
    const shortRef = `heads/${branchName}`;
    const ref = `refs/${shortRef}`;
    const { owner, repo } = repository;

    // get the current content of yaml file
    const response = await github.repos.getContent({
      owner,
      repo,
      path: filePath,
    });

    if ('type' in response.data && 'content' in response.data && response.data.type == 'file') {
      const content = Buffer.from(response.data.content, 'base64').toString();

      const yamlData = jsyaml.load(content);
      const keys = rollTarget.key;

      // Traverse the YAML data to the nested key and replace key value with new value
      let currentLevel = yamlData;
      for (let i = 0; i < keys.length - 1; i++) {
        currentLevel = currentLevel[rollTarget.key[i]];
      }
      const previousVersion = currentLevel as string;

      if (targetValue === previousVersion) {
        d(`No roll needed - ${rollTarget.key.join('.')} is already at ${targetValue}`);
        return;
      }
    
      currentLevel[keys[keys.length - 1]] = targetValue;
      const newYamlData = jsyaml.dump(yamlData);

      d(`Creating ref=${ref} at sha=${sha}`);
      await github.git.createRef({ owner, repo, ref, sha });

      d(`Updating the new ref with value=${targetValue}`);
      await github.repos.createOrUpdateFileContents({
        owner,
        repo,
        path: filePath,
        message: `chore: bump ${rollTarget.key.join(
          '.',
        )} in .circleci/circleci.yml to ${targetValue}`,
        content: Buffer.from(newYamlData).toString('base64'),
        branch: branchName,
      });

      d(`Raising a PR for ${branchName} to ${repo}`);
      await github.pulls.create({
        ...repository,
        base: electronBranch.name,
        head: `${owner}:${branchName}`,
        ...getYamlPRText(rollTarget, {
          previousVersion,
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
