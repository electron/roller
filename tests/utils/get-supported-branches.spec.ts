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
          pageInfo: { hasNextPage: false, endCursor: null },
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
      cursor: null,
    });
  });

  it('fetches every page of release branches', async () => {
    graphql
      .mockResolvedValueOnce({
        repository: {
          refs: {
            nodes: ['30-x-y', '31-x-y', '32-x-y', '33-x-y'].map((name) => ({
              name,
              target: { oid: `${name}-sha` },
            })),
            pageInfo: { hasNextPage: true, endCursor: 'page-2' },
          },
        },
      })
      .mockResolvedValueOnce({
        repository: {
          refs: {
            nodes: [{ name: '34-x-y', target: { oid: '34-x-y-sha' } }],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      });

    const branches = await getSupportedBranches(octokit);

    expect(branches.map((branch) => branch.name)).toEqual(['31-x-y', '32-x-y', '33-x-y', '34-x-y']);
    expect(graphql).toHaveBeenCalledTimes(2);
    expect(graphql).toHaveBeenLastCalledWith(expect.any(String), {
      owner: 'electron',
      repo: 'electron',
      branchQuery: '-x-y',
      cursor: 'page-2',
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
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      },
    });

    const branches = await getSupportedBranches(octokit, 2);

    expect(branches.map((branch) => branch.name)).toEqual(['33-x-y', '34-x-y']);
  });
});
