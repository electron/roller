import debug from 'debug';

import { getOctokit } from './utils/octokit';
import { RegistryPackagePublishedEvent } from '@octokit/webhooks-types';
import { MAIN_BRANCH, REPOS } from './constants';
import { Octokit } from '@octokit/rest';

const files = [
  '.github/workflows/clean-src-cache.yml',
  '.github/workflows/build.yml',
  '.github/workflows/linux-publish.yml',
  '.github/workflows/macos-publish.yml',
  '.github/workflows/windows-publish.yml',
  '.github/workflows/build.yml',
  '.devcontainer/docker-compose.yml',
];

export async function shouldUpdateFiles(octokit: Octokit, oid: string) {
  const { data: file } = await octokit.rest.repos.getContent({
    ...REPOS.electron,
    path: files[0],
  });

  if (!('content' in file)) {
    throw new Error(`Incorrectly received array when fetching content for ${files[0]}`);
  }

  const fileContent = Buffer.from(file.content, 'base64').toString('utf-8');
  const match = fileContent.match(oid);
  if (match?.[0] === oid) {
    return false;
  }

  return true;
}

export async function getPreviousOid(payload: RegistryPackagePublishedEvent) {
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

    return previousPackage.metadata.container.tags[0] || null;
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

  for (const filePath of files) {
    try {
      const { data: file } = await octokit.rest.repos.getContent({
        ...REPOS.electron,
        path: filePath,
      });

      if (!('content' in file)) {
        throw new Error(`Incorrectly received array when fetching content for ${filePath}`);
      }

      const fileContent = Buffer.from(file.content, 'base64').toString('utf-8');
      const match = fileContent.match(previousOid);
      if (!match) {
        d(`No match found for ${filePath}`);
        continue;
      }

      d(`Updating ${filePath} from ${match[0]} to ${targetOid}`);
      const newContent = fileContent.replace(match[0], targetOid);
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

export async function handleBuildImagesCheck(payload: RegistryPackagePublishedEvent) {
  const d = debug(`roller/github:handleBuildImagesCheck`);
  const octokit = await getOctokit();

  const { target_oid: targetOid } = payload.registry_package.package_version;
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
