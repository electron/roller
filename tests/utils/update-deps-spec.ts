import { updateDepsFile } from '../../src/utils/update-deps';
import { getOctokit } from '../../src/utils/octokit';
import { REPOS } from '../../src/constants';

jest.mock('../../src/utils/octokit');

describe('updateDepsFile()', () => {
  beforeEach(() => {
    this.mockOctokit = {
      repos: {
        getContents: jest.fn().mockImplementation(() => ({
          data: {
            content: Buffer.from("'testKey':\n    'v4.0.0',"),
            sha: '1234'
          },
        })),
        updateFile: jest.fn(),
      },
    };
    (getOctokit as jest.Mock).mockReturnValue(this.mockOctokit);

    this.options = {
      depKey: 'testKey',
      depName: 'testName',
      branch: 'testBranch',
      newVersion: 'v10.0.0'
    }
  });

  it('returns the original version number', async () => {
    const result = await updateDepsFile(this.options);
    expect(result).toBe('v4.0.0');
  })

  it('attempts to update the DEPS file', async () => {
    await updateDepsFile(this.options);

    expect(this.mockOctokit.repos.updateFile).toHaveBeenCalledWith({
      owner: REPOS.ELECTRON.OWNER,
      repo: REPOS.ELECTRON.NAME,
      path: 'DEPS',
      content: Buffer.from(`'${this.options.depKey}':\n    '${this.options.newVersion}',`).toString('base64'),
      message: `chore: bump ${this.options.depName} in DEPS to ${this.options.newVersion}`,
      sha: '1234',
      branch: this.options.branch
    });
  });

  it('does not update DEPS file if version is unchanged', async () => {
    const options = {
      ...this.options,
      newVersion: 'v4.0.0'
    }

    await updateDepsFile(options);

    expect(this.mockOctokit.repos.updateFile).not.toHaveBeenCalled();
  })
});
