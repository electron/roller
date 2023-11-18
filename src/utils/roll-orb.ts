import * as debug from 'debug';
import * as yaml from 'yaml';

import { ORB_KEY, OrbTarget, Repository } from '../constants';
import { getOctokit } from './octokit';
import { getOrbPRText } from './pr-text-orb';
import { PullsListResponseItem } from '../types';

// Rolls an orb in a .circleci/config.yml file to a new version
export async function rollOrb(
  orbTarget: OrbTarget,
  sha: string,
  targetValue: string,
  repository: Repository,
  defaultBranchName: string,
): Promise<any> {
  const d = debug(`roller/orb/${orbTarget.name}:rollOrb()`);
  const github = await getOctokit();
  const filePath = '.circleci/config.yml';

  const { owner, repo } = repository;
  const branchName = `roller/orb/${orbTarget.name}/${defaultBranchName}`;
  const shortRef = `heads/${branchName}`;
  const ref = `refs/${shortRef}`;

  // Look for a pre-existing PR that targets this branch to see if we can update that.
  const existingPrsForBranch = (await github.paginate('GET /repos/:owner/:repo/pulls', {
    head: branchName,
    ...orbTarget,
    state: 'open',
  })) as PullsListResponseItem[];

  const prs = existingPrsForBranch.filter(pr =>
    pr.title.startsWith(`chore: bump ${orbTarget.name}`),
  );

  if (prs.length) {
    // Update existing PR(s)
    for (const pr of prs) {
      d(`Found existing PR: #${pr.number} opened by ${pr.user.login}`);

      // Check to see if automatic orb roll has been temporarily disabled
      const hasPauseLabel = pr.labels.some(label => label.name === 'roller/pause');
      if (hasPauseLabel) {
        d(`Automatic updates have been paused for #${pr.number}, skipping orb roll.`);
        continue;
      }

      d(`Attempting orb update for #${pr.number}`);
      const configData = await getConfigData();
      const updateConfigParams = {
        ...configData,
        ...getTargetKeyAndPreviousVersion(configData.yamlData),
      };

      // if any of the above are null, we can't proceed
      if (Object.values(updateConfigParams).some(v => v === null)) {
        d(`updateConfigParams not complete - skipping.`);
        return;
      }

      if (updateConfigParams.previousVersion === targetValue) {
        d(`orb version unchanged - skipping PR body update`);
        continue;
      }

      d(`updating orb version to ${targetValue}`);
      updateConfigFile(orbTarget, targetValue, updateConfigParams);

      d(`orb version changed - updating PR body`);
      const re = new RegExp('^Original-Version: (\\S+)', 'm');
      const prVersionText = re.exec(pr.body);

      if (!prVersionText || prVersionText.length === 0) {
        d('Could not find PR version text in existing PR - exiting');
        return;
      }

      await github.pulls.update({
        owner,
        repo,
        pull_number: pr.number,
        ...getOrbPRText(orbTarget, {
          previousVersion: updateConfigParams.previousVersion,
          newVersion: targetValue,
          branchName: defaultBranchName,
        }),
      });
    }
  } else {
    try {
      d(`roll triggered for  ${orbTarget.name}=${targetValue}`);

      const configData = await getConfigData();
      const updateConfigParams = {
        ...configData,
        ...getTargetKeyAndPreviousVersion(configData.yamlData),
      };

      // if any of the above are null, we can't proceed
      if (Object.values(updateConfigParams).some(v => v === null)) {
        d(`updateConfigParams not complete - skipping.`);
        return;
      }

      if (updateConfigParams.previousVersion === targetValue) {
        d(`orb version unchanged - skipping PR body update`);
        return;
      }

      try {
        await github.git.getRef({ owner, repo, ref: shortRef });
        d(`Ref ${ref} already exists`);
      } catch {
        d(`Creating ref=${ref} at sha=${sha}`);
        await github.git.createRef({ owner, repo, ref, sha });
      }

      await updateConfigFile(orbTarget, targetValue, updateConfigParams);

      d(`Raising a PR for ${branchName} to ${repo}`);
      await github.pulls.create({
        ...repository,
        base: defaultBranchName,
        head: `${owner}:${branchName}`,
        ...getOrbPRText(orbTarget, {
          previousVersion: updateConfigParams.previousVersion,
          newVersion: targetValue,
          branchName: defaultBranchName,
        }),
      });
    } catch (e) {
      d(`Error rolling ${repository.owner}/${repository.repo} to ${targetValue}`, e);
    }
  }

  function getTargetKeyAndPreviousVersion(
    yamlData,
  ): {
    previousVersion: string;
    targetKey: string;
  } {
    const curr = yamlData[ORB_KEY];
    // attempt to find the orb in .circleci/config.yml whos value includes `orbTarget.name`
    const targetKey = Object.entries(curr as string).find(([_, value]) =>
      value.startsWith(`${orbTarget.name}@`),
    )?.[0];

    if (targetKey === undefined) {
      d(`Key for ${orbTarget.name} not found - skipping.`);
      return null;
    }

    const previousValue: string = curr[targetKey];
    const previousVersion = previousValue.split('@')[1];
    return {
      previousVersion,
      targetKey,
    };
  }

  async function getConfigData() {
    const { data: localData } = await github.repos.getContent({
      owner,
      repo,
      path: filePath,
      ref: branchName,
    });

    if (!('content' in localData)) {
      throw new Error(`Incorrectly received array when fetching content for ${repo}`);
    }

    const content = Buffer.from(localData.content, 'base64').toString();
    return {
      yamlData: yaml.parse(content),
      localData: localData,
      content,
    };
  }

  async function updateConfigFile(orbTarget: OrbTarget, targetValue: string, updateConfigParams) {
    const { yamlData, localData, content, previousVersion, targetKey } = updateConfigParams;
    const currentValueRegex = new RegExp(`${orbTarget.name}@${previousVersion}`, 'g');
    const curr = yamlData[ORB_KEY];
    let newYamlData: string;

    // If there is exactly one occurrence of the target string, we can get away with
    // doing a simple string replacement and avoid any potential formatting issues,
    // otherwise we need to stringify the full config which might change formatting
    if ((content.match(currentValueRegex) || []).length === 1) {
      newYamlData = content.replace(currentValueRegex, `${orbTarget.name}@${targetValue}`);
    } else {
      curr[targetKey] = `${orbTarget.name}@${targetValue}`;
      newYamlData = yaml.stringify(yamlData);
    }
    d(`Updating the new ref with value=${targetValue}`);
    await github.repos.createOrUpdateFileContents({
      owner,
      repo,
      path: filePath,
      message: `chore: bump ${orbTarget.name} in .circleci/config.yml to ${targetValue}`,
      content: Buffer.from(newYamlData).toString('base64'),
      branch: branchName,
      sha: localData.sha,
    });
  }
}
