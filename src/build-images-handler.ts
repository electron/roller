import debug from 'debug';

import { Octokit } from '@octokit/rest';
import type { Context } from 'probot';

import { getContent } from './utils/github-utils.js';
import { getOctokit } from './utils/octokit.js';
import { MAIN_BRANCH, REPOS } from './constants.js';

// The first entry is the canonical location of the CI build image SHA and is
// what `shouldUpdateFiles` checks against.
const files = ['.github/actions/build-image-sha/action.yml', '.devcontainer/docker-compose.yml'];

// Git object IDs are 40-character lowercase hex strings. Any value taken from a
// webhook payload or package metadata must match this exactly before it is used
// to match against or rewrite file content, so that attacker-controlled tags
// cannot be interpreted as regular expressions or replacement patterns.
const OID_REGEX = /^[0-9a-f]{40}$/;

export function isValidOid(value: unknown): value is string {
  return typeof value === 'string' && OID_REGEX.test(value);
}

export async function shouldUpdateFiles(octokit: Octokit, oid: string) {
  const file = await getContent(octokit, {
    ...REPOS.electron,
    path: files[0],
  });

  if (file === null) {
    throw new Error(`Could not fetch content for ${files[0]}`);
  }

  // `oid` is a validated 40-char hex OID; use a literal substring check so the
  // value is never compiled into a regular expression.
  if (file.content.includes(oid)) {
    return false;
  }

  return true;
}

// Matches the hardcoded image SHA in the build-image-sha action, e.g.
// `echo "build-image-sha=<oid>" >> "$GITHUB_OUTPUT"`. The `$OVERRIDE` branch of
// the action is not hex and so is never matched.
const BUILD_IMAGE_SHA_REGEX = /build-image-sha=([0-9a-f]{40})\b/;

export async function getCurrentOid(octokit: Octokit, ref: string) {
  const file = await getContent(octokit, {
    ...REPOS.electron,
    path: files[0],
    ref,
  });

  if (file === null) {
    throw new Error(`Could not fetch content for ${files[0]}`);
  }

  const currentOid = file.content.match(BUILD_IMAGE_SHA_REGEX)?.[1];

  // Only accept a well-formed OID; otherwise it must not be used to match/rewrite files.
  if (!isValidOid(currentOid)) {
    return null;
  }

  return currentOid;
}

export async function updateFilesWithNewOid(
  octokit: Octokit,
  previousOid: string,
  targetOid: string,
  branchName: string,
) {
  const d = debug(`roller/github:updateFilesWithNewOid`);
  let updatedAny = false;

  // Defense-in-depth: never match against or substitute values that are not
  // well-formed OIDs, regardless of how this function is reached.
  if (!isValidOid(previousOid) || !isValidOid(targetOid)) {
    d(`Refusing to update files with invalid OID(s)`);
    return updatedAny;
  }

  for (const filePath of files) {
    try {
      // Read from the branch being written to so that both the content and the
      // blob sha match what `createOrUpdateFileContents` will update.
      const file = await getContent(octokit, {
        ...REPOS.electron,
        path: filePath,
        ref: branchName,
      });

      if (file === null) {
        throw new Error(`Could not fetch content for ${filePath}`);
      }

      // `previousOid` and `targetOid` are validated 40-char hex OIDs. Use literal
      // substring matching and split/join so neither value is ever interpreted as
      // a regular expression or as a replacement pattern (e.g. `$&`, `$1`).
      if (!file.content.includes(previousOid)) {
        d(`No match found for ${filePath}`);
        continue;
      }

      d(`Updating ${filePath} from ${previousOid} to ${targetOid}`);
      const newContent = file.content.split(previousOid).join(targetOid);
      await octokit.rest.repos.createOrUpdateFileContents({
        ...REPOS.electron,
        path: filePath,
        content: Buffer.from(newContent).toString('base64'),
        message: `chore: bump build image tag in ${filePath} to ${targetOid.slice(0, 7)}`,
        sha: file.sha,
        branch: branchName,
      });
      updatedAny = true;
    } catch (error) {
      d(`Failed to update ${filePath}: ${error.message}`);
    }
  }

  return updatedAny;
}

