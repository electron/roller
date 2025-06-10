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
  amd64: 'sha256:amd64digest',
  arm64: 'sha256:arm64digest',
};

const newWinDockerFile = 'ARG RUNNER_VERSION=2.325.0';
const oldWinDockerFile = 'ARG RUNNER_VERSION=2.324.0';

const oldLinuxImages = {
  amd64: 'ghcr.io/actions/actions-runner:2.324.0@sha256:oldamd64',
  arm64: 'ghcr.io/actions/actions-runner:2.324.0@sha256:oldarm64',
};
const newLinuxImages = {
  amd64: archDigests.amd64,
  arm64: archDigests.arm64,
};

beforeEach(() => {
  vi.clearAllMocks();
  (getOctokit as any).mockResolvedValue(mockOctokit);
  (getLatestRunnerImagesModule.getLatestRunnerImages as any).mockResolvedValue({
    archDigests,
    latestVersion,
  });
  (arcImage.getFileContent as any).mockImplementation(async (_octokit: any, file: string) => {
    if (file === constants.WINDOWS_DOCKER_FILE) return mockFileContent(oldWinDockerFile);
    if (file === constants.ARC_RUNNER_ENVIRONMENTS.prod)
      return mockFileContent(`amd64: ${oldLinuxImages.amd64}\narm64: ${oldLinuxImages.arm64}`);
    return mockFileContent('');
  });
  (arcImage.getCurrentWindowsRunnerVersion as any).mockImplementation(
    async (raw: string) => raw.match(/([\d.]+)/)?.[1] || '',
  );
  (arcImage.currentLinuxImages as any).mockImplementation((raw: string) => {
    if (raw.includes('oldamd64')) return oldLinuxImages;
    return newLinuxImages;
  });
  (rollInfraModule.rollInfra as any).mockResolvedValue(undefined);
});

describe('rollActionsRunner', () => {
  it('should update windows runner if version is outdated', async () => {
    await rollActionsRunner();
    expect(rollInfraModule.rollInfra).toHaveBeenCalledWith(
      'prod/actions-runner',
      'github actions runner images',
      latestVersion,
      constants.WINDOWS_DOCKER_FILE,
      expect.stringContaining(latestVersion),
    );
  });

  it('should update linux images if digests are outdated', async () => {
    await rollActionsRunner();
    expect(rollInfraModule.rollInfra).toHaveBeenCalledWith(
      'prod/actions-runner',
      'github actions runner images',
      latestVersion,
      constants.ARC_RUNNER_ENVIRONMENTS.prod,
      expect.any(String),
    );
  });

  it('should skip update if everything is up-to-date', async () => {
    (arcImage.getFileContent as any).mockImplementation(async (_octokit: any, file: string) => {
      if (file === constants.WINDOWS_DOCKER_FILE) return mockFileContent(newWinDockerFile);
      if (file === constants.ARC_RUNNER_ENVIRONMENTS.prod)
        return mockFileContent(`amd64: ${archDigests.amd64}\narm64: ${archDigests.arm64}`);
      return mockFileContent('');
    });
    (arcImage.getCurrentWindowsRunnerVersion as any).mockImplementation(
      async (raw: string) => latestVersion,
    );
    (arcImage.currentLinuxImages as any).mockImplementation((raw: string) => newLinuxImages);
    await rollActionsRunner();
    expect(rollInfraModule.rollInfra).not.toHaveBeenCalled();
  });
});
