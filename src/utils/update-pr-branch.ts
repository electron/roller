import debug from 'debug';
import type { Context } from 'probot';

import type { PullsGetResponseItem } from '../types.js';

/**
 * Updates a pull request's branch by merging the latest changes from its base
 * branch into it. This is the same operation as the "Update branch" button in
 * the GitHub UI and is used to re-trigger CI on stale roller PRs.
 */
export async function updatePRBranch(
  context: Context<'issue_comment.created'>,
  pr: PullsGetResponseItem,
): Promise<void> {
  const d = debug('roller/github:updatePRBranch()');

  d(`Updating #${pr.number} by merging the latest changes from "${pr.base.ref}"`);

  // Don't use the REBASE update method, as it would create unverified commits.
  const mutation = `mutation UpdatePullRequestBranch($pullRequestId: ID!, $expectedHeadOid: GitObjectID!) {
    updatePullRequestBranch(input: {
      pullRequestId: $pullRequestId,
      expectedHeadOid: $expectedHeadOid,
      updateMethod: MERGE
    }) {
      pullRequest {
        number
      }
    }
  }`;

  try {
    await context.octokit.graphql(mutation, {
      pullRequestId: pr.node_id,
      expectedHeadOid: pr.head.sha,
    });
  } catch (error) {
    d(`Failed to update branch for #${pr.number}`, error);

    const isConflict = (error as Error)?.message?.includes('merge conflict between base and head');

    await context.octokit.rest.issues.createComment(
      context.repo({
        issue_number: pr.number,
        body: isConflict
          ? `This branch could not be updated because there is a merge conflict with \`${pr.base.ref}\`. Please resolve the conflict manually.`
          : `I was unable to update this branch with the latest changes from \`${pr.base.ref}\`. Please update it manually.`,
      }),
    );

    return;
  }

  await context.octokit.rest.issues.createComment(
    context.repo({
      issue_number: pr.number,
      body: `This branch has been updated with the latest changes from \`${pr.base.ref}\`.`,
    }),
  );
}
