import { MAIN_BRANCH, REPOS, ROLL_TARGETS } from '../src/constants';
import { handleChromiumCheck, handleNodeCheck, getSupportedBranches } from '../src/handlers';
import { getChromiumReleases } from '../src/utils/get-chromium-tags';
import { getOctokit } from '../src/utils/octokit';
import { roll } from '../src/utils/roll';

jest.mock('../src/utils/get-chromium-tags');
jest.mock('../src/utils/octokit');
jest.mock('../src/utils/roll');

describe('handleChromiumCheck()', () => {
  let mockOctokit: any;

  beforeEach(() => {
    mockOctokit = {
      paginate: jest.fn(),
      repos: {
        listBranches: {
          endpoint: {
            merge: jest.fn(),
          },
        },
        getContent: jest.fn(),
        get: jest.fn(),
        getBranch: jest.fn().mockReturnValue({
          data: {
            name: MAIN_BRANCH,
            commit: {
              sha: '1234',
            },
          },
        }),
      },
    };
    (getOctokit as jest.Mock).mockReturnValue(mockOctokit);
  });

  describe('release branches', () => {
    beforeEach(() => {
      mockOctokit.paginate.mockReturnValue([
        {
          name: '4-0-x',
          commit: {
            sha: '1234',
          },
        },
      ]);

      mockOctokit.repos.getContent.mockReturnValue({
        data: {
          content: Buffer.from(`${ROLL_TARGETS.chromium.depsKey}':\n    '1.0.0.0',`),
          sha: '1234',
        },
      });
      (getChromiumReleases as jest.Mock).mockReturnValue([
        {
          time: 1577869261000,
          version: '1.1.0.0',
          milestone: 1,
          channel: 'Stable',
          platform: 'Windows',
        },
        {
          time: 1577869261003,
          version: '2.1.0.0',
          milestone: 2,
          channel: 'Beta',
          platform: 'Windows',
        },
        {
          time: 1577869261002,
          version: '1.2.0.0',
          milestone: 1,
          channel: 'Stable',
          platform: 'Mac',
        },
      ]);
    });

    it('properly fetches supported versions of Electron to roll against', async () => {
      mockOctokit.paginate.mockReturnValue([
        {
          name: '10-x-y',
          commit: {
            sha: '1234',
          },
        },
        {
          name: '9-x-y',
          commit: {
            sha: '1234',
          },
        },
        {
          name: '8-x-y',
          commit: {
            sha: '1234',
          },
        },
        {
          name: '7-1-x',
          commit: {
            sha: '1234',
          },
        },
        {
          name: '7-0-x',
          commit: {
            sha: '1234',
          },
        },
        {
          name: '6-1-x',
          commit: {
            sha: '1234',
          },
        },
        {
          name: '6-0-x',
          commit: {
            sha: '1234',
          },
        },
        {
          name: '5-0-x',
          commit: {
            sha: '1234',
          },
        },
        {
          name: MAIN_BRANCH,
          commit: {
            sha: '1234',
          },
        },
      ]);

      const branches: { name: string }[] = await mockOctokit.paginate(
        mockOctokit.repos.listBranches.endpoint.merge({
          ...REPOS.electron,
          protected: true,
        }),
      );

      const supported = getSupportedBranches(branches);
      expect(supported).toEqual(['7-1-x', '8-x-y', '9-x-y', '10-x-y']);
    });

    it('rolls with latest versions from release tags', async () => {
      await handleChromiumCheck();

      expect(roll).toHaveBeenCalledWith(
        expect.objectContaining({
          rollTarget: ROLL_TARGETS.chromium,
          targetVersion: '1.2.0.0',
        }),
      );
    });

    it('takes no action if no new minor/build/patch available', async () => {
      mockOctokit.repos.getContent.mockReturnValue({
        data: {
          content: Buffer.from(`${ROLL_TARGETS.chromium.depsKey}':\n    '1.5.0.0',`),
          sha: '1234',
        },
      });

      await handleChromiumCheck();

      expect(roll).not.toHaveBeenCalled();
    });

    it('fails if DEPS version invalid', async () => {
      mockOctokit.repos.getContent.mockReturnValue({
        data: {
          content: Buffer.from(`${ROLL_TARGETS.chromium.depsKey}':\n    'someCommitSha',`),
          sha: '1234',
        },
      });

      expect.assertions(2);

      try {
        await handleChromiumCheck();
      } catch (e) {
        expect(roll).not.toBeCalled();
        expect(e.message).toMatch('One or more upgrade checks failed - see logs for more details');
      }
    });
  });

  describe('main branch', () => {
    beforeEach(() => {
      mockOctokit.paginate.mockReturnValue([
        {
          name: MAIN_BRANCH,
          commit: {
            sha: '1234',
          },
        },
      ]);

      mockOctokit.repos.getContent.mockReturnValue({
        data: {
          content: Buffer.from(`${ROLL_TARGETS.chromium.depsKey}':\n    '1.1.0.0',`),
          sha: '1234',
        },
      });
    });

    it('updates to main', async () => {
      (getChromiumReleases as jest.Mock).mockReturnValue([
        {
          time: 1577869261000,
          version: '1.1.0.0',
          milestone: 1,
          channel: 'Stable',
          platform: 'Windows',
        },
        {
          time: 1577869261003,
          version: '2.1.0.0',
          milestone: 2,
          channel: 'Canary',
          platform: 'Windows',
        },
        {
          time: 1577869261002,
          version: '1.2.0.0',
          milestone: 1,
          channel: 'Stable',
          platform: 'Mac',
        },
      ]);

      await handleChromiumCheck();

      expect(roll).toHaveBeenCalledWith(
        expect.objectContaining({
          rollTarget: ROLL_TARGETS.chromium,
          targetVersion: '2.1.0.0',
        }),
      );
    });

    it('takes no action if main is already in DEPS', async () => {
      (getChromiumReleases as jest.Mock).mockReturnValue([
        {
          time: 1577869261000,
          version: '1.1.0.0',
          milestone: 1,
          channel: 'Canary',
          platform: 'Windows',
        },
        {
          time: 1577869261001,
          version: '1.1.0.0',
          milestone: 1,
          channel: 'Canary',
          platform: 'Mac',
        },
      ]);

      await handleChromiumCheck();

      expect(roll).not.toHaveBeenCalled();
    });
  });

  it('throws error if roll() process failed', async () => {
    mockOctokit.paginate.mockReturnValue([
      {
        name: '4-0-x',
        commit: {
          sha: '1234',
        },
      },
    ]);

    mockOctokit.repos.getContent.mockReturnValue({
      data: {
        content: Buffer.from(`${ROLL_TARGETS.chromium.depsKey}':\n    '1.0.0.0',`),
        sha: '1234',
      },
    });
    (getChromiumReleases as jest.Mock).mockReturnValue([
      {
        time: 1577869261000,
        version: '1.1.0.0',
        milestone: 1,
        channel: 'Stable',
        platform: 'Windows',
      },
      {
        time: 1577869261003,
        version: '2.1.0.0',
        milestone: 2,
        channel: 'Beta',
        platform: 'Windows',
      },
      {
        time: 1577869261002,
        version: '1.2.0.0',
        milestone: 1,
        channel: 'Stable',
        platform: 'Mac',
      },
    ]);

    (roll as jest.Mock).mockImplementationOnce(() => {
      throw new Error('');
    });
    await expect(handleChromiumCheck()).rejects.toThrowError(
      `One or more upgrade checks failed - see logs for more details`,
    );
    expect(roll).toHaveBeenCalled();
  });
});

