import { roll } from '../../src/utils/roll';
import { getOctokit } from '../../src/utils/octokit';
import { ROLL_TARGETS, PR_USER, REPOS } from '../../src/constants';
import { updateDepsFile } from '../../src/utils/update-deps';

jest.mock('../../src/utils/octokit');
jest.mock('../../src/utils/update-deps');

describe('roll()', () => {
  const branch = {
    name: 'testBranch',
    commit: {
      sha: 'asdsad',
      url: 'asdsadsad'
    },
    protected: true,
    protection: {
      enabled: false,
      required_status_checks: {
        enforcement_level: '',
        contexts: []
      }
    },
    protection_url: 'asdasd'
  };

  beforeEach(() => {
    this.mockOctokit = {
      paginate: jest.fn(),
      pulls: {
        update: jest.fn(),
        create: jest.fn().mockReturnValue({data: {html_url: 'https://google.com'}})
      },
      git: {
        createRef: jest.fn()
      }
    };
    (getOctokit as jest.Mock).mockReturnValue(this.mockOctokit);
    (updateDepsFile as jest.Mock).mockReturnValue({
      previousDEPSVersion: 'v4.0.0',
      newDEPSVersion: 'v10.0.0'
    });
  });
  
  it('takes no action if versions are identical', async () => {
    this.mockOctokit.paginate.mockReturnValue(
      [{
        user: {
          login: PR_USER
        },
        title: ROLL_TARGETS.node.name,
        number: 1,
        head: {
          ref: 'asd'
        },
        body: 'Original-Version: v4.0.0',
        created_at: (new Date()).toISOString()
      }]
    );

    (updateDepsFile as jest.Mock).mockReturnValue({
      previousDEPSVersion: 'v4.0.0',
      newDEPSVersion: 'v4.0.0'
    });

    await roll({
      rollTarget: ROLL_TARGETS.node,
      electronBranch: branch,
      targetVersion: 'v4.0.0'
    });

    expect(this.mockOctokit.pulls.update).not.toHaveBeenCalled();
    expect(this.mockOctokit.pulls.create).not.toHaveBeenCalled();
  });

  it('updates a PR if existing PR already exists', async () => {
    this.mockOctokit.paginate.mockReturnValue(
      [{
        user: {
          login: PR_USER
        },
        title: ROLL_TARGETS.node.name,
        number: 1,
        head: {
          ref: 'asd'
        },
        body: 'Original-Version: v4.0.0',
        created_at: (new Date()).toISOString()
      }]
    );

    await roll({
      rollTarget: ROLL_TARGETS.node,
      electronBranch: branch,
      targetVersion: 'v10.0.0'
    });

    expect(this.mockOctokit.pulls.update).toHaveBeenCalledWith(expect.objectContaining({
      ...REPOS.electron,
      pull_number: 1,
      title: expect.stringContaining(`bump ${ROLL_TARGETS.node.name} to v10.0.0 (${branch.name})`),
      body: expect.stringContaining('Original-Version: v4.0.0'),
    }));
  });

  it('creates a new PR if none found', async () => {
    this.mockOctokit.paginate.mockReturnValue([]);

    await roll({
      rollTarget: ROLL_TARGETS.node,
      electronBranch: branch,
      targetVersion: 'v10.0.0'
    });

    const newBranchName = `roller/${ROLL_TARGETS.node.name}/${branch.name}`;

    expect(this.mockOctokit.git.createRef).toHaveBeenCalledWith({
      ...REPOS.electron,
      ref: `refs/heads/${newBranchName}`,
      sha: branch.commit.sha
    });

    expect(this.mockOctokit.pulls.create).toHaveBeenCalledWith(expect.objectContaining({
      ...REPOS.electron,
      base: branch.name,
      head: `${REPOS.electron.owner}:${newBranchName}`
    }));
  });

  it('skips PR if existing one is stale', async () => {
    this.mockOctokit.paginate.mockReturnValue(
      [{
        user: {
          login: PR_USER
        },
        title: ROLL_TARGETS.node.name,
        number: 1,
        head: {
          ref: 'asd'
        },
        body: 'Original-Version: v4.0.0',
        created_at: (new Date('December 17, 1995 03:24:00')).toISOString()
      }]
    );

    await roll({
      rollTarget: ROLL_TARGETS.node,
      electronBranch: branch,
      targetVersion: 'v10.0.0'
    });

    expect(this.mockOctokit.pulls.update).not.toHaveBeenCalled();
  })
});
