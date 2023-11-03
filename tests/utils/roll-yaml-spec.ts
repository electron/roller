import { yamlRoll } from '../../src/utils/roll-yaml';
import { getOctokit } from '../../src/utils/octokit';

jest.mock('../../src/utils/octokit');

describe('yamlRoll()', () => {
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
            content: Buffer.from('orb:\n  node: v1.0.0\n').toString('base64'),
          },
        }),
        createOrUpdateFileContents: jest.fn(),
      },
    };
    (getOctokit as jest.Mock).mockReturnValue(mockOctokit);
  });

  it('should not update the YAML file if the target value is the same as the current value', async () => {
    const rollTarget = {
      name: 'node-orb',
      key: ['orb', 'node'],
    };
    const targetValue = 'v1.0.0';
    const repository = {
      owner: 'electron',
      repo: 'forge',
    };
    await yamlRoll({
      rollTarget,
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

  it.only('should update the YAML file and create a pull request', async () => {
    const rollTarget = {
      name: 'node-orb',
      key: ['orb', 'node'],
    };
    const targetValue = 'v2.0.0';
    const repository = {
      owner: 'electron',
      repo: 'forge',
    };
    await yamlRoll({
      rollTarget,
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
      ref: `refs/heads/roller/${rollTarget.name}/${branch.name}`,
      sha: branch.commit.sha,
    });
    expect(mockOctokit.repos.createOrUpdateFileContents).toHaveBeenCalledWith({
      owner: repository.owner,
      repo: repository.repo,
      path: '.circleci/config.yml',
      message: `chore: bump ${rollTarget.key.join(
        '.',
      )} in .circleci/circleci.yml to ${targetValue}`,
      content: Buffer.from('orb:\n  node: v2.0.0\n').toString('base64'),
      branch: `roller/${rollTarget.name}/${branch.name}`,
    });
    expect(mockOctokit.pulls.create).toHaveBeenCalled();
  });
});
