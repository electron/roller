// Fetches the latest linux/amd64 and linux/arm64 images for actions/runner from GitHub Container Registry

import { Octokit } from '@octokit/rest';

const OWNER = 'actions';
const PACKAGE = 'actions-runner';

type PackageVersion = {
  metadata?: {
    container?: {
      tags?: string[];
    };
  };
};

type ManifestPlatform = {
  os?: string;
  architecture?: string;
};

type Manifest = {
  platform?: ManifestPlatform;
  digest: string;
};

type ManifestList = {
  manifests?: Manifest[];
};

export async function getLatestRunnerImages(
  octokit: Octokit,
): Promise<{ archDigests: Record<string, string>; latestVersion: string } | null> {
  let versions: PackageVersion[];
  try {
    const response = await octokit.rest.packages.getAllPackageVersionsForPackageOwnedByOrg({
      package_type: 'container',
      package_name: PACKAGE,
      org: OWNER,
      per_page: 10,
    });
    versions = response.data as PackageVersion[];
  } catch (e) {
    console.error('Failed to fetch package versions:', e);
    return null;
  }

  // Find the version with the 'latest' tag
  const latestVersion = versions.find((v) => v.metadata?.container?.tags?.includes('latest'));
  const tags = latestVersion?.metadata?.container?.tags || [];
  // Find the first tag that matches a semver version (e.g., 2.315.0)
  const tagVersion = tags.find((t) => /^\d+\.\d+\.\d+$/.test(t));

  if (!latestVersion || !tagVersion) {
    console.error("No version with the 'latest' tag found; tags were:", tags);
    return null;
  }

  // Fetch the manifest list for the latest tag
  const manifestUrl = `https://ghcr.io/v2/${OWNER}/${PACKAGE}/manifests/${tagVersion}`;
  const manifestHeaders = {
    'User-Agent': 'node.js',
    Accept: 'application/vnd.oci.image.index.v1+json',
    Authorization: 'Bearer QQ==',
  };
  let manifestList: ManifestList;
  try {
    const manifestResponse = await fetch(manifestUrl, {
      headers: manifestHeaders,
    });
    if (!manifestResponse.ok) {
      throw new Error(`Failed to fetch manifest list: ${manifestResponse.statusText}`);
    }
    manifestList = await manifestResponse.json();
  } catch (e) {
    console.error('Failed to fetch manifest list:', e);
    return null;
  }

  // Find digests for linux/amd64 and linux/arm64
  const archDigests: Record<string, string> = {};
  for (const manifest of manifestList.manifests || []) {
    const platform = manifest.platform;
    if (
      platform?.os === 'linux' &&
      (platform.architecture === 'amd64' || platform.architecture === 'arm64')
    ) {
      archDigests[platform.architecture] = `${tagVersion}@${manifest.digest}`;
    }
  }

  if (!archDigests.amd64 && !archDigests.arm64) {
    console.error('No linux/amd64 or linux/arm64 digests found in manifest list.');
    return null;
  }
  return {
    archDigests,
    latestVersion: tagVersion,
  };
}
