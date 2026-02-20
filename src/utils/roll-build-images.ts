import debug from 'debug';

import { MAIN_BRANCH, REPOS } from '../constants';
import { getOctokit } from './octokit';
import { PullsListResponseItem } from '../types';
import { Octokit } from '@octokit/rest';

export async function getFileContentFromBuildImages(
  octokit: Octokit,
  filePath: string,
  ref = MAIN_BRANCH,
) {
  const { data } = await octokit.repos.getContent({
    ...REPOS.buildImages,
    path: filePath,
    ref,
  });
  if ('content' in data) {
    return { raw: Buffer.from(data.content, 'base64').toString('utf8'), sha: data.sha };
  }
  throw new Error(`Failed to get content for ${filePath}`);
}

function getBuildImagesPRText(bumpSubject: string, newShortVersion: string, diffLink: string) {
  return {
    title: `build: bump ${bumpSubject} to ${newShortVersion.substring(0, 12)}`,
    body: `Updating ${bumpSubject} to \`${newShortVersion}\`

See [changes in Chromium](${diffLink})`,
  };
}

export async function rollBuildImages(
  rollKey: string,
  bumpSubject: string,
  previousSha: string,
  newSha: string,
  filePath: string,
  newContent: string,
): Promise<any> {
  const d = debug(`roller/build-images/${rollKey}:rollBuildImages()`);
  const octokit = await getOctokit();

  const branchName = `roller/build-images/${rollKey}`;
  const shortRef = `heads/${branchName}`;
  const ref = `refs/${shortRef}`;

  const { owner, repo } = REPOS.buildImages;

  const diffLink =
    `https://chromium.googlesource.com/chromium/src/+log/` +
    `${previousSha}..${newSha}?n=10000&pretty=fuller`;

  // Look for a pre-existing PR that targets this branch to see if we can update that.
  let existingPrsForBranch: PullsListResponseItem[] = [];
  try {
    existingPrsForBranch = (await octokit.paginate('GET /repos/:owner/:repo/pulls', {
      head: `${owner}:${branchName}`,
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

      // Check to see if automatic roll has been temporarily disabled
      const hasPauseLabel = pr.labels.some((label) => label.name === 'roller/pause');
      if (hasPauseLabel) {
        d(`Automatic updates have been paused for #${pr.number}, skipping roll.`);
        continue;
      }

      d(`Attempting update for #${pr.number}`);
      const { raw: currentContent, sha: currentSha } = await getFileContentFromBuildImages(
        octokit,
        filePath,
        pr.head.ref,
      );
      if (currentContent.trim() !== newContent.trim()) {
        await updateFile(
          octokit,
          bumpSubject,
          newSha,
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
        ...getBuildImagesPRText(bumpSubject, newSha, diffLink),
      });
    }
  } else {
    try {
      d(`roll triggered for ${bumpSubject}=${newSha}`);

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

      const { sha: currentSha } = await getFileContentFromBuildImages(octokit, filePath);

      await updateFile(octokit, bumpSubject, newSha, filePath, newContent, branchName, currentSha);

      d(`Raising a PR for ${branchName} to ${repo}`);
      await octokit.pulls.create({
        owner,
        repo,
        base: MAIN_BRANCH,
        head: `${owner}:${branchName}`,
        ...getBuildImagesPRText(bumpSubject, newSha, diffLink),
      });
    } catch (e) {
      d(`Error rolling ${owner}/${repo} to ${newSha}`, e);
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
    ...REPOS.buildImages,
    path: filePath,
    message: `build: bump ${bumpSubject} in ${filePath} to ${newShortVersion.substring(0, 12)}`,
    content: Buffer.from(newContent).toString('base64'),
    branch: branchName,
    sha: currentSha,
  });
}
