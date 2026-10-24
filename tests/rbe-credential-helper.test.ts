import { createHash } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MAIN_BRANCH, ROLLER_BOT_LOGIN } from '../src/constants.js';
import {
  RBE_CREDENTIAL_HELPER_BRANCH,
  cdnUrl,
  getCurrentTag,
  handleRbeCredentialHelperRelease,
  updateReclientSource,
} from '../src/rbe-credential-helper-handler.js';
import { getContent } from '../src/utils/github-utils.js';
import { getOctokit } from '../src/utils/octokit.js';

vi.mock('../src/utils/github-utils.js');
vi.mock('../src/utils/octokit.js');

const PLATFORMS = [
  'darwin-amd64',
  'darwin-arm64',
  'linux-amd64',
  'linux-arm64',
  'windows-amd64',
  'windows-arm64',
];

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

// The shape of electron/build-tools' src/utils/reclient.ts around the pin.
const reclientSource = (
  tag: string,
  hashes: Record<string, string>,
) => `const RBE_SERVICE_ADDRESS = 'rbe.notgoma.com:443';

const CREDENTIAL_HELPER_TAG = '${tag}';
const CREDENTIAL_HELPER_SHA256: Record<string, string> = {
${PLATFORMS.map((p) => `  '${p}': '${hashes[p]}',`).join('\n')}
};

export let usingRemote = true;
`;

const OLD_TAG = 'v0.6.3';
const NEW_TAG = 'v0.7.0';
const OLD_HASHES = Object.fromEntries(PLATFORMS.map((p) => [p, sha256(`old-${p}`)]));
// The CDN serves `new-<platform>` for each tarball of the new release.
const NEW_HASHES = Object.fromEntries(PLATFORMS.map((p) => [p, sha256(`new-${p}`)]));

const release = {
  id: 42,
  tag_name: NEW_TAG,
  html_url: `https://github.com/electron/rbe-credential-helper/releases/tag/${NEW_TAG}`,
  draft: false,
  prerelease: false,
};

const assetsFor = (hashes: Record<string, string>, platforms = PLATFORMS) =>
  platforms.map((p) => ({
    name: `electron-rbe-credential-helper-${p}.tar.gz`,
    state: 'uploaded',
    digest: `sha256:${hashes[p]}`,
  }));

const opts = { retryDelaysMs: [0, 0] };

