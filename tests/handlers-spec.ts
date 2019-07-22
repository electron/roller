import { getChromiumLkgr, getChromiumTags } from '../src/get-chromium-tags';
import { handleLibccPush, handleNodeCheck, handleChromiumCheck } from '../src/handlers';
import { rollChromium } from '../src/roll-chromium';
import { getOctokit } from '../src/utils/octokit';
import { roll } from '../src/utils/roll';
import { ROLL_TARGETS } from '../src/constants';

jest.mock('../src/get-chromium-tags');
jest.mock('../src/roll-chromium');
jest.mock('../src/utils/octokit');
jest.mock('../src/utils/roll');

describe('handleLibccPush()', () => {
  it('rolls chromium for the right branch', async () => {
    const mockData = { ref: 'electron-3-0-x' };
    await handleLibccPush(null, mockData as any);

    expect(rollChromium).toHaveBeenCalled();
  });

  it('does not do anything for anything else', async () => {
    const mockData = { ref: '💩' };
    await handleLibccPush(null, mockData as any);

    expect(rollChromium).toHaveBeenCalledTimes(0);
  });

  it('handles garbage data', async () => {
    await handleLibccPush(null, '💩' as any);

    expect(rollChromium).toHaveBeenCalledTimes(0);
  });
});

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
          content: Buffer.from(`${ROLL_TARGETS.CHROMIUM.key}':\n    '1.0.0.0',`),
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

    it('rolls with latest versions from release tags', async () => {
      await handleChromiumCheck();

      expect(roll).toHaveBeenCalledWith(expect.objectContaining({
        rollTarget: ROLL_TARGETS.CHROMIUM,
        newVersion: '1.2.0.0'
      }));
    });

    it('takes no action if no new minor/build/patch available', async () => {
      this.mockOctokit.repos.getContents.mockReturnValue({
        data: {
          content: Buffer.from(`${ROLL_TARGETS.CHROMIUM.key}':\n    '1.5.0.0',`),
          sha: '1234'
        },
      });

      await handleChromiumCheck();

      expect(roll).not.toHaveBeenCalled();
    });

    it('takes no action for branches <= 3', async () => {
      this.mockOctokit.repos.listBranches.mockReturnValue({
        data: [
          {
            name: '3-0-x',
            commit: {
              sha: '1234'
            }
          },
          {
            name: '2-0-x',
            commit: {
              sha: '1234'
            }
          },
        ]
      });

      await handleChromiumCheck();

      expect(roll).not.toHaveBeenCalled();
    })
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
          content: Buffer.from(`${ROLL_TARGETS.CHROMIUM.key}':\n    'old-sha',`),
          sha: '1234'
        },
      });

      (getChromiumLkgr as jest.Mock).mockReturnValue({
        commit: 'new-sha'
      });
    });

    it('updates to the LKGR', async () => {
      await handleChromiumCheck();

      expect(roll).toHaveBeenCalledWith(expect.objectContaining({
        rollTarget: ROLL_TARGETS.CHROMIUM,
        newVersion: 'new-sha',
      }));
    });

    it('takes no action if LKGR is already in DEPS', async () => {
      (getChromiumLkgr as jest.Mock).mockReturnValue({
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
        content: Buffer.from(`${ROLL_TARGETS.CHROMIUM.key}':\n    '1.0.0.0',`),
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
    await expect(handleChromiumCheck()).rejects.toThrowError(`One or more upgrade checks failed; see the logs for details`);
    expect(roll).toHaveBeenCalled();
  })
});

describe('handleNodeCheck()', () => {
  beforeEach(() => {
    this.mockOctokit = {
      repos: {
        listBranches: jest.fn().mockReturnValue({
          data: [
            {
              name: 'master',
              commit: {
                sha: '1234'
              }
            }
          ]
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
        content: Buffer.from(`${ROLL_TARGETS.NODE.key}':\n    'v12.0.0',`),
        sha: '1234'
      },
    })
    await handleNodeCheck();

    expect(roll).toHaveBeenCalledWith({
      rollTarget: ROLL_TARGETS.NODE,
      electronBranch: expect.objectContaining({
        name: 'master'
      }),
      newVersion: 'v12.2.0',
    })
  });

  it('does not roll for uneven major versions of Node.js', async () => {
    this.mockOctokit.repos.getContents.mockReturnValue({
      data: {
        content: Buffer.from(`${ROLL_TARGETS.NODE.key}':\n    'v11.0.0',`),
        sha: '1234'
      },
    })
    await handleNodeCheck();

    expect(roll).not.toHaveBeenCalled();
  });

  it('does not roll if no newer release found', async () => {
    this.mockOctokit.repos.getContents.mockReturnValue({
      data: {
        content: Buffer.from(`${ROLL_TARGETS.NODE.key}':\n    'v12.2.0',`),
        sha: '1234'
      },
    })
    await handleNodeCheck();

    expect(roll).not.toHaveBeenCalled();
  });

  it('throws error if roll() process failed', async () => {
    this.mockOctokit.repos.getContents.mockReturnValue({
      data: {
        content: Buffer.from(`${ROLL_TARGETS.NODE.key}':\n    'v12.0.0',`),
        sha: '1234'
      },
    });

    (roll as jest.Mock).mockImplementationOnce(() => {
      throw new Error('');
    })
    await expect(handleNodeCheck()).rejects.toThrowError(`One or more upgrade checks failed; see the logs for details`);
    expect(roll).toHaveBeenCalled();
  });
})
