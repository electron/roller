import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getLatestRunnerImages } from '../../src/utils/get-latest-runner-images';
import { Octokit } from '@octokit/rest';

global.fetch = vi.fn();
console.error = vi.fn();

const mockOctokit = {
  rest: {
    packages: {
      getAllPackageVersionsForPackageOwnedByOrg: vi.fn(),
    },
  },
} as unknown as Octokit;

describe('getLatestRunnerImages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns digests and version when successful', async () => {
    (mockOctokit.rest.packages.getAllPackageVersionsForPackageOwnedByOrg as any).mockResolvedValue({
      data: [
        {
          metadata: {
            container: {
              tags: ['latest', '2.325.0'],
            },
          },
        },
      ],
    });
    (fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        manifests: [
          { platform: { os: 'linux', architecture: 'amd64' }, digest: 'sha256:amd64digest' },
          { platform: { os: 'linux', architecture: 'arm64' }, digest: 'sha256:arm64digest' },
        ],
      }),
    });
    const result = await getLatestRunnerImages(mockOctokit);
    expect(result).toEqual({
      archDigests: {
        amd64: 'sha256:amd64digest',
        arm64: 'sha256:arm64digest',
      },
      latestVersion: '2.325.0',
    });
  });

  it('returns null if no version with latest tag', async () => {
    (mockOctokit.rest.packages.getAllPackageVersionsForPackageOwnedByOrg as any).mockResolvedValue({
      data: [{ metadata: { container: { tags: ['2.325.0'] } } }],
    });
    const result = await getLatestRunnerImages(mockOctokit);
    expect(result).toBeNull();
  });

  it('returns null if no semver tag found', async () => {
    (mockOctokit.rest.packages.getAllPackageVersionsForPackageOwnedByOrg as any).mockResolvedValue({
      data: [{ metadata: { container: { tags: ['latest'] } } }],
    });
    const result = await getLatestRunnerImages(mockOctokit);
    expect(result).toBeNull();
  });

  it('returns null if fetch throws', async () => {
    (mockOctokit.rest.packages.getAllPackageVersionsForPackageOwnedByOrg as any).mockResolvedValue({
      data: [{ metadata: { container: { tags: ['latest', '2.325.0'] } } }],
    });
    (fetch as any).mockRejectedValue(new Error('fail'));
    const result = await getLatestRunnerImages(mockOctokit);
    expect(result).toBeNull();
  });

  it('returns null if no digests found', async () => {
    (mockOctokit.rest.packages.getAllPackageVersionsForPackageOwnedByOrg as any).mockResolvedValue({
      data: [{ metadata: { container: { tags: ['latest', '2.325.0'] } } }],
    });
    (fetch as any).mockResolvedValue({
      json: async () => ({ manifests: [] }),
    });
    const result = await getLatestRunnerImages(mockOctokit);
    expect(result).toBeNull();
  });
});