describe('rbe-credential-helper', () => {
  let mockOctokit: any;
  let cdnBodies: Record<string, string>;

  const mockFiles = (files: Record<string, string>) => {
    vi.mocked(getContent).mockImplementation(async (_, options) => {
      const content = files[options.ref];
      return content === undefined ? null : { content, sha: `blob-${options.ref}` };
    });
  };

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    mockOctokit = {
      rest: {
        repos: {
          getRelease: vi.fn().mockResolvedValue({
            data: { ...release, assets: assetsFor(NEW_HASHES) },
          }),
          getBranch: vi.fn().mockResolvedValue({ data: { commit: { sha: 'main-sha' } } }),
          createOrUpdateFileContents: vi.fn(),
        },
        git: {
          getRef: vi.fn().mockRejectedValue(new Error('Not Found')),
          createRef: vi.fn(),
          updateRef: vi.fn(),
        },
        pulls: {
          list: vi.fn().mockResolvedValue({ data: [] }),
          create: vi.fn().mockResolvedValue({
            data: { html_url: 'https://github.com/electron/build-tools/pull/1' },
          }),
          update: vi.fn(),
        },
      },
    };
    vi.mocked(getOctokit).mockResolvedValue(mockOctokit);

    cdnBodies = Object.fromEntries(PLATFORMS.map((p) => [cdnUrl(NEW_TAG, p), `new-${p}`]));
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url in cdnBodies
          ? new Response(cdnBodies[url], { status: 200 })
          : new Response('Not Found', { status: 404 }),
      ),
    );

    mockFiles({ 'main-sha': reclientSource(OLD_TAG, OLD_HASHES) });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.mocked(console.error).mockRestore();
  });

  const committedContent = () =>
    Buffer.from(
      mockOctokit.rest.repos.createOrUpdateFileContents.mock.calls[0][0].content,
      'base64',
    ).toString();

  describe('updateReclientSource', () => {
    it('rewrites the tag and every platform hash', () => {
      const result = updateReclientSource(reclientSource(OLD_TAG, OLD_HASHES), NEW_TAG, NEW_HASHES);

      expect(result).toEqual(reclientSource(NEW_TAG, NEW_HASHES));
      expect(getCurrentTag(result)).toBe(NEW_TAG);
    });

    it('returns null when a platform hash is not in the file', () => {
      const source = reclientSource(OLD_TAG, OLD_HASHES).replace(/ {2}'windows-arm64'.*\n/, '');

      expect(updateReclientSource(source, NEW_TAG, NEW_HASHES)).toBeNull();
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('windows-arm64'));
    });

    it('returns null when the tag is not in the file', () => {
      const source = reclientSource(OLD_TAG, OLD_HASHES).replace('CREDENTIAL_HELPER_TAG', 'TAG');

      expect(updateReclientSource(source, NEW_TAG, NEW_HASHES)).toBeNull();
    });

    it('refuses a tag that is not a plain version', () => {
      const source = reclientSource(OLD_TAG, OLD_HASHES);

      expect(updateReclientSource(source, "v1.0.0'; evil()", NEW_HASHES)).toBeNull();
    });
  });

  describe('handleRbeCredentialHelperRelease', () => {
    it('opens a PR bumping the tag and hashes when the CDN matches the release', async () => {
      await handleRbeCredentialHelperRelease(release, opts);

      expect(mockOctokit.rest.repos.getRelease).toHaveBeenCalledWith(
        expect.objectContaining({
          owner: 'electron',
          repo: 'rbe-credential-helper',
          release_id: 42,
        }),
      );
      for (const p of PLATFORMS) {
        expect(fetch).toHaveBeenCalledWith(
          `https://dev-cdn-experimental.electronjs.org/reclient/credential-helper/${NEW_TAG}/electron-rbe-credential-helper-${p}.tar.gz`,
        );
      }

      expect(mockOctokit.rest.git.createRef).toHaveBeenCalledWith({
        owner: 'electron',
        repo: 'build-tools',
        ref: `refs/heads/${RBE_CREDENTIAL_HELPER_BRANCH}`,
        sha: 'main-sha',
      });
      expect(mockOctokit.rest.repos.createOrUpdateFileContents).toHaveBeenCalledWith(
        expect.objectContaining({
          owner: 'electron',
          repo: 'build-tools',
          path: 'src/utils/reclient.ts',
          sha: 'blob-main-sha',
          branch: RBE_CREDENTIAL_HELPER_BRANCH,
          message: `chore: bump rbe credential helper to ${NEW_TAG}`,
        }),
      );
      expect(committedContent()).toEqual(reclientSource(NEW_TAG, NEW_HASHES));
      expect(mockOctokit.rest.pulls.create).toHaveBeenCalledWith(
        expect.objectContaining({
          owner: 'electron',
          repo: 'build-tools',
          base: MAIN_BRANCH,
          head: `electron:${RBE_CREDENTIAL_HELPER_BRANCH}`,
          title: `chore: bump rbe credential helper to ${NEW_TAG}`,
          body: expect.stringContaining(`from ${OLD_TAG} to [${NEW_TAG}]`),
        }),
      );
    });

    it('waits for assets that are still uploading', async () => {
      mockOctokit.rest.repos.getRelease
        .mockResolvedValueOnce({
          data: { ...release, assets: assetsFor(NEW_HASHES, PLATFORMS.slice(0, 2)) },
        })
        .mockResolvedValueOnce({ data: { ...release, assets: assetsFor(NEW_HASHES) } });

      await handleRbeCredentialHelperRelease(release, opts);

      expect(mockOctokit.rest.repos.getRelease).toHaveBeenCalledTimes(2);
      expect(mockOctokit.rest.pulls.create).toHaveBeenCalled();
    });

    it('does not open a PR when a platform asset is missing from the release', async () => {
      mockOctokit.rest.repos.getRelease.mockResolvedValue({
        data: { ...release, assets: assetsFor(NEW_HASHES, PLATFORMS.slice(0, 5)) },
      });

      await handleRbeCredentialHelperRelease(release, opts);

      expect(mockOctokit.rest.repos.getRelease).toHaveBeenCalledTimes(3);
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('windows-arm64'));
      expect(fetch).not.toHaveBeenCalled();
      expect(mockOctokit.rest.repos.createOrUpdateFileContents).not.toHaveBeenCalled();
      expect(mockOctokit.rest.pulls.create).not.toHaveBeenCalled();
    });

    it('does not open a PR when an asset has no digest', async () => {
      const assets = assetsFor(NEW_HASHES);
      assets[0].digest = null;
      mockOctokit.rest.repos.getRelease.mockResolvedValue({ data: { ...release, assets } });

      await handleRbeCredentialHelperRelease(release, opts);

      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('darwin-amd64'));
      expect(mockOctokit.rest.pulls.create).not.toHaveBeenCalled();
    });

    it('does not open a PR when a CDN file does not match the release digest', async () => {
      cdnBodies[cdnUrl(NEW_TAG, 'linux-arm64')] = 'something else';

      await handleRbeCredentialHelperRelease(release, opts);

      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining(cdnUrl(NEW_TAG, 'linux-arm64')),
      );
      expect(mockOctokit.rest.git.createRef).not.toHaveBeenCalled();
      expect(mockOctokit.rest.repos.createOrUpdateFileContents).not.toHaveBeenCalled();
      expect(mockOctokit.rest.pulls.create).not.toHaveBeenCalled();
    });

    it('does not open a PR when a CDN file is missing', async () => {
      delete cdnBodies[cdnUrl(NEW_TAG, 'windows-amd64')];

      await handleRbeCredentialHelperRelease(release, opts);

      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('an HTTP error'));
      expect(mockOctokit.rest.pulls.create).not.toHaveBeenCalled();
    });

    it.each([
      ['already at', NEW_TAG],
      ['newer than', 'v0.8.0'],
    ])('does nothing when build-tools is %s the release', async (_, mainTag) => {
      mockFiles({ 'main-sha': reclientSource(mainTag, NEW_HASHES) });

      await handleRbeCredentialHelperRelease(release, opts);

      expect(mockOctokit.rest.pulls.list).not.toHaveBeenCalled();
      expect(mockOctokit.rest.git.createRef).not.toHaveBeenCalled();
      expect(mockOctokit.rest.repos.createOrUpdateFileContents).not.toHaveBeenCalled();
      expect(mockOctokit.rest.pulls.create).not.toHaveBeenCalled();
    });

    it('updates the existing roll PR from the roll branch', async () => {
      mockOctokit.rest.pulls.list.mockResolvedValue({
        data: [{ number: 7, user: { login: ROLLER_BOT_LOGIN }, labels: [] }],
      });
      mockFiles({
        'main-sha': reclientSource(OLD_TAG, OLD_HASHES),
        [RBE_CREDENTIAL_HELPER_BRANCH]: reclientSource('v0.6.4', OLD_HASHES),
      });

      await handleRbeCredentialHelperRelease(release, opts);

      expect(mockOctokit.rest.pulls.list).toHaveBeenCalledWith(
        expect.objectContaining({
          owner: 'electron',
          repo: 'build-tools',
          head: `electron:${RBE_CREDENTIAL_HELPER_BRANCH}`,
          state: 'open',
        }),
      );
      expect(mockOctokit.rest.repos.createOrUpdateFileContents).toHaveBeenCalledWith(
        expect.objectContaining({
          sha: `blob-${RBE_CREDENTIAL_HELPER_BRANCH}`,
          branch: RBE_CREDENTIAL_HELPER_BRANCH,
        }),
      );
      expect(committedContent()).toEqual(reclientSource(NEW_TAG, NEW_HASHES));
      expect(mockOctokit.rest.pulls.update).toHaveBeenCalledWith(
        expect.objectContaining({
          pull_number: 7,
          title: `chore: bump rbe credential helper to ${NEW_TAG}`,
          body: expect.stringContaining(`from ${OLD_TAG} to [${NEW_TAG}]`),
        }),
      );
      expect(mockOctokit.rest.git.createRef).not.toHaveBeenCalled();
      expect(mockOctokit.rest.pulls.create).not.toHaveBeenCalled();
    });

    it('does not update an existing roll PR that already has the release', async () => {
      mockOctokit.rest.pulls.list.mockResolvedValue({
        data: [{ number: 7, user: { login: ROLLER_BOT_LOGIN }, labels: [] }],
      });
      mockFiles({
        'main-sha': reclientSource(OLD_TAG, OLD_HASHES),
        [RBE_CREDENTIAL_HELPER_BRANCH]: reclientSource(NEW_TAG, NEW_HASHES),
      });

      await handleRbeCredentialHelperRelease(release, opts);

      expect(mockOctokit.rest.repos.createOrUpdateFileContents).not.toHaveBeenCalled();
      expect(mockOctokit.rest.pulls.update).not.toHaveBeenCalled();
    });

    it('does not trust an open PR on the roll branch opened by someone else', async () => {
      mockOctokit.rest.pulls.list.mockResolvedValue({
        data: [{ number: 8, user: { login: 'someone-else' }, labels: [] }],
      });
      mockOctokit.rest.git.getRef.mockResolvedValue({ status: 200 });

      await handleRbeCredentialHelperRelease(release, opts);

      expect(mockOctokit.rest.pulls.update).not.toHaveBeenCalled();
      expect(mockOctokit.rest.git.updateRef).toHaveBeenCalledWith(
        expect.objectContaining({
          ref: `heads/${RBE_CREDENTIAL_HELPER_BRANCH}`,
          sha: 'main-sha',
          force: true,
        }),
      );
      expect(mockOctokit.rest.git.createRef).not.toHaveBeenCalled();
      expect(mockOctokit.rest.pulls.create).toHaveBeenCalled();
    });

    it('ignores a release whose tag is not a plain version', async () => {
      await handleRbeCredentialHelperRelease({ ...release, tag_name: 'nightly' }, opts);

      expect(getOctokit).not.toHaveBeenCalled();
    });
  });
});
