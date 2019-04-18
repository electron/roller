import { rollChromium } from '../src/roll-chromium';
import { getOctokit } from '../src/utils/octokit';

jest.mock('../src/utils/octokit');

describe('rollChromium()', () => {
  beforeEach(() => {
    this.mockOctokit = {
      git: {
        createCommit: jest.fn(() => ({
          data: { sha: '123456' },
        })),
        createRef: jest.fn(),
        createTree: jest.fn(() => ({
          data: { sha: '123456' },
        })),
        getRef: jest.fn(),
        updateRef: jest.fn(() => ({
          data: { sha: '123456' },
        })),
      },
      repos: {
        getContents: jest.fn(() => ({
          data: { content: Buffer.from('12345') },
        })),
        updateFile: jest.fn(),
      },
    };
  });

  it('attempts to update the DEPS file', async () => {
    (getOctokit as jest.Mock).mockReturnValue(this.mockOctokit);
    this.mockOctokit.git.getRef.mockReturnValueOnce({
      data: {
        object: {
          sha: '12345',
        },
      },
    });

    const result = await rollChromium('3-0-x', '12345');
    expect(result).toBeTruthy();
    expect(result.startsWith('roller/libcc-12345-')).toBe(true);
  });
});
