import { createHash } from 'node:crypto';

import debug from 'debug';
import * as semver from 'semver';
import type { Octokit } from '@octokit/rest';

import { getContent } from './utils/github-utils.js';
import { getOctokit } from './utils/octokit.js';
import { MAIN_BRANCH, RBE_CREDENTIAL_HELPER, REPOS, ROLLER_BOT_LOGIN } from './constants.js';

export const RBE_CREDENTIAL_HELPER_BRANCH = `roller/rbe-credential-helper/${MAIN_BRANCH}`;

// Releases are cut by electron/rbe-credential-helper's release workflow with tags
// like `v1.2.3`. The tag is written into build-tools source, so it must match
// exactly before it is used.
const TAG_REGEX = /^v\d+\.\d+\.\d+$/;
const SHA256_REGEX = /^[0-9a-f]{64}$/;

// `const CREDENTIAL_HELPER_TAG = 'v0.6.3';`
const TAG_LINE_REGEX = /(const CREDENTIAL_HELPER_TAG = ')(v\d+\.\d+\.\d+)(';)/g;
// `  'darwin-amd64': '<sha256>',` inside `CREDENTIAL_HELPER_SHA256`.
const hashLineRegex = (platform: string) =>
  new RegExp(`(['"]${platform}['"]:\\s*['"])([0-9a-f]{64})(['"])`, 'g');

// The release can be published before all of its assets have finished uploading,
// and the CDN can lag behind the blob upload, so both are polled with backoff.
const DEFAULT_RETRY_DELAYS_MS = [10_000, 20_000, 40_000, 80_000, 160_000];

export interface RbeCredentialHelperRelease {
  id: number;
  tag_name: string;
  html_url: string;
  draft: boolean;
  prerelease: boolean;
}

export interface RbeCredentialHelperRollOptions {
  retryDelaysMs?: number[];
}

export type PlatformHashes = Record<string, string>;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function isValidTag(tag: unknown): tag is string {
  return typeof tag === 'string' && TAG_REGEX.test(tag) && semver.valid(tag) !== null;
}

// Collects each platform's SHA-256 from the release asset digests (`sha256:<hex>`).
// Returns the missing platforms instead when any asset is absent, still uploading,
// or has no digest.
export function hashesFromAssets(
  assets: { name: string; state?: string; digest?: string | null }[],
): { hashes: PlatformHashes; missing: string[] } {
  const hashes: PlatformHashes = {};
  const missing: string[] = [];

  for (const platform of RBE_CREDENTIAL_HELPER.platforms) {
    const asset = assets.find((a) => a.name === RBE_CREDENTIAL_HELPER.assetName(platform));
    const digest = asset?.digest?.startsWith('sha256:') ? asset.digest.slice(7) : null;
    if (!asset || asset.state !== 'uploaded' || !SHA256_REGEX.test(digest ?? '')) {
      missing.push(platform);
    } else {
      hashes[platform] = digest;
    }
  }

  return { hashes, missing };
}

// Reads the release back from the API until every platform asset has been
// uploaded with a digest. Returns null if they never all appear.
export async function getReleaseHashes(
  octokit: Octokit,
  release: RbeCredentialHelperRelease,
  retryDelaysMs: number[],
): Promise<PlatformHashes | null> {
  const d = debug('roller/rbe-credential-helper:getReleaseHashes');

  let missing: string[] = [];
  for (let attempt = 0; attempt <= retryDelaysMs.length; attempt++) {
    if (attempt > 0) {
      d(`Assets missing for ${missing.join(', ')}, retrying in ${retryDelaysMs[attempt - 1]}ms`);
      await sleep(retryDelaysMs[attempt - 1]);
    }

    const { data } = await octokit.rest.repos.getRelease({
      ...REPOS.rbeCredentialHelper,
      release_id: release.id,
    });

    if (data.tag_name !== release.tag_name || data.draft || data.prerelease) {
      console.error(`Release ${release.id} is no longer a published ${release.tag_name} release`);
      return null;
    }

    const result = hashesFromAssets(data.assets);
    if (result.missing.length === 0) {
      return result.hashes;
    }
    missing = result.missing;
  }

  console.error(
    `Release ${release.tag_name} is missing assets for ${missing.join(', ')} - not rolling`,
  );
  return null;
}

export function cdnUrl(tag: string, platform: string) {
  return `${RBE_CREDENTIAL_HELPER.cdnBaseUrl}/${tag}/${RBE_CREDENTIAL_HELPER.assetName(platform)}`;
}

async function fetchSha256(url: string): Promise<string | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const body = Buffer.from(await response.arrayBuffer());
    return createHash('sha256').update(body).digest('hex');
  } catch {
    return null;
  }
}

