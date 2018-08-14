import * as GitHub from '@octokit/rest';

let octokit: GitHub;

/**
 * Returns an authenticated Octokit.
 *
 * @returns {Promise<GitHub>}
 */
export async function getOctokit(): Promise<GitHub> {
  octokit = octokit || new GitHub();

  octokit.authenticate({
    type: 'token',
    token: process.env.GITHUB_TOKEN
  });

  return octokit;
}
