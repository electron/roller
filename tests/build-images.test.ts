import { handler } from '../src/index';
import { beforeEach, afterEach, describe, it, vi, expect } from 'vitest';
import * as buildImagesHandler from '../src/build-images-handler';
import { getOctokit } from '../src/utils/octokit';

import { Probot, ProbotOctokit } from 'probot';
import { MAIN_BRANCH } from '../src/constants';
const nock = require('nock');

const GH_API = 'https://api.github.com';
const INSTALLATION_ID = 123456;

const payloadJson = await import('./fixtures/publish_payload.json');
const branchName = `roller/build-images/${MAIN_BRANCH}`;

vi.mock('../src/utils/octokit');

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
        packages: {
          getAllPackageVersionsForPackageOwnedByOrg: vi.fn().mockResolvedValue({
            data: [
              {
                id: 395219211,
                created_at: '2025-04-14T14:53:47Z',
                metadata: {
                  container: {
                    tags: ['424eedbf277ad9749ffa9219068aa72ed4a5e373'],
                  },
                },
              },
              {
                id: 392728624,
                created_at: '2025-04-10T09:53:31Z',
                metadata: {
                  container: {
                    tags: ['bed562b00714c63080bda07af3f016cab4ba02fc'],
                  },
                },
              },
              {
                id: 382348549,
                created_at: '2025-03-26T14:17:04Z',
                metadata: {
                  container: {
                    tags: ['9f11982e806f439d0a0a8ebbbf566cd5e0d9e952'],
                  },
                },
              },
            ],
          }),
        },
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

  it('can get the previous target OID', async () => {
    const payload = JSON.parse(JSON.stringify(payloadJson));
    payload.registry_package.package_version.target_oid = 'newtargetoid123';

    const previousTargetOid = await buildImagesHandler.getPreviousTargetOid(payload);
    expect(previousTargetOid).toBe('424eedbf277ad9749ffa9219068aa72ed4a5e373');
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
    it('updates files that contain the previous OID', async () => {
      mockOctokit.rest.repos.getContent.mockImplementation(({ path }) => {
        if (path === '.github/workflows/linux-publish.yml') {
          return {
            data: {
              content: Buffer.from('image: ghcr.io/electron/build:oldsha123').toString('base64'),
              sha: 'linux-publishsha',
            },
          };
        } else {
          return {
            data: {
              content: Buffer.from('no matches here').toString('base64'),
              sha: 'file2sha',
            },
          };
        }
      });

      mockOctokit.rest.repos.createOrUpdateFileContents.mockResolvedValue({});

      const result = await buildImagesHandler.updateFilesWithNewOid(
        mockOctokit,
        ['.github/workflows/linux-publish.yml'],
        'oldsha123',
        'newsha456',
        branchName,
      );

      expect(result).toBe(true);
      expect(mockOctokit.rest.repos.getContent).toHaveBeenCalledTimes(1);
      expect(mockOctokit.rest.repos.createOrUpdateFileContents).toHaveBeenCalledTimes(1);
      expect(mockOctokit.rest.repos.createOrUpdateFileContents).toHaveBeenCalledWith(
        expect.objectContaining({
          path: '.github/workflows/linux-publish.yml',
          content: expect.any(String),
          sha: 'linux-publishsha',
          branch: branchName,
        }),
      );
    });

    it('returns false when no files need updating', async () => {
      mockOctokit.rest.repos.getContent.mockResolvedValue({
        data: {
          content: Buffer.from('no matches here').toString('base64'),
          sha: 'filesha',
        },
      });

      const result = await buildImagesHandler.updateFilesWithNewOid(
        mockOctokit,
        ['.github/workflows/linux-publish.yml'],
        'oldsha123',
        'newsha456',
        branchName,
      );

      expect(result).toBe(false);
      expect(mockOctokit.rest.repos.createOrUpdateFileContents).not.toHaveBeenCalled();
    });
  });

  describe('handleBuildImagesCheck', () => {
    it('creates a PR when files are updated', async () => {
      mockOctokit.rest.git.createRef.mockResolvedValue({});
      mockOctokit.rest.pulls.create.mockResolvedValue({
        data: { html_url: 'https://github.com/electron/electron/pull/123' },
      });

      mockOctokit.rest.repos.getContent.mockImplementation(() => {
        return {
          data: {
            content: Buffer.from(
              'image: ghcr.io/electron/build:424eedbf277ad9749ffa9219068aa72ed4a5e373',
            ).toString('base64'),
            sha: 'linux-publishsha',
          },
        };
      });

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

    it('skips PR creation when no files need updating', async () => {
      vi.spyOn(buildImagesHandler, 'getPreviousTargetOid').mockResolvedValue('oldsha123');

      vi.spyOn(buildImagesHandler, 'prepareGitBranch').mockResolvedValue({
        ref: `refs/heads/${branchName}`,
        shortRef: `heads/${branchName}`,
        branchName,
        sha: '1234567890abcdef',
      });

      vi.spyOn(buildImagesHandler, 'updateFilesWithNewOid').mockResolvedValue(false);

      const payload = JSON.parse(JSON.stringify(payloadJson));
      payload.registry_package.package_version.target_oid = 'newsha456';

      await buildImagesHandler.handleBuildImagesCheck(payload);

      expect(mockOctokit.rest.git.createRef).not.toHaveBeenCalled();
      expect(mockOctokit.rest.pulls.create).not.toHaveBeenCalled();
    });
  });
});
