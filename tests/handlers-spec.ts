
import { REPOS, ROLL_TARGETS } from '../src/constants';
import { handleChromiumCheck, handleNodeCheck, getSupportedBranches } from '../src/handlers';
import { getChromiumMaster, getChromiumTags } from '../src/utils/get-chromium-tags';
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
        getContents: jest.fn()
      },
    };
    (getOctokit as jest.Mock).mockReturnValue(this.mockOctokit);
  });

  describe('release branches', () => {
    beforeEach(() => {
      this.mockOctokit.repos.listBranches.mockReturnValue({
        data: [
          {
            name: '4-0-x',
            commit: {
              sha: '1234'
            }
          }
        ]
      });

      this.mockOctokit.repos.getContents.mockReturnValue({
        data: {
          content: Buffer.from(`${ROLL_TARGETS.chromium.depsKey}':\n    '1.0.0.0',`),
          sha: '1234'
        },
      });
      (getChromiumTags as jest.Mock).mockReturnValue({
        "1.1.0.0": {
          "value": "5678"
        },
        "1.2.0.0": {
          "value": "5678"
        },
        "2.1.0.0": {
          "value": "5678"
        }
      });
    });

    it('properly fetches supported versions of Electron to roll against', async () => {
      this.mockOctokit.repos.listBranches.mockReturnValue({
        data: [
          {
            name: '10-x-y',
            commit: {
              sha: '1234'
            }
          },
          {
            name: '9-x-y',
            commit: {
              sha: '1234'
            }
          },
          {
            name: '8-x-y',
            commit: {
              sha: '1234'
            }
          },
          {
            name: '7-1-x',
            commit: {
              sha: '1234'
            }
          },
          {
            name: '7-0-x',
            commit: {
              sha: '1234'
            }
          },
          {
            name: '6-1-x',
            commit: {
              sha: '1234'
            }
          },
          {
            name: '6-0-x',
            commit: {
              sha: '1234'
            }
          },
          {
            name: '5-0-x',
            commit: {
              sha: '1234'
            }
          },
        ]
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

      expect(roll).toHaveBeenCalledWith(expect.objectContaining({
        rollTarget: ROLL_TARGETS.chromium,
        targetVersion: '1.2.0.0'
      }));
    });

    it('takes no action if no new minor/build/patch available', async () => {
      this.mockOctokit.repos.getContents.mockReturnValue({
        data: {
          content: Buffer.from(`${ROLL_TARGETS.chromium.depsKey}':\n    '1.5.0.0',`),
          sha: '1234'
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
      this.mockOctokit.repos.listBranches.mockReturnValue({
        data: [
          {
            name: 'master',
            commit: {
              sha: '1234'
            }
          }
        ]
      });

      this.mockOctokit.repos.getContents.mockReturnValue({
        data: {
          content: Buffer.from(`${ROLL_TARGETS.chromium.depsKey}':\n    'old-sha',`),
          sha: '1234'
        },
      });

      (getChromiumMaster as jest.Mock).mockReturnValue({
        commit: 'new-sha'
      });
    });

    it('updates to master', async () => {
      await handleChromiumCheck();

      expect(roll).toHaveBeenCalledWith(expect.objectContaining({
        rollTarget: ROLL_TARGETS.chromium,
        targetVersion: 'new-sha',
      }));
    });

    it('takes no action if master is already in DEPS', async () => {
      (getChromiumMaster as jest.Mock).mockReturnValue({
        commit: 'old-sha'
      });
      await handleChromiumCheck();

      expect(roll).not.toHaveBeenCalled();
    })
  });

  it('throws error if roll() process failed', async () => {
    this.mockOctokit.repos.listBranches.mockReturnValue({
      data: [
        {
          name: '4-0-x',
          commit: {
            sha: '1234'
          }
        }
      ]
    });

    this.mockOctokit.repos.getContents.mockReturnValue({
      data: {
        content: Buffer.from(`${ROLL_TARGETS.chromium.depsKey}':\n    '1.0.0.0',`),
        sha: '1234'
      },
    });
    (getChromiumTags as jest.Mock).mockReturnValue({
      "1.1.0.0": {
        "value": "5678"
      },
      "1.2.0.0": {
        "value": "5678"
      },
      "2.1.0.0": {
        "value": "5678"
      }
    });

    (roll as jest.Mock).mockImplementationOnce(() => {
      throw new Error('');
    })
    await expect(handleChromiumCheck()).rejects.toThrowError(`One or more upgrade checks failed - see logs for more details`);
    expect(roll).toHaveBeenCalled();
  })
});

describe('handleNodeCheck()', () => {
  beforeEach(() => {
    this.mockOctokit = {
      repos: {
        getBranch: jest.fn().mockReturnValue({
          data: {
            name: 'master',
            commit: {
              sha: '1234'
            }
          }
        }),
        listReleases: jest.fn().mockReturnValue({
          data: [
            {
              tag_name: 'v11.2.0'
            },
            {
              tag_name: 'v12.0.0'
            },
            {
              tag_name: 'v12.1.0'
            },
            {
              tag_name: 'v12.2.0'
            }
          ]
        }),
        getContents: jest.fn()
      },
    };
    (getOctokit as jest.Mock).mockReturnValue(this.mockOctokit);
  });

  it('rolls even major versions of Node.js with latest minor/patch update', async () => {
    this.mockOctokit.repos.getContents.mockReturnValue({
      data: {
        content: Buffer.from(`${ROLL_TARGETS.node.depsKey}':\n    'v12.0.0',`),
        sha: '1234'
      },
    })
    await handleNodeCheck();

    expect(roll).toHaveBeenCalledWith({
      rollTarget: ROLL_TARGETS.node,
      electronBranch: expect.objectContaining({
        name: 'master'
      }),
      targetVersion: 'v12.2.0',
    })
  });

  it('does not roll for uneven major versions of Node.js', async () => {
    this.mockOctokit.repos.getContents.mockReturnValue({
      data: {
        content: Buffer.from(`${ROLL_TARGETS.node.depsKey}':\n    'v11.0.0',`),
        sha: '1234'
      },
    })
    await handleNodeCheck();

    expect(roll).not.toHaveBeenCalled();
  });

  it('does not roll if no newer release found', async () => {
    this.mockOctokit.repos.getContents.mockReturnValue({
      data: {
        content: Buffer.from(`${ROLL_TARGETS.node.depsKey}':\n    'v12.2.0',`),
        sha: '1234'
      },
    })
    await handleNodeCheck();

    expect(roll).not.toHaveBeenCalled();
  });

  it('throws error if roll() process failed', async () => {
    this.mockOctokit.repos.getContents.mockReturnValue({
      data: {
        content: Buffer.from(`${ROLL_TARGETS.node.depsKey}':\n    'v12.0.0',`),
        sha: '1234'
      },
    });

    (roll as jest.Mock).mockImplementationOnce(() => {
      throw new Error('');
    })
    await expect(handleNodeCheck()).rejects.toThrowError(`Upgrade check failed - see logs for more details`);
    expect(roll).toHaveBeenCalled();
  });
})
