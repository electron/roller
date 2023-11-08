import { Octokit as GitHub } from '@octokit/rest';
import {
  AppAuthentication,
  createAppAuth,
  InstallationAccessTokenAuthentication,
} from '@octokit/auth-app';

let octokit: GitHub;
let appOctokit: GitHub;

const getAuthProvider = () =>
  createAppAuth({
    appId: process.env.APP_ID,
    privateKey: process.env.PRIVATE_KEY,
    installationId: process.env.INSTALLATION_ID,
    clientId: process.env.CLIENT_ID,
    clientSecret: process.env.CLIENT_SECRET,
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
      auth: ((await getAuthProvider()({
        type: 'installation',
      })) as InstallationAccessTokenAuthentication).token,
    });

  return octokit;
}
