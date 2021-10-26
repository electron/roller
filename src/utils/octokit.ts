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
    appId: process.env.ROLLER_APP_ID,
    privateKey: process.env.ROLLER_PRIVATE_KEY,
    installationId: process.env.ROLLER_INSTALLATION_ID,
    clientId: process.env.ROLLER_CLIENT_ID,
    clientSecret: process.env.ROLLER_CLIENT_SECRET,
  });

export async function getAppOctokit(): Promise<GitHub> {
  appOctokit =
    appOctokit ||
    new GitHub({
      auth: ((await getAuthProvider()({ type: 'app' })) as AppAuthentication).token,
    });
  return appOctokit;
}

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
