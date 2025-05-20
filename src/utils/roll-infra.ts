import * as debug from 'debug';

import { MAIN_BRANCH, REPOS } from '../constants';
import { getOctokit } from './octokit';
import { PullsListResponseItem } from '../types';
import { Octokit } from '@octokit/rest';
import { getInfraPRText } from './pr-text';
import { getFileContent } from './arc-image';

export async function rollInfra(
  rollKey: string,
  bumpSubject: string,
  newShortVersion: string,
  filePath: string,
  newContent: string,
): Promise<any> {
  const d = debug(`roller/infra/${rollKey}:rollInfra()`);
  const octokit = await getOctokit();

  const branchName = `roller/infra/${rollKey}`;
  const shortRef = `heads/${branchName}`;
  const ref = `refs/${shortRef}`;

  const { owner, repo } = REPOS.electronInfra;

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

  const prs = existingPrsForBranch.filter((pr) =>
    pr.title.startsWith(`build: bump ${bumpSubject}`),
  );

  const defaultBranchHeadSha = (
    await octokit.repos.getBranch({
      owner,
      repo,
      branch: MAIN_BRANCH,
    })
  ).data.commit.sha;

  if (prs.length) {
    // Update existing PR(s)
    for (const pr of prs) {
      d(`Found existing PR: #${pr.number} opened by ${pr.user.login}`);

      // Check to see if automatic infra roll has been temporarily disabled
      const hasPauseLabel = pr.labels.some((label) => label.name === 'roller/pause');
      if (hasPauseLabel) {
        d(`Automatic updates have been paused for #${pr.number}, skipping infra roll.`);
        continue;
      }

      d(`Attempting infra update for #${pr.number}`);
      const { raw: currentContent, sha: currentSha } = await getFileContent(
        octokit,
        filePath,
        pr.head.ref,
      );
      if (currentContent.trim() !== newContent.trim()) {
        await updateFile(
          octokit,
          bumpSubject,
          newShortVersion,
          filePath,
          newContent,
          branchName,
          currentSha,
        );
      }

      await octokit.pulls.update({
        owner,
        repo,
        pull_number: pr.number,
        ...getInfraPRText(bumpSubject, newShortVersion),
      });
    }
  } else {
    try {
      d(`roll triggered for ${bumpSubject}=${newShortVersion}`);

      try {
        await octokit.git.getRef({ owner, repo, ref: shortRef });
        d(`Ref ${ref} already exists, deleting`);
        await octokit.git.deleteRef({ owner, repo, ref: shortRef });
      } catch {
        // Ignore
      } finally {
        d(`Creating ref=${ref} at sha=${defaultBranchHeadSha}`);
        await octokit.git.createRef({ owner, repo, ref, sha: defaultBranchHeadSha });
      }

      const { sha: currentSha } = await getFileContent(octokit, filePath);

      await updateFile(
        octokit,
        bumpSubject,
        newShortVersion,
        filePath,
        newContent,
        branchName,
        currentSha,
      );

      d(`Raising a PR for ${branchName} to ${repo}`);
      await octokit.pulls.create({
        owner,
        repo,
        base: MAIN_BRANCH,
        head: `${owner}:${branchName}`,
        ...getInfraPRText(bumpSubject, newShortVersion),
      });
    } catch (e) {
      d(`Error rolling ${owner}/${repo} to ${newShortVersion}`, e);
    }
  }
}

async function updateFile(
  octokit: Octokit,
  bumpSubject: string,
  newShortVersion: string,
  filePath: string,
  newContent: string,
  branchName: string,
  currentSha: string,
) {
  await octokit.repos.createOrUpdateFileContents({
    ...REPOS.electronInfra,
    path: filePath,
    message: `build: bump ${bumpSubject} in ${filePath} to ${newShortVersion}`,
    content: Buffer.from(newContent).toString('base64'),
    branch: branchName,
    sha: currentSha,
  });
}
