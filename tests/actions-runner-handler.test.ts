import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as arcImage from '../src/utils/arc-image';
import * as getLatestRunnerImagesModule from '../src/utils/get-latest-runner-images';
import * as rollInfraModule from '../src/utils/roll-infra';
import * as constants from '../src/constants';
import { getOctokit } from '../src/utils/octokit';

import { rollActionsRunner } from '../src/actions-runner-handler';

vi.mock('debug', () => ({ default: vi.fn(() => vi.fn()) }));
vi.mock('../src/utils/get-latest-runner-images');
vi.mock('../src/utils/arc-image');
vi.mock('../src/utils/roll-infra');
vi.mock('../src/utils/octokit');

const mockOctokit = {};

const mockFileContent = (raw: string) => ({ raw, sha: 'sha' });

const latestVersion = '2.325.0';
const archDigests = {
  amd64: '2.325.0@sha256:amd64digest',
  arm64: '2.325.0@sha256:arm64digest',
};

const newWinDockerFile = 'ARG RUNNER_VERSION=2.325.0';
const oldWinDockerFile = 'ARG RUNNER_VERSION=2.324.0';

const oldLinuxImages = {
  amd64: '2.324.0@sha256:oldamd64',
  arm64: '2.324.0@sha256:oldarm64',
};
const newLinuxImages = {
  amd64: archDigests.amd64,
  arm64: archDigests.arm64,
};

function generateFileContent(images) {
  return `
    {{- if eq .cpuArch "amd64" }}
    image: ghcr.io/actions/actions-runner:${images.amd64}
    {{- else }}
    image: ghcr.io/actions/actions-runner:${images.arm64}
    {{- end }}
    {{ more content here }}
    {{- if eq .cpuArch "amd64" }}
    image: ghcr.io/actions/actions-runner:${images.amd64}
    {{- else }}
    image: ghcr.io/actions/actions-runner:${images.arm64}
    {{- end }}
    `;
}

const oldLinuxFileContent = generateFileContent(oldLinuxImages);
const newLinuxFileContent = generateFileContent(newLinuxImages);

beforeEach(() => {
  vi.clearAllMocks();
  (getOctokit as any).mockResolvedValue(mockOctokit);
  vi.mocked(getLatestRunnerImagesModule.getLatestRunnerImages).mockResolvedValue({
    archDigests,
    latestVersion,
  });
  vi.mocked(arcImage.getFileContent).mockImplementation(async (_octokit: any, file: string) => {
    if (file === constants.WINDOWS_DOCKER_FILE) return mockFileContent(oldWinDockerFile);
    if (file === constants.ARC_RUNNER_ENVIRONMENTS.prod)
      return mockFileContent(generateFileContent(oldLinuxImages));
    return mockFileContent('');
  });
  vi.mocked(arcImage.getCurrentWindowsRunnerVersion).mockImplementation(
    async (raw: string) => raw.match(/([\d.]+)/)?.[1] || '',
  );
  vi.mocked(arcImage.currentLinuxImages).mockImplementation((raw: string) => {
    if (raw.includes('oldamd64')) return oldLinuxImages;
    return newLinuxImages;
  });
  vi.mocked(rollInfraModule.rollInfra).mockResolvedValue(undefined);
});

describe('rollActionsRunner', () => {
  it('should update both linx and windows if version is outdated', async () => {
    await rollActionsRunner();
    expect(rollInfraModule.rollInfra).toHaveBeenCalledTimes(2);
    expect(rollInfraModule.rollInfra).toHaveBeenNthCalledWith(
      1,
      'prod/actions-runner',
      'github actions runner images',
      latestVersion,
      constants.WINDOWS_DOCKER_FILE,
      newWinDockerFile,
    );
    expect(rollInfraModule.rollInfra).toHaveBeenNthCalledWith(
      2,
      'prod/actions-runner',
      'github actions runner images',
      latestVersion,
      constants.ARC_RUNNER_ENVIRONMENTS.prod,
      newLinuxFileContent,
    );
  });

  it('should update windows runner if version is outdated', async () => {
    vi.mocked(arcImage.getFileContent).mockImplementation(async (_octokit: any, file: string) => {
      if (file === constants.WINDOWS_DOCKER_FILE) return mockFileContent(oldWinDockerFile);
      if (file === constants.ARC_RUNNER_ENVIRONMENTS.prod)
        return mockFileContent(newLinuxFileContent);
      return mockFileContent('');
    });
    await rollActionsRunner();
    expect(rollInfraModule.rollInfra).toHaveBeenCalledTimes(1);
    expect(rollInfraModule.rollInfra).toHaveBeenCalledWith(
      'prod/actions-runner',
      'github actions runner images',
      latestVersion,
      constants.WINDOWS_DOCKER_FILE,
      newWinDockerFile,
    );
  });

  it('should update linux images if digests are outdated', async () => {
    vi.mocked(arcImage.getFileContent).mockImplementation(async (_octokit: any, file: string) => {
      if (file === constants.WINDOWS_DOCKER_FILE) return mockFileContent(newWinDockerFile);
      if (file === constants.ARC_RUNNER_ENVIRONMENTS.prod)
        return mockFileContent(oldLinuxFileContent);
      return mockFileContent('');
    });

    await rollActionsRunner();
    expect(rollInfraModule.rollInfra).toHaveBeenCalledTimes(1);
    expect(rollInfraModule.rollInfra).toHaveBeenCalledWith(
      'prod/actions-runner',
      'github actions runner images',
      latestVersion,
      constants.ARC_RUNNER_ENVIRONMENTS.prod,
      newLinuxFileContent,
    );
  });

  it('should skip update if everything is up-to-date', async () => {
    vi.mocked(arcImage.getFileContent).mockImplementation(async (_octokit: any, file: string) => {
      if (file === constants.WINDOWS_DOCKER_FILE) return mockFileContent(newWinDockerFile);
      if (file === constants.ARC_RUNNER_ENVIRONMENTS.prod)
        return mockFileContent(newLinuxFileContent);
      return mockFileContent('');
    });
    vi.mocked(arcImage.getCurrentWindowsRunnerVersion).mockImplementation(
      async (raw: string) => latestVersion,
    );
    vi.mocked(arcImage.currentLinuxImages).mockImplementation((raw: string) => newLinuxImages);
    await rollActionsRunner();
    expect(rollInfraModule.rollInfra).not.toHaveBeenCalled();
  });
});
