import { rollOrb } from '../../src/utils/roll-orb';
import { getOctokit } from '../../src/utils/octokit';
import { Repository, OrbTarget, MAIN_BRANCH } from '../../src/constants';

jest.mock('../../src/utils/octokit');

describe('rollOrb()', () => {
  let mockOctokit: any;
  const branch = {
    name: 'main',
    commit: {
      sha: '123',
    },
    protected: true,
    protection: {
      enabled: false,
      required_status_checks: {
        enforcement_level: '',
        contexts: [],
      },
    },
    protection_url: 'asdasd',
  };

  beforeEach(() => {
    mockOctokit = {
      paginate: jest.fn(),
      pulls: {
        create: jest.fn().mockReturnValue({ data: { html_url: 'https://google.com' } }),
        update: jest.fn(),
      },
      git: {
        createRef: jest.fn(),
      },
      repos: {
        getContent: jest.fn().mockReturnValue({
          data: {
            type: 'file',
            content: Buffer.from('orbs:\n  node: electronjs/node@1.0.0\n').toString('base64'),
            sha: '1234',
          },
        }),
        createOrUpdateFileContents: jest.fn(),
      },
    };
    (getOctokit as jest.Mock).mockReturnValue(mockOctokit);
  });

  it('takes no action if versions are identical', async () => {
    const orbTarget: OrbTarget = {
      name: 'electronjs/node',
      owner: 'electron',
      repo: 'node-orb',
    };

    mockOctokit.paginate.mockReturnValue([
      {
        user: {
          login: 'electron-roller[bot]',
        },
        title: `chore: bump ${orbTarget.name} to foo`,
        number: 1,
        head: {
          ref: 'asd',
        },
        body: 'Original-Version: 1.0.0',
        labels: [{ name: 'hello' }, { name: 'goodbye' }],
        created_at: new Date().toISOString(),
      },
    ]);

    const targetOrbVersion = '1.0.0';
    const repository: Repository = {
      owner: 'electron',
      repo: 'forge',
    };
    await rollOrb(orbTarget, branch.commit.sha, targetOrbVersion, repository, MAIN_BRANCH);

    expect(mockOctokit.repos.getContent).toHaveBeenCalledWith({
      owner: repository.owner,
      repo: repository.repo,
      ref: `roller/orb/${orbTarget.name}/${branch.name}`,
      path: '.circleci/config.yml',
    });

    expect(mockOctokit.pulls.update).not.toHaveBeenCalled();
    expect(mockOctokit.repos.createOrUpdateFileContents).not.toHaveBeenCalled();
    expect(mockOctokit.pulls.create).not.toHaveBeenCalled();
  });

  it('updates a PR if existing PR already exists', async () => {
    const orbTarget: OrbTarget = {
      name: 'electronjs/node',
      owner: 'electron',
      repo: 'node-orb',
    };

    const repository: Repository = {
      owner: 'electron',
      repo: 'forge',
    };

    mockOctokit.paginate.mockReturnValue([
      {
        user: {
          login: 'electron-roller[bot]',
        },
        title: `chore: bump ${orbTarget.name} to bar`,
        number: 1,
        head: {
          ref: 'asd',
        },
        body: 'Original-Version: 1.0.0',
        labels: [{ name: 'hello' }, { name: 'goodbye' }],
        created_at: new Date().toISOString(),
      },
    ]);

    await rollOrb(orbTarget, branch.commit.sha, '2.0.0', repository, MAIN_BRANCH);

    expect(mockOctokit.pulls.update).toHaveBeenCalledWith(
      expect.objectContaining({
        ...repository,
        pull_number: 1,
        title: expect.stringContaining(`bump ${orbTarget.name} to 2.0.0 (${branch.name})`),
        body: expect.stringContaining('Original-Version: 1.0.0'),
      }),
    );
  });

  it('creates a new PR if none found', async () => {
    mockOctokit.paginate.mockReturnValue([]);
    const orbTarget: OrbTarget = {
      name: 'electronjs/node',
      owner: 'electron',
      repo: 'node-orb',
    };

    const targetOrbVersion = '2.0.0';
    const repository: Repository = {
      owner: 'electron',
      repo: 'forge',
    };
    await rollOrb(orbTarget, branch.commit.sha, targetOrbVersion, repository, MAIN_BRANCH);

    expect(mockOctokit.repos.getContent).toHaveBeenCalledWith({
      owner: repository.owner,
      repo: repository.repo,
      ref: undefined,
      path: '.circleci/config.yml',
    });

    expect(mockOctokit.git.createRef).toHaveBeenCalledWith({
      owner: repository.owner,
      repo: repository.repo,
      ref: `refs/heads/roller/orb/${orbTarget.name}/${branch.name}`,
      sha: branch.commit.sha,
    });
    expect(mockOctokit.repos.createOrUpdateFileContents).toHaveBeenCalledWith({
      owner: repository.owner,
      repo: repository.repo,
      sha: '1234',
      path: '.circleci/config.yml',
      message: `chore: bump ${orbTarget.name} in .circleci/config.yml to ${targetOrbVersion}`,
      content: Buffer.from('orbs:\n  node: electronjs/node@2.0.0\n').toString('base64'),
      branch: `roller/orb/${orbTarget.name}/${branch.name}`,
    });
    expect(mockOctokit.pulls.create).toHaveBeenCalledWith(
      expect.objectContaining({
        ...repository,
        base: branch.name,
        head: `${repository.owner}:roller/orb/${orbTarget.name}/${branch.name}`,
      }),
    );
  });

  it('skips PR if existing one has been paused', async () => {
    const orbTarget: OrbTarget = {
      name: 'electronjs/node',
      owner: 'electron',
      repo: 'node-orb',
    };

    const targetOrbVersion = '2.0.0';
    const repository: Repository = {
      owner: 'electron',
      repo: 'forge',
    };
    mockOctokit.paginate.mockReturnValue([
      {
        user: {
          login: 'electron-roller[bot]',
        },
        title: orbTarget.name,
        number: 1,
        head: {
          ref: 'asd',
        },
        body: 'Original-Version: v4.0.0',
        labels: [{ name: 'roller/pause' }],
        created_at: new Date('December 17, 1995 03:24:00').toISOString(),
      },
    ]);

    await rollOrb(orbTarget, branch.commit.sha, targetOrbVersion, repository, MAIN_BRANCH);

    expect(mockOctokit.pulls.update).not.toHaveBeenCalled();
  });
});
