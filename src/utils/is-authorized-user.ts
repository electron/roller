import type { Context } from 'probot';

export async function isAuthorizedUser(
  context: Context<'issue_comment.created'>,
  username: string,
) {
  const { data } = await context.octokit.rest.repos.getCollaboratorPermissionLevel(
    context.repo({
      username,
    }),
  );

  return ['admin', 'write'].includes(data.permission);
}
