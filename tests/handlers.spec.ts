import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MAIN_BRANCH, REPOS, ROLL_TARGETS } from '../src/constants.js';
import { handleNodeCheck } from '../src/node-handler.js';
import { handleChromiumCheck } from '../src/chromium-handler.js';
import { getChromiumReleases } from '../src/utils/get-chromium-tags.js';
import { getContent } from '../src/utils/github-utils.js';
import { getOctokit } from '../src/utils/octokit.js';
import { roll } from '../src/utils/roll.js';
import { getLatestLTSVersion } from '../src/utils/get-nodejs-lts.js';
import { getSupportedBranches } from '../src/utils/get-supported-branches.js';

vi.mock('../src/utils/get-chromium-tags.js');
vi.mock('../src/utils/github-utils.js');
vi.mock('../src/utils/octokit.js');
vi.mock('../src/utils/roll.js');
vi.mock('../src/utils/get-nodejs-lts.js');
vi.mock('../src/utils/get-supported-branches.js');

describe('handleChromiumCheck()', () => {
  let mockOctokit: any;

  beforeEach(() => {
    mockOctokit = {
      repos: {
        getContent: vi.fn(),
        get: vi.fn(),
        getBranch: vi.fn().mockReturnValue({
          data: {
            name: MAIN_BRANCH,
            commit: {
              sha: '1234',
            },
          },
        }),
      },
    };
    vi.mocked(getOctokit).mockReturnValue(mockOctokit);
    vi.mocked(getSupportedBranches)
      .mockReset()
      .mockResolvedValue([{ name: '4-0-x', commit: { sha: '1234' } }]);
    vi.mocked(roll).mockReset().mockResolvedValue([]);
  });

  describe('release branches', () => {
    beforeEach(() => {
      vi.mocked(getContent).mockResolvedValue({
        content: `${ROLL_TARGETS.chromium.depsKey}':\n    '1.0.0.0',`,
        sha: '1234',
      });
    });

    it('rolls with latest versions from release tags', async () => {
      vi.mocked(getChromiumReleases).mockResolvedValue(['1.1.0.0', '1.2.0.0']);

      await handleChromiumCheck();

      expect(roll).toHaveBeenCalledWith(
        expect.objectContaining({
          rollTarget: ROLL_TARGETS.chromium,
          targetVersion: '1.2.0.0',
        }),
      );
    });

    it('skips a release branch the main roll covers when it has kept pace with main', async () => {
      vi.mocked(getChromiumReleases).mockResolvedValue(['1.1.0.0', '1.2.0.0']);
      // Main and the branch are level on 1.0.0.0 (the branch's backports have
      // kept pace with what main has landed) while main rolls to 1.2.0.0.
      // The main roll PR covers 4-0-x with a target/ label.
      vi.mocked(roll).mockResolvedValueOnce(['4-0-x']);

      await handleChromiumCheck();

      expect(roll).toHaveBeenCalledTimes(1);
      expect(roll).toHaveBeenCalledWith(
        expect.objectContaining({
          rollTarget: ROLL_TARGETS.chromium,
          electronBranch: expect.objectContaining({ name: MAIN_BRANCH }),
          targetVersion: '1.2.0.0',
        }),
      );
    });

    it('skips a covered branch level with main while the main roll PR is ahead of both', async () => {
      // The everyday path: main has landed 1.1.0.0, its open roll PR targets
      // 1.2.0.0, and the branch's backports have kept it level with main.
      vi.mocked(getChromiumReleases).mockResolvedValue(['1.1.0.0', '1.2.0.0']);
      vi.mocked(getContent).mockResolvedValue({
        content: `${ROLL_TARGETS.chromium.depsKey}':\n    '1.1.0.0',`,
        sha: '1234',
      });
      vi.mocked(roll).mockResolvedValueOnce(['4-0-x']);

      await handleChromiumCheck();

      expect(roll).toHaveBeenCalledTimes(1);
      expect(roll).toHaveBeenCalledWith(
        expect.objectContaining({
          rollTarget: ROLL_TARGETS.chromium,
          electronBranch: expect.objectContaining({ name: MAIN_BRANCH }),
          targetVersion: '1.2.0.0',
        }),
      );
    });

    it('rolls a covered branch independently while it lags what main has landed', async () => {
      vi.mocked(getChromiumReleases).mockResolvedValue(['1.1.0.0', '1.2.0.0']);
      // Main has landed 1.1.0.0 but the branch is still on 1.0.0.0 - its
      // backport stalled, so it must be able to pull itself forward.
      vi.mocked(getContent)
        .mockResolvedValueOnce({
          content: `${ROLL_TARGETS.chromium.depsKey}':\n    '1.1.0.0',`,
          sha: '1234',
        })
        .mockResolvedValue({
          content: `${ROLL_TARGETS.chromium.depsKey}':\n    '1.0.0.0',`,
          sha: '1234',
        });
      vi.mocked(roll).mockResolvedValueOnce(['4-0-x']);

      await handleChromiumCheck();

      expect(roll).toHaveBeenCalledTimes(2);
      expect(roll).toHaveBeenCalledWith(
        expect.objectContaining({
          rollTarget: ROLL_TARGETS.chromium,
          electronBranch: expect.objectContaining({ name: '4-0-x' }),
          targetVersion: '1.2.0.0',
        }),
      );
    });

    it('does not skip release branches if the main roll fails', async () => {
      vi.mocked(getChromiumReleases).mockResolvedValue(['1.1.0.0', '1.2.0.0']);
      vi.mocked(roll).mockImplementationOnce(() => {
        throw new Error('main roll failed');
      });

      await expect(handleChromiumCheck()).rejects.toThrowError(
        'One or more upgrade checks failed - see logs for more details',
      );

      expect(roll).toHaveBeenCalledTimes(2);
      expect(roll).toHaveBeenLastCalledWith(
        expect.objectContaining({
          rollTarget: ROLL_TARGETS.chromium,
          electronBranch: expect.objectContaining({ name: '4-0-x' }),
          targetVersion: '1.2.0.0',
        }),
      );
    });

    it('never skips an explicitly targeted release branch roll', async () => {
      vi.mocked(getChromiumReleases).mockResolvedValue(['1.1.0.0', '1.2.0.0']);

      mockOctokit.repos.getBranch.mockReturnValue({
        data: {
          name: '4-0-x',
          commit: {
            sha: '1234',
          },
        },
      });

      await handleChromiumCheck('4-0-x');

      expect(roll).toHaveBeenCalledTimes(1);
      expect(roll).toHaveBeenCalledWith(
        expect.objectContaining({
          rollTarget: ROLL_TARGETS.chromium,
          electronBranch: expect.objectContaining({ name: '4-0-x' }),
          targetVersion: '1.2.0.0',
        }),
      );
    });

    it('fails if an invalid target is passed', async () => {
      mockOctokit.repos.getBranch.mockReturnValue(null);

      const invalid = 'i-am-not-a-valid-release-branch';
      await expect(handleChromiumCheck(invalid)).rejects.toThrow(
        'One or more upgrade checks failed - see logs for more details',
      );
    });

    it('takes no action if no new minor/build/patch available', async () => {
      vi.mocked(getChromiumReleases).mockResolvedValue([]);

      vi.mocked(getContent).mockResolvedValue({
        content: `${ROLL_TARGETS.chromium.depsKey}':\n    '1.5.0.0',`,
        sha: '1234',
      });

      await handleChromiumCheck();

      expect(roll).not.toHaveBeenCalled();
    });

    it('fails if DEPS version invalid', async () => {
      vi.mocked(getContent).mockResolvedValue({
        content: `${ROLL_TARGETS.chromium.depsKey}':\n    'someCommitSha',`,
        sha: '1234',
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
      vi.mocked(getSupportedBranches).mockResolvedValue([]);

      vi.mocked(getContent).mockResolvedValue({
        content: `${ROLL_TARGETS.chromium.depsKey}':\n    '1.1.0.0',`,
        sha: '1234',
      });
    });

    it('updates to main', async () => {
      vi.mocked(getChromiumReleases).mockResolvedValue(['1.1.0.0', '1.2.0.0', '2.1.0.0']);

      await handleChromiumCheck();

      expect(roll).toHaveBeenCalledWith(
        expect.objectContaining({
          rollTarget: ROLL_TARGETS.chromium,
          targetVersion: '2.1.0.0',
        }),
      );
    });

    it('takes no action if main is already in DEPS', async () => {
      vi.mocked(getChromiumReleases).mockResolvedValue(['1.1.0.0', '1.1.0.0']);

      await handleChromiumCheck();

      expect(roll).not.toHaveBeenCalled();
    });
  });

  it('throws error if roll() process failed', async () => {
    vi.mocked(getContent).mockResolvedValue({
      content: `${ROLL_TARGETS.chromium.depsKey}':\n    '1.0.0.0',`,
      sha: '1234',
    });
    vi.mocked(getChromiumReleases).mockResolvedValue(['1.1.0.0', '1.2.0.0', '2.1.0.0']);

    vi.mocked(roll).mockImplementationOnce(() => {
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
        getBranch: vi.fn().mockReturnValue({
          data: {
            name: MAIN_BRANCH,
            commit: {
              sha: '1234',
            },
          },
        }),
        listReleases: vi.fn().mockReturnValue({
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
        getContent: vi.fn(),
      },
    };
    vi.mocked(getOctokit).mockReturnValue(mockOctokit);
    vi.mocked(getSupportedBranches).mockReset().mockResolvedValue([]);
  });

  it('rolls even major versions of Node.js with latest minor/patch update', async () => {
    vi.mocked(getLatestLTSVersion).mockResolvedValue('14.0.0');

    vi.mocked(getSupportedBranches).mockResolvedValue([
      { name: '4-x-y', commit: { sha: '1234' } },
      { name: '5-x-y', commit: { sha: '2345' } },
      { name: '6-x-y', commit: { sha: '3456' } },
    ]);

    vi.mocked(getContent).mockResolvedValue({
      content: `${ROLL_TARGETS.node.depsKey}':\n    'v12.0.0',`,
      sha: '1234',
    });

    await handleNodeCheck();

    // Main roll and three supported branches.
    expect(roll).toBeCalledTimes(4);

    expect(roll).toHaveBeenCalledWith({
      rollTarget: ROLL_TARGETS.node,
      electronBranch: expect.objectContaining({
        name: MAIN_BRANCH,
      }),
      targetVersion: 'v12.2.0',
    });
  });

  it('does not roll for uneven major versions of Node.js', async () => {
    vi.mocked(getLatestLTSVersion).mockResolvedValue('12.0.0');

    vi.mocked(getContent).mockResolvedValue({
      content: `${ROLL_TARGETS.node.depsKey}':\n    'v11.0.0',`,
      sha: '1234',
    });
    await handleNodeCheck();

    expect(roll).not.toHaveBeenCalled();
  });

  it('does not roll if no newer release found', async () => {
    vi.mocked(getLatestLTSVersion).mockResolvedValue('12.0.0');

    vi.mocked(getContent).mockResolvedValue({
      content: `${ROLL_TARGETS.node.depsKey}':\n    'v12.2.0',`,
      sha: '1234',
    });
    await handleNodeCheck();

    expect(roll).not.toHaveBeenCalled();
  });

  it('throws error if roll() process failed', async () => {
    vi.mocked(getLatestLTSVersion).mockResolvedValue('14.0.0');

    vi.mocked(getContent).mockResolvedValue({
      content: `${ROLL_TARGETS.node.depsKey}':\n    'v12.0.0',`,
      sha: '1234',
    });

    vi.mocked(roll)
      .mockImplementationOnce(() => {
        throw new Error('');
      })
      .mockImplementationOnce(() => {
        throw new Error('');
      });
    await expect(handleNodeCheck()).rejects.toThrowError(
      `One or more upgrade checks failed - see logs for more details`,
    );
    expect(roll).toHaveBeenCalled();
  });
});
