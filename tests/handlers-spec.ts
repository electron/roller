import { REPOS, ROLL_TARGETS } from '../src/constants';
import { handleChromiumCheck, handleNodeCheck, getSupportedBranches } from '../src/handlers';
import { getChromiumReleases } from '../src/utils/get-chromium-tags';
import { getOctokit } from '../src/utils/octokit';
import { roll } from '../src/utils/roll';

jest.mock('../src/utils/get-chromium-tags');
jest.mock('../src/utils/octokit');
jest.mock('../src/utils/roll');

describe('handleChromiumCheck()', () => {
  beforeEach(() => {
    this.mockOctokit = {
      repos: {
        listBranches: jest.fn(),
        getContents: jest.fn(),
        get: jest.fn(),
      },
    };
    (getOctokit as jest.Mock).mockReturnValue(this.mockOctokit);
  });

  describe('release branches', () => {
    beforeEach(() => {
      this.mockOctokit.repos.get.mockReturnValue({
        data: {
          default_branch: 'main',
        },
      });

      this.mockOctokit.repos.listBranches.mockReturnValue({
        data: [
          {
            name: '4-0-x',
            commit: {
              sha: '1234',
            },
          },
        ],
      });

      this.mockOctokit.repos.getContents.mockReturnValue({
        data: {
          content: Buffer.from(`${ROLL_TARGETS.chromium.depsKey}':\n    '1.0.0.0',`),
          sha: '1234',
        },
      });
      (getChromiumReleases as jest.Mock).mockReturnValue([
        {
          timestamp: '2020-01-01 01:01:01.000001',
          version: '1.1.0.0',
          channel: 'stable',
          os: 'win',
        },
        {
          timestamp: '2020-01-01 01:01:01.000003',
          version: '2.1.0.0',
          channel: 'beta',
          os: 'win',
        },
        {
          timestamp: '2020-01-01 01:01:01.000002',
          version: '1.2.0.0',
          channel: 'stable',
          os: 'mac',
        },
      ]);
    });

    it('properly fetches supported versions of Electron to roll against', async () => {
      this.mockOctokit.repos.listBranches.mockReturnValue({
        data: [
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
        ],
      });

      const { data: branches } = await this.mockOctokit.repos.listBranches({
        ...REPOS.electron,
        protected: true,
      });

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
      this.mockOctokit.repos.getContents.mockReturnValue({
        data: {
          content: Buffer.from(`${ROLL_TARGETS.chromium.depsKey}':\n    '1.5.0.0',`),
          sha: '1234',
        },
      });

      await handleChromiumCheck();

      expect(roll).not.toHaveBeenCalled();
    });

    it('fails if DEPS version invalid', async () => {
      this.mockOctokit.repos.getContents.mockReturnValue({
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

  describe('master branch', () => {
    beforeEach(() => {
      this.mockOctokit.repos.get.mockReturnValue({
        data: {
          default_branch: 'master',
        },
      });

      this.mockOctokit.repos.listBranches.mockReturnValue({
        data: [
          {
            name: 'master',
            commit: {
              sha: '1234',
            },
          },
        ],
      });

      this.mockOctokit.repos.getContents.mockReturnValue({
        data: {
          content: Buffer.from(`${ROLL_TARGETS.chromium.depsKey}':\n    '1.1.0.0',`),
          sha: '1234',
        },
      });
    });

    it('updates to master', async () => {
      (getChromiumReleases as jest.Mock).mockReturnValue([
        {
          timestamp: '2020-01-01 01:01:01.000001',
          version: '1.1.0.0',
          channel: 'stable',
          os: 'win',
        },
        {
          timestamp: '2020-01-01 01:01:01.000003',
          version: '2.1.0.0',
          channel: 'canary',
          os: 'win',
        },
        {
          timestamp: '2020-01-01 01:01:01.000002',
          version: '1.2.0.0',
          channel: 'stable',
          os: 'mac',
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

    it('takes no action if master is already in DEPS', async () => {
      (getChromiumReleases as jest.Mock).mockReturnValue([
        {
          timestamp: '2020-01-01 01:01:01.000001',
          version: '1.1.0.0',
          channel: 'canary',
          os: 'win',
        },
        {
          timestamp: '2020-01-01 01:01:01.000002',
          version: '1.1.0.0',
          channel: 'canary',
          os: 'mac',
        },
      ]);

      await handleChromiumCheck();

      expect(roll).not.toHaveBeenCalled();
    });
  });

  describe('main branch', () => {
    beforeEach(() => {
      this.mockOctokit.repos.get.mockReturnValue({
        data: {
          default_branch: 'main',
        },
      });

      this.mockOctokit.repos.listBranches.mockReturnValue({
        data: [
          {
            name: 'main',
            commit: {
              sha: '1234',
            },
          },
        ],
      });

      this.mockOctokit.repos.getContents.mockReturnValue({
        data: {
          content: Buffer.from(`${ROLL_TARGETS.chromium.depsKey}':\n    '1.1.0.0',`),
          sha: '1234',
        },
      });
    });

    it('updates to main', async () => {
      (getChromiumReleases as jest.Mock).mockReturnValue([
        {
          timestamp: '2020-01-01 01:01:01.000001',
          version: '1.1.0.0',
          channel: 'stable',
          os: 'win',
        },
        {
          timestamp: '2020-01-01 01:01:01.000003',
          version: '2.1.0.0',
          channel: 'canary',
          os: 'win',
        },
        {
          timestamp: '2020-01-01 01:01:01.000002',
          version: '1.2.0.0',
          channel: 'stable',
          os: 'mac',
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
          timestamp: '2020-01-01 01:01:01.000001',
          version: '1.1.0.0',
          channel: 'canary',
          os: 'win',
        },
        {
          timestamp: '2020-01-01 01:01:01.000002',
          version: '1.1.0.0',
          channel: 'canary',
          os: 'mac',
        },
      ]);

      await handleChromiumCheck();

      expect(roll).not.toHaveBeenCalled();
    });
  });

  it('throws error if roll() process failed', async () => {
    this.mockOctokit.repos.get.mockReturnValue({
      data: {
        default_branch: 'main',
      },
    });

    this.mockOctokit.repos.listBranches.mockReturnValue({
      data: [
        {
          name: '4-0-x',
          commit: {
            sha: '1234',
          },
        },
      ],
    });

    this.mockOctokit.repos.getContents.mockReturnValue({
      data: {
        content: Buffer.from(`${ROLL_TARGETS.chromium.depsKey}':\n    '1.0.0.0',`),
        sha: '1234',
      },
    });
    (getChromiumReleases as jest.Mock).mockReturnValue([
      {
        timestamp: '2020-01-01 01:01:01.000001',
        version: '1.1.0.0',
        channel: 'stable',
        os: 'win',
      },
      {
        timestamp: '2020-01-01 01:01:01.000003',
        version: '2.1.0.0',
        channel: 'beta',
        os: 'win',
      },
      {
        timestamp: '2020-01-01 01:01:01.000002',
        version: '1.2.0.0',
        channel: 'stable',
        os: 'mac',
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
  beforeEach(() => {
    this.mockOctokit = {
      repos: {
        getBranch: jest.fn().mockReturnValue({
          data: {
            name: 'main',
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
        getContents: jest.fn(),
        get: jest.fn().mockReturnValue({
          data: {
            default_branch: 'main',
          },
        }),
      },
    };
    (getOctokit as jest.Mock).mockReturnValue(this.mockOctokit);
  });

  it('rolls even major versions of Node.js with latest minor/patch update', async () => {
    this.mockOctokit.repos.getContents.mockReturnValue({
      data: {
        content: Buffer.from(`${ROLL_TARGETS.node.depsKey}':\n    'v12.0.0',`),
        sha: '1234',
      },
    });
    await handleNodeCheck();

    expect(roll).toHaveBeenCalledWith({
      rollTarget: ROLL_TARGETS.node,
      electronBranch: expect.objectContaining({
        name: 'main',
      }),
      targetVersion: 'v12.2.0',
    });
  });

  it('does not roll for uneven major versions of Node.js', async () => {
    this.mockOctokit.repos.getContents.mockReturnValue({
      data: {
        content: Buffer.from(`${ROLL_TARGETS.node.depsKey}':\n    'v11.0.0',`),
        sha: '1234',
      },
    });
    await handleNodeCheck();

    expect(roll).not.toHaveBeenCalled();
  });

  it('does not roll if no newer release found', async () => {
    this.mockOctokit.repos.getContents.mockReturnValue({
      data: {
        content: Buffer.from(`${ROLL_TARGETS.node.depsKey}':\n    'v12.2.0',`),
        sha: '1234',
      },
    });
    await handleNodeCheck();

    expect(roll).not.toHaveBeenCalled();
  });

  it('throws error if roll() process failed', async () => {
    this.mockOctokit.repos.getContents.mockReturnValue({
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
