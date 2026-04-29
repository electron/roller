import { beforeEach, describe, expect, it, vi } from 'vitest';

import { roll } from '../../src/utils/roll.js';
import { getOctokit } from '../../src/utils/octokit.js';
import {
  CHROMIUM_UPGRADE_WORKFLOW,
  MAIN_BRANCH,
  REPOS,
  ROLL_TARGETS,
} from '../../src/constants.js';
import { updateDepsFile } from '../../src/utils/update-deps.js';

vi.mock('../../src/utils/octokit.js');
vi.mock('../../src/utils/update-deps.js');

describe('roll()', () => {
  let mockOctokit: any;
  const branch = {
    name: 'testBranch',
    commit: {
      sha: 'asdsad',
      url: 'asdsadsad',
    },
    protected: true,
    protection: {
      enabled: false,
      required_status_checks: {
        enforcement_level: '',
        contexts: [],
        checks: [],
      },
    },
    protection_url: 'asdasd',
  };

  beforeEach(() => {
    mockOctokit = {
      paginate: vi.fn(),
      pulls: {
        update: vi.fn(),
        create: vi.fn().mockReturnValue({ data: { html_url: 'https://google.com' } }),
      },
      git: {
        createRef: vi.fn(),
        getRef: vi.fn().mockReturnValue({ status: 404 }),
        deleteRef: vi.fn(),
      },
      issues: {
        addLabels: vi.fn(),
        listLabelsOnIssue: vi.fn().mockReturnValue({ data: [] }),
      },
      actions: {
        createWorkflowDispatch: vi.fn(),
      },
    };
    vi.mocked(getOctokit).mockReturnValue(mockOctokit);
    vi.mocked(updateDepsFile).mockResolvedValue({
      previousDEPSVersion: 'v4.0.0',
      newDEPSVersion: 'v10.0.0',
    });
  });

  it('takes no action if versions are identical', async () => {
    mockOctokit.paginate.mockReturnValue([
      {
        user: {
          login: 'electron-roller[bot]',
        },
        title: `chore: bump ${ROLL_TARGETS.node.name} to foo`,
        number: 1,
        head: {
          ref: 'asd',
        },
        body: 'Original-Version: v4.0.0',
        labels: [{ name: 'hello' }, { name: 'goodbye' }],
        created_at: new Date().toISOString(),
      },
    ]);

    vi.mocked(updateDepsFile).mockResolvedValue({
      previousDEPSVersion: 'v4.0.0',
      newDEPSVersion: 'v4.0.0',
    });

    await roll({
      rollTarget: ROLL_TARGETS.node,
      electronBranch: branch,
      targetVersion: 'v4.0.0',
    });

    expect(mockOctokit.pulls.update).not.toHaveBeenCalled();
    expect(mockOctokit.pulls.create).not.toHaveBeenCalled();
  });

  it('takes no action if the PR user is trop', async () => {
    mockOctokit.paginate.mockReturnValue([
      {
        user: {
          login: 'trop[bot]',
        },
        title: `chore: bump ${ROLL_TARGETS.node.name} to foo`,
        number: 1,
        head: {
          ref: 'asd',
        },
        body: 'Original-Version: v4.0.0',
        labels: [{ name: 'hello' }, { name: 'goodbye' }],
        created_at: new Date().toISOString(),
      },
    ]);

    vi.mocked(updateDepsFile).mockResolvedValue({
      previousDEPSVersion: 'v4.0.0',
      newDEPSVersion: 'v4.0.0',
    });

    await roll({
      rollTarget: ROLL_TARGETS.node,
      electronBranch: branch,
      targetVersion: 'v4.0.0',
    });

    expect(mockOctokit.pulls.update).not.toHaveBeenCalled();
    expect(mockOctokit.pulls.create).not.toHaveBeenCalled();
  });

  it('updates a PR if existing PR already exists', async () => {
    mockOctokit.paginate.mockReturnValue([
      {
        user: {
          login: 'electron-roller[bot]',
        },
        title: `chore: bump ${ROLL_TARGETS.node.name} to bar`,
        number: 1,
        head: {
          ref: 'asd',
        },
        body: 'Original-Version: v4.0.0',
        labels: [{ name: 'hello' }, { name: 'goodbye' }],
        created_at: new Date().toISOString(),
      },
    ]);

    await roll({
      rollTarget: ROLL_TARGETS.node,
      electronBranch: branch,
      targetVersion: 'v10.0.0',
    });

    expect(mockOctokit.pulls.update).toHaveBeenCalledWith(
      expect.objectContaining({
        ...REPOS.electron,
        pull_number: 1,
        title: expect.stringContaining(
          `bump ${ROLL_TARGETS.node.name} to v10.0.0 (${branch.name})`,
        ),
        body: expect.stringContaining('Original-Version: v4.0.0'),
      }),
    );
  });

  it('creates a new PR if none found', async () => {
    mockOctokit.paginate.mockReturnValue([]);

    await roll({
      rollTarget: ROLL_TARGETS.node,
      electronBranch: branch,
      targetVersion: 'v10.0.0',
    });

    const newBranchName = `roller/${ROLL_TARGETS.node.name}/${branch.name}`;

    expect(mockOctokit.git.createRef).toHaveBeenCalledWith({
      ...REPOS.electron,
      ref: `refs/heads/${newBranchName}`,
      sha: branch.commit.sha,
    });

    expect(mockOctokit.pulls.create).toHaveBeenCalledWith(
      expect.objectContaining({
        ...REPOS.electron,
        base: branch.name,
        head: `${REPOS.electron.owner}:${newBranchName}`,
      }),
    );
  });

  describe('chromium-upgrade workflow dispatch', () => {
    const mainBranch = { ...branch, name: MAIN_BRANCH };

    it('dispatches when creating a new chromium PR on main', async () => {
      mockOctokit.paginate.mockReturnValue([]);

      await roll({
        rollTarget: ROLL_TARGETS.chromium,
        electronBranch: mainBranch,
        targetVersion: '120.0.0.0',
      });

      expect(mockOctokit.actions.createWorkflowDispatch).toHaveBeenCalledTimes(1);
      expect(mockOctokit.actions.createWorkflowDispatch).toHaveBeenCalledWith(
        CHROMIUM_UPGRADE_WORKFLOW,
      );
    });

    it('dispatches when updating an existing chromium PR on main', async () => {
      mockOctokit.paginate.mockReturnValue([
        {
          user: { login: 'electron-roller[bot]' },
          title: `chore: bump ${ROLL_TARGETS.chromium.name} to bar`,
          number: 1,
          head: { ref: 'asd' },
          body: 'Original-Version: 119.0.0.0',
          labels: [],
          created_at: new Date().toISOString(),
        },
      ]);

      await roll({
        rollTarget: ROLL_TARGETS.chromium,
        electronBranch: mainBranch,
        targetVersion: '120.0.0.0',
      });

      expect(mockOctokit.actions.createWorkflowDispatch).toHaveBeenCalledTimes(1);
      expect(mockOctokit.actions.createWorkflowDispatch).toHaveBeenCalledWith(
        CHROMIUM_UPGRADE_WORKFLOW,
      );
    });

    it('does not dispatch for node rolls on main', async () => {
      mockOctokit.paginate.mockReturnValue([]);

      await roll({
        rollTarget: ROLL_TARGETS.node,
        electronBranch: mainBranch,
        targetVersion: 'v10.0.0',
      });

      expect(mockOctokit.actions.createWorkflowDispatch).not.toHaveBeenCalled();
    });

    it('does not dispatch for chromium rolls on a release branch', async () => {
      mockOctokit.paginate.mockReturnValue([]);

      await roll({
        rollTarget: ROLL_TARGETS.chromium,
        electronBranch: branch,
        targetVersion: '120.0.0.0',
      });

      expect(mockOctokit.actions.createWorkflowDispatch).not.toHaveBeenCalled();
    });

    it('does not throw when dispatch itself fails', async () => {
      mockOctokit.paginate.mockReturnValue([]);
      mockOctokit.actions.createWorkflowDispatch.mockRejectedValueOnce(new Error('boom'));

      await expect(
        roll({
          rollTarget: ROLL_TARGETS.chromium,
          electronBranch: mainBranch,
          targetVersion: '120.0.0.0',
        }),
      ).resolves.toBeUndefined();

      expect(mockOctokit.pulls.create).toHaveBeenCalled();
    });
  });

  it('skips PR if existing one has been paused', async () => {
    mockOctokit.paginate.mockReturnValue([
      {
        user: {
          login: 'electron-roller[bot]',
        },
        title: ROLL_TARGETS.node.name,
        number: 1,
        head: {
          ref: 'asd',
        },
        body: 'Original-Version: v4.0.0',
        labels: [{ name: 'roller/pause' }],
        created_at: new Date('December 17, 1995 03:24:00').toISOString(),
      },
    ]);

    await roll({
      rollTarget: ROLL_TARGETS.node,
      electronBranch: branch,
      targetVersion: 'v10.0.0',
    });

    expect(mockOctokit.pulls.update).not.toHaveBeenCalled();
  });
});
