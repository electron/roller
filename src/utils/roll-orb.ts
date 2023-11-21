import * as debug from 'debug';
import * as yamljs from 'yaml';

import { ORB_KEY, OrbTarget, Repository } from '../constants';
import { getOctokit } from './octokit';
import { getOrbPRText } from './pr-text-orb';
import { PullsListResponseItem } from '../types';

// Rolls an orb in a .circleci/config.yml file to a new version
export async function rollOrb(
  orbTarget: OrbTarget,
  defaultBranchHeadSha: string,
  targetOrbVersion: string,
  repository: Repository,
  defaultBranchName: string,
): Promise<any> {
  const d = debug(`roller/orb/${orbTarget.name}:rollOrb()`);
  const octokit = await getOctokit();
  const filePath = '.circleci/config.yml';

  const { owner, repo } = repository;
  const branchName = `roller/orb/${orbTarget.name}/${defaultBranchName}`;
  const shortRef = `heads/${branchName}`;
  const ref = `refs/${shortRef}`;

  // Look for a pre-existing PR that targets this branch to see if we can update that.
  let existingPrsForBranch: PullsListResponseItem[] = [];
  try {
    existingPrsForBranch = (await octokit.paginate('GET /repos/:owner/:repo/pulls', {
      head: branchName,
      owner,
      repo,
      state: 'open',
    })) as PullsListResponseItem[];
  } catch {}

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
      const configData = await getCircleConfigFile();
      const targetKeyAndPreviousVersion = getTargetKeyAndPreviousVersion(configData.yaml);

      // if any of the above are null, we can't proceed
      if (!targetKeyAndPreviousVersion) {
        d(`updateConfigParams not complete - skipping.`);
        return;
      }
      const updateConfigParams = {
        ...configData,
        ...targetKeyAndPreviousVersion,
      };

      if (updateConfigParams.previousVersion === targetOrbVersion) {
        d(`orb version unchanged - skipping PR body update`);
        continue;
      }

      d(`updating orb version to ${targetOrbVersion}`);
      updateConfigFile(orbTarget, targetOrbVersion, updateConfigParams);

      d(`orb version changed - updating PR body`);
      const re = new RegExp('^Original-Version: (\\S+)', 'm');
      const prVersionText = re.exec(pr.body);

      if (!prVersionText || prVersionText.length === 0) {
        d('Could not find PR version text in existing PR - exiting');
        return;
      }

      await octokit.pulls.update({
        owner,
        repo,
        pull_number: pr.number,
        ...getOrbPRText(orbTarget, {
          previousVersion: updateConfigParams.previousVersion,
          newVersion: targetOrbVersion,
          branchName: defaultBranchName,
        }),
      });
    }
  } else {
    try {
      d(`roll triggered for  ${orbTarget.name}=${targetOrbVersion}`);

      try {
        await octokit.git.getRef({ owner, repo, ref: shortRef });
        d(`Ref ${ref} already exists`);
      } catch {
        d(`Creating ref=${ref} at sha=${defaultBranchHeadSha}`);
        await octokit.git.createRef({ owner, repo, ref, sha: defaultBranchHeadSha });
      }

      const configData = await getCircleConfigFile();
      const targetKeyAndPreviousVersion = getTargetKeyAndPreviousVersion(configData.yaml);

      // if any of the above are null, we can't proceed
      if (!targetKeyAndPreviousVersion) {
        d(`updateConfigParams not complete - skipping.`);
        await octokit.git.deleteRef({ owner, repo, ref: shortRef });
        return;
      }

      const updateConfigParams = {
        ...configData,
        ...targetKeyAndPreviousVersion,
      };

      if (updateConfigParams.previousVersion === targetOrbVersion) {
        d(`orb version unchanged - skipping PR body update`);
        await octokit.git.deleteRef({ owner, repo, ref: shortRef });
        return;
      }

      await updateConfigFile(orbTarget, targetOrbVersion, updateConfigParams);

      d(`Raising a PR for ${branchName} to ${repo}`);
      await octokit.pulls.create({
        ...repository,
        base: defaultBranchName,
        head: `${owner}:${branchName}`,
        ...getOrbPRText(orbTarget, {
          previousVersion: updateConfigParams.previousVersion,
          newVersion: targetOrbVersion,
          branchName: defaultBranchName,
        }),
      });
    } catch (e) {
      d(`Error rolling ${repository.owner}/${repository.repo} to ${targetOrbVersion}`, e);
    }
  }

  function getTargetKeyAndPreviousVersion(yaml) {
    const curr = yaml[ORB_KEY];
    // attempt to find the orb in .circleci/config.yml whos value includes `orbTarget.name`
    const targetKey: string = Object.entries(curr as string).find(([_, value]) =>
      value.startsWith(`${orbTarget.name}@`),
    )?.[0];

    if (!targetKey) {
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

  async function getCircleConfigFile() {
    const { data: githubFile } = await octokit.repos.getContent({
      owner,
      repo,
      path: filePath,
      ref: branchName,
    });

    if (!('content' in githubFile)) {
      throw new Error(`Incorrectly received array when fetching content for ${repo}`);
    }

    const rawContent = Buffer.from(githubFile.content, 'base64').toString();
    return {
      yaml: yamljs.parse(rawContent),
      githubFile,
      rawContent,
    };
  }

  async function updateConfigFile(
    orbTarget: OrbTarget,
    targetOrbVersion: string,
    updateConfigParams,
  ) {
    const { yaml, githubFile, rawContent, previousVersion, targetKey } = updateConfigParams;
    const currentValueRegex = new RegExp(`${orbTarget.name}@${previousVersion}`, 'g');
    const curr = yaml[ORB_KEY];
    let newYaml: string;

    // If there is exactly one occurrence of the target string, we can get away with
    // doing a simple string replacement and avoid any potential formatting issues,
    // otherwise we need to stringify the full config which might change formatting
    if ((rawContent.match(currentValueRegex) || []).length === 1) {
      newYaml = rawContent.replace(currentValueRegex, `${orbTarget.name}@${targetOrbVersion}`);
    } else {
      curr[targetKey] = `${orbTarget.name}@${targetOrbVersion}`;
      newYaml = yamljs.stringify(yaml);
    }
    d(`Updating the new ref with value=${targetOrbVersion}`);
    await octokit.repos.createOrUpdateFileContents({
      owner,
      repo,
      path: filePath,
      message: `chore: bump ${orbTarget.name} in .circleci/config.yml to ${targetOrbVersion}`,
      content: Buffer.from(newYaml).toString('base64'),
      branch: branchName,
      sha: githubFile.sha,
    });
  }
}
