import { Octokit as GitHub } from '@octokit/rest';
import { createAppAuth } from '@octokit/auth-app';

let octokit: GitHub;

/**
 * Returns an authenticated Octokit.
 *
 * @returns {Promise<GitHub>}
 */
export async function getOctokit(): Promise<GitHub> {
  octokit =
    octokit ||
    new GitHub({
      authStrategy: createAppAuth,
      auth: {
        appId: process.env.APP_ID,
        privateKey: process.env.PRIVATE_KEY,
        installationId: process.env.INSTALLATION_ID,
        clientId: process.env.CLIENT_ID,
        clientSecret: process.env.CLIENT_SECRET,
      },
    });

  return octokit;
}
