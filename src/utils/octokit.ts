import * as GitHub from '@octokit/rest';

let octokit: GitHub;

/**
 * Returns an authenticated Octokit.
 *
 * @returns {Promise<GitHub>}
 */
export function getOctokit(): GitHub {
  octokit =
    octokit ||
    new GitHub({
      auth: process.env.GITHUB_TOKEN,
    });

  return octokit;
}
