import handler from '../src/index.js';
import { beforeEach, afterEach, describe, it, vi, expect } from 'vitest';
import * as buildImagesHandler from '../src/build-images-handler.js';
import { getContent } from '../src/utils/github-utils.js';
import { getOctokit } from '../src/utils/octokit.js';

import { Probot, ProbotOctokit } from 'probot';
import { MAIN_BRANCH } from '../src/constants.js';
import { randomBytes } from 'node:crypto';
import nock from 'nock';

const GH_API = 'https://api.github.com';
const INSTALLATION_ID = 123456;

const payloadJson = await import('./fixtures/publish_payload.json');
const branchName = `roller/build-images/${MAIN_BRANCH}`;

vi.mock('../src/utils/github-utils.js');
vi.mock('../src/utils/octokit.js');

describe('build-images', () => {
  let probot: Probot;
  let mockOctokit: any;

  beforeEach(() => {
    nock.disableNetConnect();

    nock(GH_API)
      .post(`/app/installations/${INSTALLATION_ID}/access_tokens`)
      .reply(200, {
        token: 'test_token',
        permissions: {
          checks: 'write',
        },
      });

    probot = new Probot({
      githubToken: 'test_token',
      Octokit: ProbotOctokit.defaults((instanceOptions: any) => {
        return {
          ...instanceOptions,
          retry: { enabled: false },
          throttle: { enabled: false },
        };
      }),
    });

    probot.load(handler);

    mockOctokit = {
      paginate: vi.fn(),
      rest: {
        repos: {
          getBranch: vi.fn().mockReturnValue({
            data: {
              name: MAIN_BRANCH,
              commit: {
                sha: '1234',
              },
            },
          }),
          getContent: vi.fn(),
          createOrUpdateFileContents: vi.fn(),
        },
        git: {
          getRef: vi.fn().mockReturnValue({ status: 404 }),
          deleteRef: vi.fn(),
          createRef: vi.fn(),
        },
        pulls: {
          create: vi.fn(),
          update: vi.fn(),
          list: vi.fn().mockResolvedValue({
            data: [],
          }),
        },
      },
    };

    vi.mocked(getOctokit).mockResolvedValue(mockOctokit);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('does not trigger build-images workflow for a non-build package', async () => {
    vi.spyOn(buildImagesHandler, 'handleBuildImagesCheck');

    const payload = JSON.parse(JSON.stringify(payloadJson));
    payload.registry_package.name = 'test';

    await probot.receive({
      id: '123',
      name: 'registry_package',
      payload,
    });

    expect(buildImagesHandler.handleBuildImagesCheck).not.toHaveBeenCalled();
  });

  it('triggers build-images workflow for a build package', async () => {
    vi.spyOn(buildImagesHandler, 'handleBuildImagesCheck');

    const payload = JSON.parse(JSON.stringify(payloadJson));

    await probot.receive({
      id: '123',
      name: 'registry_package',
      payload,
    });

    expect(buildImagesHandler.handleBuildImagesCheck).toHaveBeenCalled();
  });

  describe('getCurrentOids', () => {
    const oid = '424eedbf277ad9749ffa9219068aa72ed4a5e373';
    const devcontainerOid = '9f11982e806f439d0a0a8ebbbf566cd5e0d9e952';
    const actionContent = [
      'if [ -n "$OVERRIDE" ]; then',
      '  echo "build-image-sha=$OVERRIDE" >> "$GITHUB_OUTPUT"',
      'else',
      `  echo "build-image-sha=${oid}" >> "$GITHUB_OUTPUT"`,
      'fi',
    ].join('\n');

    const mockFiles = (action: string, devcontainer: string) => {
      vi.mocked(getContent).mockImplementation(async (_, options) => {
        if (options?.path === '.github/actions/build-image-sha/action.yml') {
          return { content: action, sha: 'action-sha' };
        }
        return { content: devcontainer, sha: 'devcontainer-sha' };
      });
    };

    beforeEach(() => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
      vi.mocked(console.error).mockRestore();
    });

    it("reads each file's own pin on the given ref", async () => {
      mockFiles(actionContent, `    image: ghcr.io/electron/devcontainer:${devcontainerOid}\n`);

      const result = await buildImagesHandler.getCurrentOids(mockOctokit, branchName);

      expect(result).toEqual({
        '.github/actions/build-image-sha/action.yml': oid,
        '.devcontainer/docker-compose.yml': devcontainerOid,
      });
      expect(getContent).toHaveBeenCalledWith(
        mockOctokit,
        expect.objectContaining({
          path: '.github/actions/build-image-sha/action.yml',
          ref: branchName,
        }),
      );
      expect(getContent).toHaveBeenCalledWith(
        mockOctokit,
        expect.objectContaining({ path: '.devcontainer/docker-compose.yml', ref: branchName }),
      );
    });

    it.each([
      ['is missing', 'echo "build-image-sha=$OVERRIDE" >> "$GITHUB_OUTPUT"'],
      ['is too short', 'echo "build-image-sha=424eedb" >> "$GITHUB_OUTPUT"'],
      ['is too long', `echo "build-image-sha=${oid}0" >> "$GITHUB_OUTPUT"`],
      ['is not lowercase hex', `echo "build-image-sha=${oid.toUpperCase()}" >> "$GITHUB_OUTPUT"`],
    ])('returns null when the build image SHA %s', async (_, content) => {
      mockFiles(content, `image: ghcr.io/electron/devcontainer:${devcontainerOid}`);

      const result = await buildImagesHandler.getCurrentOids(mockOctokit, branchName);

      expect(result).toBeNull();
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('.github/actions/build-image-sha/action.yml'),
      );
    });

    it('returns null when the devcontainer has no pin', async () => {
      mockFiles(actionContent, 'image: ghcr.io/electron/devcontainer:latest');

      const result = await buildImagesHandler.getCurrentOids(mockOctokit, branchName);

      expect(result).toBeNull();
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('.devcontainer/docker-compose.yml'),
      );
    });
  });

  describe('prepareGitBranch', () => {
    it('successfully prepares a git branch', async () => {
      mockOctokit.rest.repos.getBranch.mockResolvedValue({
        data: { commit: { sha: '1234567890abcdef' } },
      });

      mockOctokit.rest.git.getRef.mockRejectedValue(new Error('Not Found'));

      const result = await buildImagesHandler.prepareGitBranch(
        mockOctokit,
        branchName,
        MAIN_BRANCH,
      );

      expect(result).toEqual({
        ref: `refs/heads/${branchName}`,
        shortRef: `heads/${branchName}`,
        branchName,
        sha: '1234567890abcdef',
      });

      expect(mockOctokit.rest.repos.getBranch).toHaveBeenCalledWith(
        expect.objectContaining({ branch: MAIN_BRANCH }),
      );
      expect(mockOctokit.rest.git.getRef).toHaveBeenCalled();
      expect(mockOctokit.rest.git.deleteRef).not.toHaveBeenCalled();
    });

    it('deletes existing branch before creating new one', async () => {
      mockOctokit.rest.repos.getBranch.mockResolvedValue({
        data: { commit: { sha: '1234567890abcdef' } },
      });

      mockOctokit.rest.git.getRef.mockResolvedValue({
        status: 200,
        data: { object: { sha: 'oldshavalue' } },
      });

      mockOctokit.rest.git.deleteRef.mockResolvedValue({});

      const result = await buildImagesHandler.prepareGitBranch(
        mockOctokit,
        branchName,
        MAIN_BRANCH,
      );

      expect(mockOctokit.rest.git.deleteRef).toHaveBeenCalled();
      expect(result.sha).toBe('1234567890abcdef');
    });
  });

  describe('updateFilesWithNewOid', () => {
    it('updates each file from its own pin and skips files already at the target', async () => {
      const previousOid = '424eedbf277ad9749ffa9219068aa72ed4a5e373';
      const targetOid = 'bed562b00714c63080bda07af3f016cab4ba02fc';

      vi.mocked(getContent).mockImplementation(async (_, options) => {
        if (options?.path === '.github/actions/build-image-sha/action.yml') {
          return {
            content: `echo "build-image-sha=${previousOid}" >> "$GITHUB_OUTPUT"`,
            sha: 'action-sha',
          };
        } else {
          return {
            content: `image: ghcr.io/electron/devcontainer:${targetOid}`,
            sha: 'file2sha',
          };
        }
      });

      mockOctokit.rest.repos.createOrUpdateFileContents.mockResolvedValue({});

      const result = await buildImagesHandler.updateFilesWithNewOid(
        mockOctokit,
        targetOid,
        branchName,
      );

      expect(result).toBe(true);
      expect(getContent).toHaveBeenCalledTimes(2);
      expect(getContent).toHaveBeenCalledWith(
        mockOctokit,
        expect.objectContaining({
          path: '.github/actions/build-image-sha/action.yml',
          ref: branchName,
        }),
      );
      expect(getContent).toHaveBeenCalledWith(
        mockOctokit,
        expect.objectContaining({ path: '.devcontainer/docker-compose.yml', ref: branchName }),
      );
      expect(mockOctokit.rest.repos.createOrUpdateFileContents).toHaveBeenCalledTimes(1);
      expect(mockOctokit.rest.repos.createOrUpdateFileContents).toHaveBeenCalledWith(
        expect.objectContaining({
          path: '.github/actions/build-image-sha/action.yml',
          content: Buffer.from(`echo "build-image-sha=${targetOid}" >> "$GITHUB_OUTPUT"`).toString(
            'base64',
          ),
          sha: 'action-sha',
          branch: branchName,
        }),
      );
    });

    it('returns false when no files need updating', async () => {
      vi.mocked(getContent).mockResolvedValue({
        content: 'no matches here',
        sha: 'filesha',
      });

      const result = await buildImagesHandler.updateFilesWithNewOid(
        mockOctokit,
        'bed562b00714c63080bda07af3f016cab4ba02fc',
        branchName,
      );

      expect(result).toBe(false);
      expect(mockOctokit.rest.repos.createOrUpdateFileContents).not.toHaveBeenCalled();
    });

    it('refuses to update files when given an OID that is not a valid hex object ID', async () => {
      vi.mocked(getContent).mockResolvedValue({
        content: 'jobs:\n  build:\n    runs-on: ubuntu-latest\n',
        sha: 'filesha',
      });

      // A crafted container tag containing replacement patterns must never be
      // written into file content.
      const result = await buildImagesHandler.updateFilesWithNewOid(
        mockOctokit,
        '$& malicious replacement',
        branchName,
      );

      expect(result).toBe(false);
      expect(getContent).not.toHaveBeenCalled();
      expect(mockOctokit.rest.repos.createOrUpdateFileContents).not.toHaveBeenCalled();
    });
  });

  describe('shouldUpdateFiles', () => {
    const oid = '424eedbf277ad9749ffa9219068aa72ed4a5e373';
    const staleOid = 'bed562b00714c63080bda07af3f016cab4ba02fc';

    const mockFiles = (actionOid: string, devcontainerOid: string) => {
      vi.mocked(getContent).mockImplementation(async (_, options) => {
        if (options?.path === '.github/actions/build-image-sha/action.yml') {
          return {
            content: `echo "build-image-sha=${actionOid}" >> "$GITHUB_OUTPUT"`,
            sha: 'action-sha',
          };
        }
        return {
          content: `image: ghcr.io/electron/devcontainer:${devcontainerOid}`,
          sha: 'devcontainer-sha',
        };
      });
    };

    it('returns false when every file on main is at the OID', async () => {
      mockFiles(oid, oid);

      const result = await buildImagesHandler.shouldUpdateFiles(mockOctokit, oid);

      expect(result).toBe(false);
      expect(getContent).toHaveBeenCalledWith(
        mockOctokit,
        expect.objectContaining({
          path: '.github/actions/build-image-sha/action.yml',
          ref: MAIN_BRANCH,
        }),
      );
      expect(getContent).toHaveBeenCalledWith(
        mockOctokit,
        expect.objectContaining({ path: '.devcontainer/docker-compose.yml', ref: MAIN_BRANCH }),
      );
    });

    it('returns true when the action does not reference the OID', async () => {
      mockFiles(staleOid, oid);

      const result = await buildImagesHandler.shouldUpdateFiles(mockOctokit, oid);

      expect(result).toBe(true);
    });

    it('returns true when only the devcontainer is stale', async () => {
      mockFiles(oid, staleOid);

      const result = await buildImagesHandler.shouldUpdateFiles(mockOctokit, oid);

      expect(result).toBe(true);
    });
  });

  describe('handleBuildImagesCheck', () => {
    const targetOid = 'f61ed670557184b30a582b7701eee3e9f57a55a3';
    const actionPath = '.github/actions/build-image-sha/action.yml';
    const devcontainerPath = '.devcontainer/docker-compose.yml';

    const mockFiles = (actionContent: string, devcontainerContent: string) => {
      vi.mocked(getContent).mockImplementation(async (_, options) => {
        if (options?.path === actionPath) {
          return { content: actionContent, sha: 'action-sha' };
        }
        return { content: devcontainerContent, sha: 'devcontainer-sha' };
      });
    };

    const actionFor = (oid: string) => `echo "build-image-sha=${oid}" >> "$GITHUB_OUTPUT"`;
    const devcontainerFor = (oid: string) => `image: ghcr.io/electron/devcontainer:${oid}`;

    beforeEach(() => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
      vi.mocked(console.error).mockRestore();
    });

    it('creates a PR when files are updated', async () => {
      const previousOid = '424eedbf277ad9749ffa9219068aa72ed4a5e373';

      mockOctokit.rest.git.createRef.mockResolvedValue({});
      mockOctokit.rest.pulls.create.mockResolvedValue({
        data: { html_url: 'https://github.com/electron/electron/pull/123' },
      });

      mockOctokit.rest.pulls.list.mockResolvedValue({ data: [] });

      mockFiles(actionFor(previousOid), devcontainerFor(previousOid));

      const payload = JSON.parse(JSON.stringify(payloadJson));
      await buildImagesHandler.handleBuildImagesCheck(payload);

      expect(mockOctokit.rest.git.createRef).toHaveBeenCalledWith(
        expect.objectContaining({
          ref: `refs/heads/${branchName}`,
          sha: '1234',
          owner: 'electron',
          repo: 'electron',
        }),
      );

      // The previous OID is read from the commit the new branch is created at.
      expect(getContent).toHaveBeenCalledWith(
        mockOctokit,
        expect.objectContaining({ path: actionPath, ref: '1234' }),
      );

      expect(mockOctokit.rest.repos.createOrUpdateFileContents).toHaveBeenCalledTimes(2);
      expect(mockOctokit.rest.repos.createOrUpdateFileContents).toHaveBeenCalledWith(
        expect.objectContaining({
          path: actionPath,
          content: Buffer.from(actionFor(targetOid)).toString('base64'),
          sha: 'action-sha',
          branch: branchName,
        }),
      );
      expect(mockOctokit.rest.repos.createOrUpdateFileContents).toHaveBeenCalledWith(
        expect.objectContaining({
          path: devcontainerPath,
          content: Buffer.from(devcontainerFor(targetOid)).toString('base64'),
          sha: 'devcontainer-sha',
          branch: branchName,
        }),
      );

      expect(mockOctokit.rest.pulls.create).toHaveBeenCalledWith(
        expect.objectContaining({
          base: 'main',
          body: 'This PR updates the build-images references from 424eedb to f61ed67.',
          head: `electron:${branchName}`,
          owner: 'electron',
          repo: 'electron',
          title: 'build: update build-images to f61ed67',
        }),
      );
    });

    it('bumps each file from its own pin when the files have drifted apart', async () => {
      // Neither OID is the previous package version's tag in the registry, and
      // the devcontainer holds a different OID than the action.
      const actionOid = '9f11982e806f439d0a0a8ebbbf566cd5e0d9e952';
      const devcontainerOid = 'bed562b00714c63080bda07af3f016cab4ba02fc';

      mockOctokit.rest.git.createRef.mockResolvedValue({});
      mockOctokit.rest.pulls.create.mockResolvedValue({
        data: { html_url: 'https://github.com/electron/electron/pull/123' },
      });

      mockFiles(actionFor(actionOid), devcontainerFor(devcontainerOid));

      const payload = JSON.parse(JSON.stringify(payloadJson));
      await buildImagesHandler.handleBuildImagesCheck(payload);

      expect(mockOctokit.rest.repos.createOrUpdateFileContents).toHaveBeenCalledTimes(2);
      expect(mockOctokit.rest.repos.createOrUpdateFileContents).toHaveBeenCalledWith(
        expect.objectContaining({
          path: actionPath,
          content: Buffer.from(actionFor(targetOid)).toString('base64'),
          branch: branchName,
        }),
      );
      expect(mockOctokit.rest.repos.createOrUpdateFileContents).toHaveBeenCalledWith(
        expect.objectContaining({
          path: devcontainerPath,
          content: Buffer.from(devcontainerFor(targetOid)).toString('base64'),
          branch: branchName,
        }),
      );
      expect(mockOctokit.rest.pulls.create).toHaveBeenCalledWith(
        expect.objectContaining({
          body: 'This PR updates the build-images references from 9f11982 and bed562b to f61ed67.',
        }),
      );
    });

    it.each([
      [
        'the build image SHA is missing',
        'echo "build-image-sha=$OVERRIDE" >> "$GITHUB_OUTPUT"',
        devcontainerFor('424eedbf277ad9749ffa9219068aa72ed4a5e373'),
        actionPath,
      ],
      [
        'the build image SHA is invalid',
        'echo "build-image-sha=424eedb" >> "$GITHUB_OUTPUT"',
        devcontainerFor('424eedbf277ad9749ffa9219068aa72ed4a5e373'),
        actionPath,
      ],
      [
        'the devcontainer has no pin',
        actionFor('424eedbf277ad9749ffa9219068aa72ed4a5e373'),
        'image: ghcr.io/electron/devcontainer:latest',
        devcontainerPath,
      ],
    ])('does not create a PR when %s', async (_, actionContent, devcontainerContent, path) => {
      mockFiles(actionContent, devcontainerContent);

      const payload = JSON.parse(JSON.stringify(payloadJson));
      await buildImagesHandler.handleBuildImagesCheck(payload);

      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining(`Could not find a valid build image SHA in ${path}`),
      );
      expect(mockOctokit.rest.git.createRef).not.toHaveBeenCalled();
      expect(mockOctokit.rest.repos.createOrUpdateFileContents).not.toHaveBeenCalled();
      expect(mockOctokit.rest.pulls.create).not.toHaveBeenCalled();
    });

    it('updates an existing PR using the OID and files from the roll branch', async () => {
      const branchOid = 'bed562b00714c63080bda07af3f016cab4ba02fc';

      mockOctokit.rest.pulls.list.mockResolvedValue({
        data: [{ number: 42, user: { login: 'electron-roller[bot]' } }],
      });

      mockFiles(actionFor(branchOid), devcontainerFor(branchOid));

      const payload = JSON.parse(JSON.stringify(payloadJson));
      await buildImagesHandler.handleBuildImagesCheck(payload);

      expect(getContent).toHaveBeenCalledTimes(4);
      for (const call of vi.mocked(getContent).mock.calls) {
        expect(call[1]).toEqual(expect.objectContaining({ ref: branchName }));
      }

      expect(mockOctokit.rest.repos.createOrUpdateFileContents).toHaveBeenCalledWith(
        expect.objectContaining({
          path: actionPath,
          content: Buffer.from(actionFor(targetOid)).toString('base64'),
          sha: 'action-sha',
          branch: branchName,
        }),
      );
      expect(mockOctokit.rest.pulls.update).toHaveBeenCalledWith(
        expect.objectContaining({
          pull_number: 42,
          title: 'chore: bump build image tag to f61ed67',
          body: 'This PR updates the build-images references from bed562b to f61ed67.',
        }),
      );
      expect(mockOctokit.rest.git.createRef).not.toHaveBeenCalled();
      expect(mockOctokit.rest.pulls.create).not.toHaveBeenCalled();
    });

    it('does not update an existing PR when the build image SHA is missing', async () => {
      mockOctokit.rest.pulls.list.mockResolvedValue({
        data: [{ number: 42, user: { login: 'electron-roller[bot]' } }],
      });

      mockFiles('no sha here', devcontainerFor('bed562b00714c63080bda07af3f016cab4ba02fc'));

      const payload = JSON.parse(JSON.stringify(payloadJson));
      await buildImagesHandler.handleBuildImagesCheck(payload);

      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining(`Could not find a valid build image SHA in ${actionPath}`),
      );
      expect(mockOctokit.rest.repos.createOrUpdateFileContents).not.toHaveBeenCalled();
      expect(mockOctokit.rest.pulls.update).not.toHaveBeenCalled();
    });

    it('skips PR creation when no files need updating', async () => {
      const newSha = randomBytes(20).toString('hex');

      mockOctokit.rest.pulls.list.mockResolvedValue({ data: [] });
      mockFiles(actionFor(newSha), devcontainerFor(newSha));

      const payload = JSON.parse(JSON.stringify(payloadJson));
      payload.registry_package.package_version.target_oid = newSha;

      await buildImagesHandler.handleBuildImagesCheck(payload);

      expect(mockOctokit.rest.git.createRef).not.toHaveBeenCalled();
      expect(mockOctokit.rest.repos.createOrUpdateFileContents).not.toHaveBeenCalled();
      expect(mockOctokit.rest.pulls.create).not.toHaveBeenCalled();
    });
  });
});
