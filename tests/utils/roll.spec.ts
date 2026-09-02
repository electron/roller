import { beforeEach, describe, expect, it, vi } from 'vitest';

import { roll } from '../../src/utils/roll.js';
import { getOctokit } from '../../src/utils/octokit.js';
import {
  BACKPORT_CHECK_SKIP,
  CHROMIUM_UPGRADE_WORKFLOW,
  MAIN_BRANCH,
  NO_BACKPORT,
  REPOS,
  ROLL_TARGETS,
} from '../../src/constants.js';
import { getBranchesTrackedByMain } from '../../src/utils/get-target-branch-labels.js';
import { updateDepsFile } from '../../src/utils/update-deps.js';

vi.mock('../../src/utils/octokit.js');
vi.mock('../../src/utils/update-deps.js');
vi.mock('../../src/utils/get-target-branch-labels.js');

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
        removeLabel: vi.fn(),
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
    vi.mocked(getBranchesTrackedByMain).mockReset().mockResolvedValue([]);
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
          ref: `roller/${ROLL_TARGETS.node.name}/${branch.name}`,
          repo: { full_name: `${REPOS.electron.owner}/${REPOS.electron.repo}` },
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
          ref: `roller/${ROLL_TARGETS.node.name}/${branch.name}`,
          repo: { full_name: `${REPOS.electron.owner}/${REPOS.electron.repo}` },
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

  it('ignores a PR whose head is a fork branch impersonating the roll branch', async () => {
    // An attacker forks electron/electron and names their branch after the
    // bot's roll branch, opening a PR with a matching title. The bot must not
    // read from or commit to that attacker-controlled ref, nor update its
    // title/body/labels.
    mockOctokit.paginate.mockReturnValue([
      {
        user: {
          login: 'attacker',
        },
        title: `chore: bump ${ROLL_TARGETS.node.name} to evil`,
        number: 1,
        head: {
          ref: `roller/${ROLL_TARGETS.node.name}/${branch.name}`,
          repo: { full_name: 'attacker/electron' },
        },
        body: 'Original-Version: v4.0.0',
        labels: [],
        created_at: new Date().toISOString(),
      },
    ]);

    await roll({
      rollTarget: ROLL_TARGETS.node,
      electronBranch: branch,
      targetVersion: 'v10.0.0',
    });

    expect(updateDepsFile).not.toHaveBeenCalled();
    expect(mockOctokit.pulls.update).not.toHaveBeenCalled();
    expect(mockOctokit.issues.addLabels).not.toHaveBeenCalled();
  });

  it('ignores a same-repo PR whose head ref is not the roll branch', async () => {
    // A same-repo PR matching the title prefix but not on the bot's roll branch
    // must not be touched either - the write target is derived from trusted
    // naming, never from the PR.
    mockOctokit.paginate.mockReturnValue([
      {
        user: {
          login: 'maintainer',
        },
        title: `chore: bump ${ROLL_TARGETS.node.name} to manual`,
        number: 1,
        head: {
          ref: 'some-manual-branch',
          repo: { full_name: `${REPOS.electron.owner}/${REPOS.electron.repo}` },
        },
        body: 'Original-Version: v4.0.0',
        labels: [],
        created_at: new Date().toISOString(),
      },
    ]);

    await roll({
      rollTarget: ROLL_TARGETS.node,
      electronBranch: branch,
      targetVersion: 'v10.0.0',
    });

    expect(updateDepsFile).not.toHaveBeenCalled();
    expect(mockOctokit.pulls.update).not.toHaveBeenCalled();
  });

  it('ignores a same-repo roll-branch PR not authored by the roller bot', async () => {
    // Even when the head repo and ref match the bot's roll branch exactly, a PR
    // opened by anyone other than the roller bot must not be touched.
    mockOctokit.paginate.mockReturnValue([
      {
        user: {
          login: 'someone-else',
        },
        title: `chore: bump ${ROLL_TARGETS.node.name} to bar`,
        number: 1,
        head: {
          ref: `roller/${ROLL_TARGETS.node.name}/${branch.name}`,
          repo: { full_name: `${REPOS.electron.owner}/${REPOS.electron.repo}` },
        },
        body: 'Original-Version: v4.0.0',
        labels: [],
        created_at: new Date().toISOString(),
      },
    ]);

    await roll({
      rollTarget: ROLL_TARGETS.node,
      electronBranch: branch,
      targetVersion: 'v10.0.0',
    });

    expect(updateDepsFile).not.toHaveBeenCalled();
    expect(mockOctokit.pulls.update).not.toHaveBeenCalled();
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
          head: {
            ref: `roller/${ROLL_TARGETS.chromium.name}/${mainBranch.name}`,
            repo: { full_name: `${REPOS.electron.owner}/${REPOS.electron.repo}` },
          },
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
      ).resolves.toEqual([]);

      expect(mockOctokit.pulls.create).toHaveBeenCalled();
    });
  });

  describe('backport labels', () => {
    const mainBranch = { ...branch, name: MAIN_BRANCH };
    const existingMainChromiumPr = {
      user: { login: 'electron-roller[bot]' },
      title: `chore: bump ${ROLL_TARGETS.chromium.name} to bar`,
      number: 1,
      head: {
        ref: `roller/${ROLL_TARGETS.chromium.name}/${MAIN_BRANCH}`,
        repo: { full_name: `${REPOS.electron.owner}/${REPOS.electron.repo}` },
      },
      body: 'Original-Version: 119.0.0.0',
      labels: [],
      created_at: new Date().toISOString(),
    };

    it('adds target branch labels instead of no-backport for chromium rolls on main', async () => {
      mockOctokit.paginate.mockReturnValue([]);
      vi.mocked(getBranchesTrackedByMain).mockResolvedValue(['44-x-y', '45-x-y']);

      await expect(
        roll({
          rollTarget: ROLL_TARGETS.chromium,
          electronBranch: mainBranch,
          targetVersion: '152.0.0.0',
        }),
      ).resolves.toEqual(['44-x-y', '45-x-y']);

      expect(getBranchesTrackedByMain).toHaveBeenCalledWith(mockOctokit, 152);
      expect(mockOctokit.issues.addLabels).toHaveBeenCalledWith(
        expect.objectContaining({
          labels: ['target/44-x-y', 'target/45-x-y', 'semver/patch'],
        }),
      );
    });

    it('adds no-backport for chromium rolls on main when no target branch applies', async () => {
      mockOctokit.paginate.mockReturnValue([]);
      vi.mocked(getBranchesTrackedByMain).mockResolvedValue([]);

      await expect(
        roll({
          rollTarget: ROLL_TARGETS.chromium,
          electronBranch: mainBranch,
          targetVersion: '160.0.0.0',
        }),
      ).resolves.toEqual([]);

      expect(mockOctokit.issues.addLabels).toHaveBeenCalledWith(
        expect.objectContaining({
          labels: [NO_BACKPORT, 'semver/patch'],
        }),
      );
    });

    it('falls back to no-backport on a new PR if target branches cannot be determined', async () => {
      mockOctokit.paginate.mockReturnValue([]);
      vi.mocked(getBranchesTrackedByMain).mockRejectedValue(new Error('schedule unavailable'));

      await expect(
        roll({
          rollTarget: ROLL_TARGETS.chromium,
          electronBranch: mainBranch,
          targetVersion: '152.0.0.0',
        }),
      ).resolves.toEqual([]);

      expect(mockOctokit.pulls.create).toHaveBeenCalled();
      expect(mockOctokit.issues.addLabels).toHaveBeenCalledWith(
        expect.objectContaining({
          labels: [NO_BACKPORT, 'semver/patch'],
        }),
      );
    });

    it('leaves the labels of an existing PR unchanged if target branches cannot be determined', async () => {
      mockOctokit.paginate.mockReturnValue([existingMainChromiumPr]);
      mockOctokit.issues.listLabelsOnIssue.mockReturnValue({
        data: [{ name: 'target/45-x-y' }],
      });
      vi.mocked(getBranchesTrackedByMain).mockRejectedValue(new Error('schedule unavailable'));

      await expect(
        roll({
          rollTarget: ROLL_TARGETS.chromium,
          electronBranch: mainBranch,
          targetVersion: '154.0.0.0',
        }),
      ).resolves.toEqual([]);

      // The PR keeps its existing backport labels: nothing is removed, and
      // neither no-backport nor target labels are added on top of them.
      expect(mockOctokit.issues.removeLabel).not.toHaveBeenCalled();
      expect(mockOctokit.issues.addLabels).toHaveBeenCalledWith(
        expect.objectContaining({
          labels: ['semver/patch'],
        }),
      );
    });

    it('falls back without fetching the schedule for an invalid target version', async () => {
      mockOctokit.paginate.mockReturnValue([]);

      await roll({
        rollTarget: ROLL_TARGETS.chromium,
        electronBranch: mainBranch,
        targetVersion: 'not-a-version',
      });

      expect(getBranchesTrackedByMain).not.toHaveBeenCalled();
      expect(mockOctokit.issues.removeLabel).not.toHaveBeenCalled();
      expect(mockOctokit.issues.addLabels).toHaveBeenCalledWith(
        expect.objectContaining({
          labels: [NO_BACKPORT, 'semver/patch'],
        }),
      );
    });

    it('removes stale roller-managed labels that no longer apply', async () => {
      mockOctokit.paginate.mockReturnValue([]);
      mockOctokit.issues.listLabelsOnIssue.mockReturnValue({
        data: [
          { name: NO_BACKPORT },
          { name: 'target/43-x-y' },
          { name: 'target/4-0-x' },
          { name: 'target/45-x-y' },
          { name: 'merged/44-x-y' },
          { name: 'in-flight/45-x-y' },
          { name: 'semver/patch' },
        ],
      });
      vi.mocked(getBranchesTrackedByMain).mockResolvedValue(['45-x-y']);

      await roll({
        rollTarget: ROLL_TARGETS.chromium,
        electronBranch: mainBranch,
        targetVersion: '154.0.0.0',
      });

      // target/43-x-y and target/4-0-x no longer qualify and no-backport
      // conflicts with the target labels that do - all three are removed,
      // nothing else is touched.
      expect(mockOctokit.issues.removeLabel).toHaveBeenCalledTimes(3);
      expect(mockOctokit.issues.removeLabel).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'target/43-x-y' }),
      );
      expect(mockOctokit.issues.removeLabel).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'target/4-0-x' }),
      );
      expect(mockOctokit.issues.removeLabel).toHaveBeenCalledWith(
        expect.objectContaining({ name: NO_BACKPORT }),
      );
    });

    it('removes stale target labels but keeps no-backport when no target branch applies', async () => {
      mockOctokit.paginate.mockReturnValue([]);
      mockOctokit.issues.listLabelsOnIssue.mockReturnValue({
        data: [{ name: NO_BACKPORT }, { name: 'target/45-x-y' }],
      });
      vi.mocked(getBranchesTrackedByMain).mockResolvedValue([]);

      await roll({
        rollTarget: ROLL_TARGETS.chromium,
        electronBranch: mainBranch,
        targetVersion: '160.0.0.0',
      });

      expect(mockOctokit.issues.removeLabel).toHaveBeenCalledTimes(1);
      expect(mockOctokit.issues.removeLabel).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'target/45-x-y' }),
      );
    });

    it('does not transition backport labels if a stale label removal fails', async () => {
      mockOctokit.paginate.mockReturnValue([existingMainChromiumPr]);
      mockOctokit.issues.listLabelsOnIssue.mockReturnValue({
        data: [{ name: 'target/43-x-y' }],
      });
      mockOctokit.issues.removeLabel.mockRejectedValue(new Error('server error'));
      vi.mocked(getBranchesTrackedByMain).mockResolvedValue(['45-x-y']);

      // The stale target/43-x-y could not be confirmed removed, so the new
      // label set must not be applied on top of it - and the failure must not
      // fail the roll.
      await expect(
        roll({
          rollTarget: ROLL_TARGETS.chromium,
          electronBranch: mainBranch,
          targetVersion: '154.0.0.0',
        }),
      ).resolves.toEqual([]);

      expect(mockOctokit.issues.addLabels).toHaveBeenCalledWith(
        expect.objectContaining({
          labels: ['semver/patch'],
        }),
      );
    });

    it('treats an already-removed stale label as removed', async () => {
      mockOctokit.paginate.mockReturnValue([]);
      mockOctokit.issues.listLabelsOnIssue.mockReturnValue({
        data: [{ name: NO_BACKPORT }],
      });
      mockOctokit.issues.removeLabel.mockRejectedValue(
        Object.assign(new Error('Not Found'), { status: 404 }),
      );
      vi.mocked(getBranchesTrackedByMain).mockResolvedValue(['45-x-y']);

      await expect(
        roll({
          rollTarget: ROLL_TARGETS.chromium,
          electronBranch: mainBranch,
          targetVersion: '154.0.0.0',
        }),
      ).resolves.toEqual(['45-x-y']);

      expect(mockOctokit.issues.addLabels).toHaveBeenCalledWith(
        expect.objectContaining({
          labels: ['target/45-x-y', 'semver/patch'],
        }),
      );
    });

    it('reconciles labels on an existing PR even when the DEPS version is unchanged', async () => {
      mockOctokit.paginate.mockReturnValue([existingMainChromiumPr]);
      mockOctokit.issues.listLabelsOnIssue.mockReturnValue({
        data: [{ name: 'target/45-x-y' }],
      });
      vi.mocked(updateDepsFile).mockResolvedValue({
        previousDEPSVersion: '154.0.0.0',
        newDEPSVersion: '154.0.0.0',
      });
      // A newly cut release branch appears in the schedule without any DEPS
      // change - the open roll PR must still gain its target label.
      vi.mocked(getBranchesTrackedByMain).mockResolvedValue(['45-x-y', '46-x-y']);

      await expect(
        roll({
          rollTarget: ROLL_TARGETS.chromium,
          electronBranch: mainBranch,
          targetVersion: '154.0.0.0',
        }),
      ).resolves.toEqual(['45-x-y', '46-x-y']);

      expect(mockOctokit.pulls.update).not.toHaveBeenCalled();
      expect(mockOctokit.issues.addLabels).toHaveBeenCalledWith(
        expect.objectContaining({
          labels: ['target/45-x-y', 'target/46-x-y', 'semver/patch'],
        }),
      );
    });

    it('adds no-backport for node rolls on main without checking the schedule', async () => {
      mockOctokit.paginate.mockReturnValue([]);

      await roll({
        rollTarget: ROLL_TARGETS.node,
        electronBranch: mainBranch,
        targetVersion: 'v10.0.0',
      });

      expect(getBranchesTrackedByMain).not.toHaveBeenCalled();
      expect(mockOctokit.issues.addLabels).toHaveBeenCalledWith(
        expect.objectContaining({
          labels: [NO_BACKPORT, 'semver/patch'],
        }),
      );
    });

    it('adds backport-check-skip for chromium rolls on a release branch', async () => {
      mockOctokit.paginate.mockReturnValue([]);

      await roll({
        rollTarget: ROLL_TARGETS.chromium,
        electronBranch: branch,
        targetVersion: '152.0.0.0',
      });

      expect(getBranchesTrackedByMain).not.toHaveBeenCalled();
      expect(mockOctokit.issues.addLabels).toHaveBeenCalledWith(
        expect.objectContaining({
          labels: [BACKPORT_CHECK_SKIP, 'semver/patch'],
        }),
      );
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
          ref: `roller/${ROLL_TARGETS.node.name}/${branch.name}`,
          repo: { full_name: `${REPOS.electron.owner}/${REPOS.electron.repo}` },
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
