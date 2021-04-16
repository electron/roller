import { updateDepsFile, UpdateDepsParams } from '../../src/utils/update-deps';
import { getOctokit } from '../../src/utils/octokit';
import { REPOS } from '../../src/constants';

jest.mock('../../src/utils/octokit');

describe('updateDepsFile()', () => {
  let mockOctokit;
  let options;

  beforeEach(() => {
    mockOctokit = {
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
    (getOctokit as jest.Mock).mockReturnValue(mockOctokit);

    options = ({
      depKey: 'testKey',
      depName: 'testName',
      branch: 'testBranch',
      targetVersion: 'v10.0.0'
    } as UpdateDepsParams);
  });

  it('returns the previous and new version numbers', async () => {
    const result = await updateDepsFile(options);
    expect(result).toEqual({
      previousDEPSVersion: 'v4.0.0',
      newDEPSVersion: 'v10.0.0'
    });
  })

  it('attempts to update the DEPS file', async () => {
    await updateDepsFile(options);

    expect(mockOctokit.repos.updateFile).toHaveBeenCalledWith({
      ...REPOS.electron,
      path: 'DEPS',
      content: Buffer.from(`'${options.depKey}':\n    '${options.targetVersion}',`).toString('base64'),
      message: `chore: bump ${options.depName} in DEPS to ${options.targetVersion}`,
      sha: '1234',
      branch: options.branch
    });
  });

  it('does not update DEPS file if version is unchanged', async () => {
    const opts = ({
      ...options,
      targetVersion: 'v4.0.0'
    } as UpdateDepsParams);

    await updateDepsFile(opts);

    expect(mockOctokit.repos.updateFile).not.toHaveBeenCalled();
  })
});
