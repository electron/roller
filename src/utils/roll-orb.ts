import * as debug from 'debug';
import * as yaml from 'yaml';

import { MAIN_BRANCH, ORB_KEY } from '../constants';
import { getOctokit } from './octokit';
import { getOrbPRText } from './pr-text-orb';
import { PullsListResponseItem } from '../types';

// Rolls an orb in a .circleci/config.yml file to a new version
export async function rollOrb({ orbTarget, sha, targetValue, repository }): Promise<any> {
  const d = debug(`roller/orb/${orbTarget.name}:rollOrb()`);
  const github = await getOctokit();

  const filePath = '.circleci/config.yml';
  const branchName = `roller/orb/${orbTarget.name}/${MAIN_BRANCH}`;
  const shortRef = `heads/${branchName}`;
  const ref = `refs/${shortRef}`;
  const { owner, repo } = repository;

  const { data } = await github.repos.getContent({
    owner,
    repo,
    path: filePath,
    ref: MAIN_BRANCH,
  });

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

      const previousVersion = await updateConfigFile(orbTarget, targetValue);

      if (previousVersion === targetValue) {
        d(`orb version unchanged - skipping PR body update`);
        continue;
      }

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
          previousVersion,
          newVersion: targetValue,
          branchName: MAIN_BRANCH,
        }),
      });
    }
  } else {
    try {
      d(`roll triggered for  ${orbTarget.name}=${targetValue}`);

      if (!('content' in data)) return;

      try {
        await github.git.getRef({ owner, repo, ref: shortRef });
        d(`Ref ${ref} already exists`);
      } catch {
        d(`Creating ref=${ref} at sha=${sha}`);
        await github.git.createRef({ owner, repo, ref, sha });
      }

      const previousVersion = await updateConfigFile(orbTarget, targetValue);

      d(`Raising a PR for ${branchName} to ${repo}`);
      await github.pulls.create({
        ...repository,
        base: MAIN_BRANCH,
        head: `${owner}:${branchName}`,
        ...getOrbPRText(orbTarget, {
          previousVersion,
          newVersion: targetValue,
          branchName: MAIN_BRANCH,
        }),
      });
    } catch (e) {
      d(`Error rolling ${repository.owner}/${repository.repo} to ${targetValue}`, e);
    }
  }

  async function updateConfigFile(rollTarget, targetValue) {
    const { data: localData } = await github.repos.getContent({
      owner,
      repo,
      path: filePath,
      ref: MAIN_BRANCH,
    });

    if ('type' in localData && 'content' in localData && localData.type == 'file') {
      const content = Buffer.from(localData.content, 'base64').toString();
      const yamlData = yaml.parse(content);
      const curr = yamlData[ORB_KEY];

      // attempt to find the orb in .circleci/config.yml whos value includes `orbTarget.name`
      const targetKey = Object.entries(curr as string).find(([_, value]) =>
        value.startsWith(`${rollTarget.name}@`),
      )?.[0];

      if (targetKey === undefined) {
        d(`Key for ${rollTarget.name} not found - skipping.`);
        return;
      }

      const previousValue = curr[targetKey];
      const previousVersion = previousValue.split('@')[1];
      if (targetValue === previousVersion) {
        d(`No roll needed - ${rollTarget.name} is already at ${targetValue}`);
        return previousVersion;
      }
      const currentValueRegex = new RegExp(`${rollTarget.name}@${previousVersion}`, 'g');
      let newYamlData: string;
      // If there is exactly one occurrence of the target string, we can get away with
      // doing a simple string replacement and avoid any potential formatting issues,
      // otherwise we need to stringify the full config which might change formatting
      if ((content.match(currentValueRegex) || []).length === 1) {
        newYamlData = content.replace(currentValueRegex, `${rollTarget.name}@${targetValue}`);
      } else {
        curr[targetKey] = `${rollTarget.name}@${targetValue}`;
        newYamlData = yaml.stringify(yamlData);
      }
      d(`Updating the new ref with value=${targetValue}`);
      await github.repos.createOrUpdateFileContents({
        owner,
        repo,
        path: filePath,
        message: `chore: bump ${rollTarget.name} in .circleci/config.yml to ${targetValue}`,
        content: Buffer.from(newYamlData).toString('base64'),
        branch: branchName,
        sha: localData.sha,
      });

      return previousVersion;
    }
  }
}
