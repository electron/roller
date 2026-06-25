import type { Context } from 'probot';

import { REPOS } from '../constants.js';

export async function isAuthorizedElectronRepoUser(
  context: Context<'issue_comment.created'>,
  username: string,
) {
  // Authorization for roll commands must be evaluated against electron/electron,
  // the repository the privileged roll actions modify - not against the repository
  // the webhook comment was posted in. Otherwise write access on any other repo
  // where this app is installed would be enough to trigger privileged rolls.
  const { data } = await context.octokit.rest.repos.getCollaboratorPermissionLevel({
    owner: REPOS.electron.owner,
    repo: REPOS.electron.repo,
    username,
  });

  return ['admin', 'write'].includes(data.permission);
}