export async function prepareGitBranch(octokit: Octokit, branchName: string, mainBranch: string) {
  const d = debug(`roller/github:prepareGitBranch`);

  const { data: branch } = await octokit.rest.repos.getBranch({
    ...REPOS.electron,
    branch: mainBranch,
  });

  const sha = branch.commit.sha;
  const shortRef = `heads/${branchName}`;
  const ref = `refs/${shortRef}`;

  // Clean up any orphan refs
  d(`Checking that no orphan ref exists from a previous roll`);
  try {
    const maybeOldRef = await octokit.rest.git.getRef({ ...REPOS.electron, ref: shortRef });
    if (maybeOldRef.status === 200) {
      d(`Found orphan ref ${ref} with no open PR - deleting`);
      await octokit.rest.git.deleteRef({ ...REPOS.electron, ref: shortRef });
      await new Promise<void>((r) => setTimeout(r, 2000));
    }
  } catch (error) {
    d(`No orphan ref exists at ${ref} - proceeding, `, error);
  }

  return { ref, shortRef, branchName, sha };
}

export async function handleBuildImagesCheck(
  payload: Context<'registry_package.published'>['payload'],
) {
  const d = debug(`roller/github:handleBuildImagesCheck`);
  const octokit = await getOctokit();

  const { target_oid: targetOid } = payload.registry_package.package_version;

  // `target_oid` comes straight from the webhook payload and is written into
  // workflow file content. Refuse to proceed unless it is a well-formed OID.
  if (!isValidOid(targetOid)) {
    d(`Invalid target OID in payload, cannot proceed with updates`);
    return;
  }

  const branchName = `roller/build-images/${MAIN_BRANCH}`;

  // Look for a pre-existing PR that targets this branch to see if we can update that.
  const { data: prs } = await octokit.rest.pulls.list({
    ...REPOS.electron,
    head: `${REPOS.electron.owner}:${branchName}`,
    state: 'open',
  });

  if (prs.length > 0) {
    const pr = prs[0];
    const oid = targetOid.slice(0, 7);

    d(`Found existing PR: #${pr.number} opened by ${pr.user.login} - updating`);

    const previousOid = await getCurrentOid(octokit, branchName);
    if (!previousOid) {
      console.error(
        `Could not find a valid build-image-sha in ${files[0]} on ${branchName} - not updating PR #${pr.number}`,
      );
      return;
    }

    if (previousOid === targetOid) {
      d(`${branchName} is already at ${targetOid} - skipping PR update`);
      return;
    }

    d(`Preparing to update files with new OID: ${targetOid}`);
    const updatedFiles = await updateFilesWithNewOid(octokit, previousOid, targetOid, branchName);

    if (!updatedFiles) {
      d('No files were updated, skipping PR update');
      return;
    }

    await octokit.rest.pulls.update({
      ...REPOS.electron,
      pull_number: pr.number,
      title: `chore: bump build image tag to ${oid}`,
      body: `This PR updates the build-images references from ${previousOid.slice(
        0,
        7,
      )} to ${oid}.`,
    });
    return;
  } else {
    d(`No existing PR found for ${branchName} - creating a new one`);
    const { ref, sha } = await prepareGitBranch(octokit, branchName, MAIN_BRANCH);

    const shouldUpdate = await shouldUpdateFiles(octokit, targetOid);
    if (!shouldUpdate) {
      d('Build images are up to date - skipping PR creation');
      return;
    }

    // The new branch is created at `sha`, so read the current OID from there.
    const previousOid = await getCurrentOid(octokit, sha);
    if (!previousOid) {
      console.error(
        `Could not find a valid build-image-sha in ${files[0]} on ${MAIN_BRANCH} - not creating a PR`,
      );
      return;
    }

    d(`Creating ref=${ref} at sha=${sha}`);
    await octokit.rest.git.createRef({ ...REPOS.electron, ref, sha });

    d(`Preparing to update files with new OID: ${targetOid}`);
    await updateFilesWithNewOid(octokit, previousOid, targetOid, branchName);

    d(`Raising a PR for ${branchName} to ${MAIN_BRANCH}`);
    const pr = await octokit.rest.pulls.create({
      ...REPOS.electron,
      base: MAIN_BRANCH,
      head: `${REPOS.electron.owner}:${branchName}`,
      title: `build: update build-images to ${targetOid.slice(0, 7)}`,
      body: `This PR updates the build-images references from ${previousOid.slice(
        0,
        7,
      )} to ${targetOid.slice(0, 7)}.`,
    });

    d(`New PR: ${pr.data.html_url}`);
  }
}
