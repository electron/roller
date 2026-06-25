import debug from 'debug';

import { Octokit } from '@octokit/rest';
import type { Context } from 'probot';

import { getContent } from './utils/github-utils.js';
import { getOctokit } from './utils/octokit.js';
import { MAIN_BRANCH, REPOS } from './constants.js';

const files = [
  '.github/workflows/clean-src-cache.yml',
  '.github/workflows/build.yml',
  '.github/workflows/linux-publish.yml',
  '.github/workflows/macos-publish.yml',
  '.github/workflows/windows-publish.yml',
  '.github/workflows/build.yml',
  '.devcontainer/docker-compose.yml',
];

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

export async function getPreviousOid(payload: Context<'registry_package.published'>['payload']) {
  const { registry_package, organization } = payload;
  const { target_oid } = registry_package.package_version;
  const { name } = registry_package;

  try {
    const octokit = await getOctokit();
    const { data: packages } =
      await octokit.rest.packages.getAllPackageVersionsForPackageOwnedByOrg({
        org: organization.login,
        package_type: 'container',
        package_name: name,
        direction: 'desc',
      });

    const previousPackage = packages.find(({ metadata }) => {
      return metadata.container.tags[0] !== target_oid;
    });

    const previousTag = previousPackage?.metadata.container.tags[0];

    // The tag is attacker-influenceable package metadata. Only accept it if it
    // is a well-formed OID; otherwise it must not be used to match/rewrite files.
    if (!isValidOid(previousTag)) {
      return null;
    }

    return previousTag;
  } catch (error) {
    console.error('Error fetching previous target_oid:', error);
    return null;
  }
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
      const file = await getContent(octokit, {
        ...REPOS.electron,
        path: filePath,
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

  const previousOid = await getPreviousOid(payload);

  if (!previousOid) {
    d('No previous target OID found, cannot proceed with updates');
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
