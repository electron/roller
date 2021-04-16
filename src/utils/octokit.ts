import { Octokit } from '@octokit/rest';

let octokit: Octokit;

/**
 * Returns an authenticated Octokit.
 *
 * @returns {Promise<Octokit>}
 */
export function getOctokit(): Octokit {
  octokit =
    octokit ||
    new Octokit({
      auth: process.env.GITHUB_TOKEN,
    });

  return octokit;
}
