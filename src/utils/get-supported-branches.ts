import type { Octokit } from '@octokit/rest';
import type { Branch } from '../types.js';

/**
 * Get array of currently supported branches
 */
export async function getSupportedBranches(
  github: Octokit,
  numSupportedVersions = 4,
): Promise<Branch[]> {
  if (numSupportedVersions < 1) {
    throw new Error('numSupportedVersions must be greater than 0');
  }

  if (numSupportedVersions > 100) {
    throw new Error('numSupportedVersions must be less than or equal to 100');
  }

  const branchRefs: { name: string; target: { oid: string } }[] = [];
  let cursor: string | null = null;

  while (true) {
    const { repository } = await github.graphql<{
      repository: {
        refs: {
          nodes: { name: string; target: { oid: string } }[];
          pageInfo: { hasNextPage: boolean; endCursor: string | null };
        };
      };
    }>(
      `query ($owner: String!, $repo: String!, $branchQuery: String!, $cursor: String) {
        repository(owner: $owner, name: $repo) {
          refs(refPrefix: "refs/heads/", query: $branchQuery, first: 100, after: $cursor) {
            nodes {
              name
              target {
                ... on Commit {
                  oid
                }
              }
            }
            pageInfo {
              hasNextPage
              endCursor
            }
          }
        }
      }`,
      { owner: 'electron', repo: 'electron', branchQuery: '-x-y', cursor },
    );

    branchRefs.push(...repository.refs.nodes);

    if (!repository.refs.pageInfo.hasNextPage) break;

    cursor = repository.refs.pageInfo.endCursor;
    if (cursor === null) {
      throw new Error('GitHub returned no cursor for the next page of branches');
    }
  }

  const releaseBranches = branchRefs
    .filter((branch) => {
      const releasePattern = /^(\d)+-(?:(?:[0-9]+-x$)|(?:x+-y$))$/;
      return releasePattern.test(branch.name);
    })
    .map((branch) => ({
      name: branch.name,
      commit: { sha: branch.target.oid },
    }));

  const filtered: Record<string, Branch> = {};
  releaseBranches
    .sort((a, b) => {
      const aParts = a.name.split('-');
      const bParts = b.name.split('-');
      for (let i = 0; i < aParts.length; i += 1) {
        if (aParts[i] === bParts[i]) continue;
        return parseInt(aParts[i], 10) - parseInt(bParts[i], 10);
      }
      return 0;
    })
    .forEach((branch) => {
      return (filtered[branch.name.split('-')[0]] = branch);
    });

  const values = Object.values(filtered);
  return values
    .sort((a, b) => parseInt(a.name.split('-')[0], 10) - parseInt(b.name.split('-')[0], 10))
    .slice(-numSupportedVersions);
}