// build-tools downloads the helper from the CDN, not from the GitHub release, so
// every file it will fetch must be served and match the release's digest before
// a PR is opened. This is checked against two independent sources on purpose.
export async function verifyCdnHashes(
  tag: string,
  hashes: PlatformHashes,
  retryDelaysMs: number[],
): Promise<boolean> {
  const d = debug('roller/rbe-credential-helper:verifyCdnHashes');

  for (const platform of RBE_CREDENTIAL_HELPER.platforms) {
    const url = cdnUrl(tag, platform);
    let actual: string | null = null;

    for (let attempt = 0; attempt <= retryDelaysMs.length; attempt++) {
      if (attempt > 0) {
        d(
          `${url} not ready (got ${actual ?? 'an error'}), retrying in ${retryDelaysMs[attempt - 1]}ms`,
        );
        await sleep(retryDelaysMs[attempt - 1]);
      }
      actual = await fetchSha256(url);
      if (actual === hashes[platform]) break;
    }

    if (actual !== hashes[platform]) {
      console.error(
        `${url} does not match the release digest (want ${hashes[platform]}, got ${actual ?? 'an HTTP error'}) - not rolling`,
      );
      return false;
    }
    d(`${url} OK (${actual})`);
  }

  return true;
}

export function getCurrentTag(content: string): string | null {
  const matches = [...content.matchAll(TAG_LINE_REGEX)];
  return matches.length === 1 ? matches[0][2] : null;
}

// Rewrites the pinned tag and every platform hash. Returns null, rather than a
// partially updated file, if any of them is not found exactly once.
export function updateReclientSource(
  content: string,
  tag: string,
  hashes: PlatformHashes,
): string | null {
  if (!isValidTag(tag)) return null;

  const replaceOnce = (source: string, regex: RegExp, value: string) => {
    if ([...source.matchAll(regex)].length !== 1) return null;
    // A replacement function is used so that `value` is never interpreted as a
    // replacement pattern (e.g. `$&`).
    return source.replace(regex, (_, prefix, _old, suffix) => `${prefix}${value}${suffix}`);
  };

  let updated = replaceOnce(content, TAG_LINE_REGEX, tag);
  if (updated === null) {
    console.error(`Could not find CREDENTIAL_HELPER_TAG in ${RBE_CREDENTIAL_HELPER.filePath}`);
    return null;
  }

  for (const platform of RBE_CREDENTIAL_HELPER.platforms) {
    const hash = hashes[platform];
    if (!SHA256_REGEX.test(hash ?? '')) {
      console.error(`Invalid SHA-256 for ${platform}`);
      return null;
    }
    updated = replaceOnce(updated, hashLineRegex(platform), hash);
    if (updated === null) {
      console.error(`Could not find the ${platform} hash in ${RBE_CREDENTIAL_HELPER.filePath}`);
      return null;
    }
  }

  return updated;
}

async function readReclientSource(octokit: Octokit, ref: string) {
  const file = await getContent(octokit, {
    ...REPOS.buildTools,
    path: RBE_CREDENTIAL_HELPER.filePath,
    ref,
  });
  if (file === null) {
    throw new Error(`Could not fetch content for ${RBE_CREDENTIAL_HELPER.filePath} on ${ref}`);
  }
  return file;
}

// True when `ref` already pins `tag` or a newer release.
function isUpToDate(content: string, tag: string, ref: string) {
  const currentTag = getCurrentTag(content);
  if (!isValidTag(currentTag)) {
    console.error(`Could not find a valid CREDENTIAL_HELPER_TAG on ${ref}`);
    return { currentTag: null, upToDate: true };
  }
  return { currentTag, upToDate: semver.gte(currentTag, tag) };
}

function getPRText(release: RbeCredentialHelperRelease, previousTag: string) {
  const releaseLink = `https://github.com/${REPOS.rbeCredentialHelper.owner}/${REPOS.rbeCredentialHelper.repo}/releases/tag/${release.tag_name}`;
  return {
    title: `chore: bump rbe credential helper to ${release.tag_name}`,
    body: `Updates the RBE credential helper from ${previousTag} to [${release.tag_name}](${releaseLink}).

Each platform's SHA-256 is taken from the release asset digests, and was verified against the file served from the CDN before this PR was updated.`,
  };
}

