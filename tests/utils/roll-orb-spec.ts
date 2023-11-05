import { rollOrb } from '../../src/utils/roll-orb';
import { getOctokit } from '../../src/utils/octokit';
import { Repository, OrbTarget } from '../../src/constants';

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
      pulls: {
        create: jest.fn().mockReturnValue({ data: { html_url: 'https://google.com' } }),
      },
      git: {
        createRef: jest.fn(),
      },
      repos: {
        getContent: jest.fn().mockReturnValue({
          data: {
            type: 'file',
            content: Buffer.from('orbs:\n  node: electronjs/node@1.0.0\n').toString('base64'),
          },
        }),
        createOrUpdateFileContents: jest.fn(),
      },
    };
    (getOctokit as jest.Mock).mockReturnValue(mockOctokit);
  });

  it('should not update the YAML file if the target value is the same as the current value', async () => {
    const orbTarget: OrbTarget = {
      name: 'electronjs/node',
      owner: 'electron',
      repo: 'node-orb',
    };
    const targetValue = '1.0.0';
    const repository: Repository = {
      owner: 'electron',
      repo: 'forge',
    };
    await rollOrb({
      orbTarget,
      electronBranch: branch,
      targetValue,
      repository,
    });

    expect(mockOctokit.repos.getContent).toHaveBeenCalledWith({
      owner: repository.owner,
      repo: repository.repo,
      path: '.circleci/config.yml',
    });

    expect(mockOctokit.git.createRef).not.toHaveBeenCalled();
    expect(mockOctokit.repos.createOrUpdateFileContents).not.toHaveBeenCalled();
    expect(mockOctokit.pulls.create).not.toHaveBeenCalled();
  });

  it('should update the YAML file and create a pull request', async () => {
    const orbTarget: OrbTarget = {
      name: 'electronjs/node',
      owner: 'electron',
      repo: 'node-orb',
    };

    const targetValue = '2.0.0';
    const repository: Repository = {
      owner: 'electron',
      repo: 'forge',
    };
    await rollOrb({
      orbTarget: orbTarget,
      electronBranch: branch,
      targetValue,
      repository,
    });

    expect(mockOctokit.repos.getContent).toHaveBeenCalledWith({
      owner: repository.owner,
      repo: repository.repo,
      path: '.circleci/config.yml',
    });

    expect(mockOctokit.git.createRef).toHaveBeenCalledWith({
      owner: repository.owner,
      repo: repository.repo,
      ref: `refs/heads/roller/${orbTarget.name}/${branch.name}`,
      sha: branch.commit.sha,
    });
    expect(mockOctokit.repos.createOrUpdateFileContents).toHaveBeenCalledWith({
      owner: repository.owner,
      repo: repository.repo,
      path: '.circleci/config.yml',
      message: `chore: bump ${orbTarget.name} in .circleci/config.yml to ${targetValue}`,
      content: Buffer.from('orbs:\n  node: electronjs/node@2.0.0\n').toString('base64'),
      branch: `roller/${orbTarget.name}/${branch.name}`,
    });
    expect(mockOctokit.pulls.create).toHaveBeenCalled();
  });
});
