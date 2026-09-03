import type { Octokit } from '@octokit/rest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getSupportedBranches } from '../../src/utils/get-supported-branches.js';

describe('getSupportedBranches', () => {
  let graphql: ReturnType<typeof vi.fn>;
  let octokit: Octokit;

  beforeEach(() => {
    graphql = vi.fn();
    octokit = { graphql } as unknown as Octokit;
  });

  it('returns the most recent release branches', async () => {
    graphql.mockResolvedValueOnce({
      repository: {
        refs: {
          nodes: ['30-x-y', '31-x-y', '32-x-y', '33-x-y', '34-x-y'].map((name) => ({
            name,
            target: { oid: `${name}-sha` },
          })),
        },
      },
    });

    await expect(getSupportedBranches(octokit)).resolves.toEqual(
      ['31-x-y', '32-x-y', '33-x-y', '34-x-y'].map((name) => ({
        name,
        commit: { sha: `${name}-sha` },
      })),
    );
    expect(graphql).toHaveBeenCalledOnce();
    expect(graphql).toHaveBeenCalledWith(expect.any(String), {
      owner: 'electron',
      repo: 'electron',
      branchQuery: '-x-y',
    });
  });

  it('filters invalid branches and honors the requested release count', async () => {
    graphql.mockResolvedValueOnce({
      repository: {
        refs: {
          nodes: ['32-x-y', 'not-x-y-valid', '33-x-y', '34-xx-y', '34-x-y'].map((name) => ({
            name,
            target: { oid: `${name}-sha` },
          })),
        },
      },
    });

    const branches = await getSupportedBranches(octokit, 2);

    expect(branches.map((branch) => branch.name)).toEqual(['33-x-y', '34-x-y']);
  });
});
