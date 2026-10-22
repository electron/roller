import debug from 'debug';

import { Octokit } from '@octokit/rest';
import type { Context } from 'probot';

import { getContent } from './utils/github-utils.js';
import { getOctokit } from './utils/octokit.js';
import { MAIN_BRANCH, REPOS } from './constants.js';

// Each file that pins the build image, with a pattern whose first capture group
// is that file's current pin. Files are bumped independently, as they can drift
// apart (e.g. electron/electron#55200 bumped only the devcontainer).
const files = [
  {
    // `echo "build-image-sha=<oid>" >> "$GITHUB_OUTPUT"`. The `$OVERRIDE` branch
    // of the action is not hex and so is never matched.
    path: '.github/actions/build-image-sha/action.yml',
    pattern: /build-image-sha=([0-9a-f]{40})\b/,
  },
  {
    // `image: ghcr.io/electron/devcontainer:<oid>`
    path: '.devcontainer/docker-compose.yml',
    pattern: /ghcr\.io\/electron\/devcontainer:([0-9a-f]{40})\b/,
  },
];

type PinnedFile = (typeof files)[number];

// Git object IDs are 40-character lowercase hex strings. Any value taken from a
// webhook payload or package metadata must match this exactly before it is used
// to match against or rewrite file content, so that attacker-controlled tags
// cannot be interpreted as regular expressions or replacement patterns.
const OID_REGEX = /^[0-9a-f]{40}$/;

export function isValidOid(value: unknown): value is string {
  return typeof value === 'string' && OID_REGEX.test(value);
}

async function readFile(octokit: Octokit, file: PinnedFile, ref: string) {
  const content = await getContent(octokit, {
    ...REPOS.electron,
    path: file.path,
    ref,
  });

  if (content === null) {
    throw new Error(`Could not fetch content for ${file.path}`);
  }

  return content;
}

// Returns the file's current pin, or null if it has no well-formed OID pin.
function findOid(file: PinnedFile, content: string) {
  const oid = content.match(file.pattern)?.[1];
  return isValidOid(oid) ? oid : null;
}

export async function shouldUpdateFiles(octokit: Octokit, oid: string) {
  for (const file of files) {
    const { content } = await readFile(octokit, file, MAIN_BRANCH);
    if (findOid(file, content) !== oid) {
      return true;
    }
  }

  return false;
}

// Reads each file's current pin at `ref`, keyed by path. Returns null if any
// file lacks a valid pin, so that a roll never silently updates only some files.
export async function getCurrentOids(octokit: Octokit, ref: string) {
  const oids: Record<string, string> = {};

  for (const file of files) {
    const { content } = await readFile(octokit, file, ref);
    const oid = findOid(file, content);
    if (!oid) {
      console.error(`Could not find a valid build image SHA in ${file.path} on ${ref}`);
      return null;
    }
    oids[file.path] = oid;
  }

  return oids;
}

// Short form of the distinct pins being replaced, e.g. `424eedb and 9f11982`.
function describeOids(oids: Record<string, string>, targetOid: string) {
  return [...new Set(Object.values(oids))]
    .filter((oid) => oid !== targetOid)
    .map((oid) => oid.slice(0, 7))
    .join(' and ');
}

export async function updateFilesWithNewOid(
  octokit: Octokit,
  targetOid: string,
  branchName: string,
) {
  const d = debug(`roller/github:updateFilesWithNewOid`);
  let updatedAny = false;

  // Defense-in-depth: never substitute a value that is not a well-formed OID,
  // regardless of how this function is reached.
  if (!isValidOid(targetOid)) {
    d(`Refusing to update files with invalid OID`);
    return updatedAny;
  }

  for (const file of files) {
    try {
      // Read from the branch being written to so that both the content and the
      // blob sha match what `createOrUpdateFileContents` will update.
      const { content, sha } = await readFile(octokit, file, branchName);

      const currentOid = findOid(file, content);
      if (!currentOid) {
        d(`No valid OID found in ${file.path}`);
        continue;
      }

      if (currentOid === targetOid) {
        d(`${file.path} is already at ${targetOid}`);
        continue;
      }

      // `currentOid` and `targetOid` are validated 40-char hex OIDs. Use literal
      // substring matching and split/join so neither value is ever interpreted as
      // a regular expression or as a replacement pattern (e.g. `$&`, `$1`).
      d(`Updating ${file.path} from ${currentOid} to ${targetOid}`);
      const newContent = content.split(currentOid).join(targetOid);
      await octokit.rest.repos.createOrUpdateFileContents({
        ...REPOS.electron,
        path: file.path,
        content: Buffer.from(newContent).toString('base64'),
        message: `chore: bump build image tag in ${file.path} to ${targetOid.slice(0, 7)}`,
        sha,
        branch: branchName,
      });
      updatedAny = true;
    } catch (error) {
      d(`Failed to update ${file.path}: ${error.message}`);
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

    const currentOids = await getCurrentOids(octokit, branchName);
    if (!currentOids) {
      d(`Not updating PR #${pr.number}`);
      return;
    }

    if (Object.values(currentOids).every((currentOid) => currentOid === targetOid)) {
      d(`${branchName} is already at ${targetOid} - skipping PR update`);
      return;
    }

    d(`Preparing to update files with new OID: ${targetOid}`);
    const updatedFiles = await updateFilesWithNewOid(octokit, targetOid, branchName);

    if (!updatedFiles) {
      d('No files were updated, skipping PR update');
      return;
    }

    await octokit.rest.pulls.update({
      ...REPOS.electron,
      pull_number: pr.number,
      title: `chore: bump build image tag to ${oid}`,
      body: `This PR updates the build-images references from ${describeOids(
        currentOids,
        targetOid,
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

    // The new branch is created at `sha`, so read the current OIDs from there.
    const currentOids = await getCurrentOids(octokit, sha);
    if (!currentOids) {
      d('Not creating a PR');
      return;
    }

    d(`Creating ref=${ref} at sha=${sha}`);
    await octokit.rest.git.createRef({ ...REPOS.electron, ref, sha });

    d(`Preparing to update files with new OID: ${targetOid}`);
    await updateFilesWithNewOid(octokit, targetOid, branchName);

    d(`Raising a PR for ${branchName} to ${MAIN_BRANCH}`);
    const pr = await octokit.rest.pulls.create({
      ...REPOS.electron,
      base: MAIN_BRANCH,
      head: `${REPOS.electron.owner}:${branchName}`,
      title: `build: update build-images to ${targetOid.slice(0, 7)}`,
      body: `This PR updates the build-images references from ${describeOids(
        currentOids,
        targetOid,
      )} to ${targetOid.slice(0, 7)}.`,
    });

    d(`New PR: ${pr.data.html_url}`);
  }
}
