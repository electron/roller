import { handleLibccPush, handleNodeCheck } from '../src/handlers';
import { rollChromium } from '../src/roll-chromium';
import { getOctokit } from '../src/utils/octokit';
import { roll } from '../src/utils/roll';
import { ROLL_TARGETS } from '../src/constants';

jest.mock('../src/utils/octokit');
jest.mock('../src/roll-chromium');
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
  })
})