export async function handleRbeCredentialHelperRelease(
  release: RbeCredentialHelperRelease,
  { retryDelaysMs = DEFAULT_RETRY_DELAYS_MS }: RbeCredentialHelperRollOptions = {},
) {
  const d = debug('roller/rbe-credential-helper:handleRbeCredentialHelperRelease');
  const { owner, repo } = REPOS.buildTools;
  const tag = release.tag_name;

  if (!isValidTag(tag)) {
    d(`Ignoring release with unexpected tag`);
    return;
  }
  if (release.draft || release.prerelease) {
    d(`Ignoring draft or prerelease ${tag}`);
    return;
  }

  const octokit = await getOctokit();

  const hashes = await getReleaseHashes(octokit, release, retryDelaysMs);
  if (!hashes) return;

  if (!(await verifyCdnHashes(tag, hashes, retryDelaysMs))) return;

  const { data: mainBranch } = await octokit.rest.repos.getBranch({
    owner,
    repo,
    branch: MAIN_BRANCH,
  });
  const mainSha = mainBranch.commit.sha;

  const main = await readReclientSource(octokit, mainSha);
  const { currentTag: mainTag, upToDate: mainUpToDate } = isUpToDate(
    main.content,
    tag,
    MAIN_BRANCH,
  );
  if (mainUpToDate) {
    d(`${owner}/${repo} already pins ${mainTag ?? 'an unknown tag'} - not rolling to ${tag}`);
    return;
  }

  // Look for an open roll PR from roller's own branch that can be updated instead.
  const { data: openPrs } = await octokit.rest.pulls.list({
    owner,
    repo,
    head: `${owner}:${RBE_CREDENTIAL_HELPER_BRANCH}`,
    state: 'open',
  });
  const pr = openPrs.find((p) => p.user?.login === ROLLER_BOT_LOGIN);

  if (pr) {
    d(`Found existing PR #${pr.number} - updating`);

    if (pr.labels?.some((label) => label.name === 'roller/pause')) {
      d(`Automatic updates have been paused for #${pr.number} - skipping`);
      return;
    }

    // Read from the branch being written to so the blob sha matches.
    const branch = await readReclientSource(octokit, RBE_CREDENTIAL_HELPER_BRANCH);
    const { currentTag: branchTag, upToDate } = isUpToDate(
      branch.content,
      tag,
      RBE_CREDENTIAL_HELPER_BRANCH,
    );
    if (upToDate) {
      d(`#${pr.number} already pins ${branchTag ?? 'an unknown tag'} - skipping`);
      return;
    }

    const newContent = updateReclientSource(branch.content, tag, hashes);
    if (newContent === null) return;

    await octokit.rest.repos.createOrUpdateFileContents({
      owner,
      repo,
      path: RBE_CREDENTIAL_HELPER.filePath,
      message: `chore: bump rbe credential helper to ${tag}`,
      content: Buffer.from(newContent).toString('base64'),
      sha: branch.sha,
      branch: RBE_CREDENTIAL_HELPER_BRANCH,
    });

    await octokit.rest.pulls.update({
      owner,
      repo,
      pull_number: pr.number,
      ...getPRText(release, mainTag),
    });
    d(`Updated #${pr.number} to ${tag}`);
    return;
  }

  const newContent = updateReclientSource(main.content, tag, hashes);
  if (newContent === null) return;

  const shortRef = `heads/${RBE_CREDENTIAL_HELPER_BRANCH}`;
  let orphanRef = false;
  try {
    await octokit.rest.git.getRef({ owner, repo, ref: shortRef });
    orphanRef = true;
  } catch {
    // No ref left over from a previous roll.
  }

  if (orphanRef) {
    d(`Resetting orphan ref ${shortRef} with no open PR to ${mainSha}`);
    await octokit.rest.git.updateRef({ owner, repo, ref: shortRef, sha: mainSha, force: true });
  } else {
    d(`Creating refs/${shortRef} at ${mainSha}`);
    await octokit.rest.git.createRef({ owner, repo, ref: `refs/${shortRef}`, sha: mainSha });
  }

  // Committed through the API with the App's installation token, so GitHub signs
  // the commit as electron-roller[bot] (build-tools requires signed commits).
  await octokit.rest.repos.createOrUpdateFileContents({
    owner,
    repo,
    path: RBE_CREDENTIAL_HELPER.filePath,
    message: `chore: bump rbe credential helper to ${tag}`,
    content: Buffer.from(newContent).toString('base64'),
    sha: main.sha,
    branch: RBE_CREDENTIAL_HELPER_BRANCH,
  });

  const { data: created } = await octokit.rest.pulls.create({
    owner,
    repo,
    base: MAIN_BRANCH,
    head: `${owner}:${RBE_CREDENTIAL_HELPER_BRANCH}`,
    ...getPRText(release, mainTag),
  });
  d(`New PR: ${created.html_url}`);
}
