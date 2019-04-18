import { getOctokit } from '../src/utils/octokit';
import { rollChromium } from '../src/roll-chromium';

jest.mock('../src/utils/octokit');

describe('rollChromium()', () => {
  beforeEach(() => {
    this.mockOctokit = {
      gitdata: {
        createCommit: jest.fn(() => ({
          data: { sha: '123456' }
        })),
        createReference: jest.fn(),
        createTree: jest.fn(() => ({
          data: { sha: '123456' }
        })),
        getReference: jest.fn(),
        updateReference: jest.fn(() => ({
          data: { sha: '123456' }
        }))
      },
      repos: {
        getContent: jest.fn(() => ({
          data: { content: Buffer.from('12345') }
        })),
        updateFile: jest.fn()
      }
    }
  });

  it('attempts to update the DEPS file', async () => {
    (getOctokit as jest.Mock).mockReturnValue(this.mockOctokit);
    this.mockOctokit.gitdata.getReference.mockReturnValueOnce({
      data: {
        object: {
          sha: '12345'
        }
      }
    });

    const result = await rollChromium('3-0-x', '12345');
    expect(result).toBeTruthy();
    expect(result.startsWith('roller/libcc-12345-')).toBe(true);
  });
});
