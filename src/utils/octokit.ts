import * as GitHub from '@octokit/rest';
import { createAppAuth, InstallationAccessTokenAuthentication } from '@octokit/auth-app';

let octokit: GitHub;

const auth = createAppAuth({
  appId: process.env.ROLLER_APP_ID,
  privateKey: process.env.ROLLER_PRIVATE_KEY,
  installationId: process.env.ROLLER_INSTALLATION_ID,
  clientId: process.env.ROLLER_CLIENT_ID,
  clientSecret: process.env.ROLLER_CLIENT_SECRET
});

/**
 * Returns an authenticated Octokit.
 *
 * @returns {Promise<GitHub>}
 */
export async function getOctokit(): Promise<GitHub> {
  octokit =
    octokit ||
    new GitHub({
      auth: (await auth({ type: 'installation' }) as InstallationAccessTokenAuthentication).token,
    });

  return octokit;
}