describe('handleNodeCheck()', () => {
  let mockOctokit: any;

  beforeEach(() => {
    mockOctokit = {
      repos: {
        getBranch: jest.fn().mockReturnValue({
          data: {
            name: MAIN_BRANCH,
            commit: {
              sha: '1234',
            },
          },
        }),
        listReleases: jest.fn().mockReturnValue({
          data: [
            {
              tag_name: 'v11.2.0',
            },
            {
              tag_name: 'v12.0.0',
            },
            {
              tag_name: 'v12.1.0',
            },
            {
              tag_name: 'v12.2.0',
            },
          ],
        }),
        getContent: jest.fn(),
      },
    };
    (getOctokit as jest.Mock).mockReturnValue(mockOctokit);
  });

  it('rolls even major versions of Node.js with latest minor/patch update', async () => {
    mockOctokit.repos.getContent.mockReturnValue({
      data: {
        content: Buffer.from(`${ROLL_TARGETS.node.depsKey}':\n    'v12.0.0',`),
        sha: '1234',
      },
    });
    await handleNodeCheck();

    expect(roll).toHaveBeenCalledWith({
      rollTarget: ROLL_TARGETS.node,
      electronBranch: expect.objectContaining({
        name: MAIN_BRANCH,
      }),
      targetVersion: 'v12.2.0',
    });
  });

  it('does not roll for uneven major versions of Node.js', async () => {
    mockOctokit.repos.getContent.mockReturnValue({
      data: {
        content: Buffer.from(`${ROLL_TARGETS.node.depsKey}':\n    'v11.0.0',`),
        sha: '1234',
      },
    });
    await handleNodeCheck();

    expect(roll).not.toHaveBeenCalled();
  });

  it('does not roll if no newer release found', async () => {
    mockOctokit.repos.getContent.mockReturnValue({
      data: {
        content: Buffer.from(`${ROLL_TARGETS.node.depsKey}':\n    'v12.2.0',`),
        sha: '1234',
      },
    });
    await handleNodeCheck();

    expect(roll).not.toHaveBeenCalled();
  });

  it('throws error if roll() process failed', async () => {
    mockOctokit.repos.getContent.mockReturnValue({
      data: {
        content: Buffer.from(`${ROLL_TARGETS.node.depsKey}':\n    'v12.0.0',`),
        sha: '1234',
      },
    });

    (roll as jest.Mock)
      .mockImplementationOnce(() => {
        throw new Error('');
      })
      .mockImplementationOnce(() => {
        throw new Error('');
      });
    await expect(handleNodeCheck()).rejects.toThrowError(
      `Upgrade check failed - see logs for more details`,
    );
    expect(roll).toHaveBeenCalled();
  });
});
