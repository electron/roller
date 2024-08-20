import * as debug from 'debug';
import { Context, Probot } from 'probot';
import { IssueCommentCreatedEvent, PullRequestClosedEvent } from '@octokit/webhooks-types';
import { handleNodeCheck } from './node-handler';
import { handleChromiumCheck } from './chromium-handler';
import { ROLL_TARGETS } from './constants';

const handler = (robot: Probot) => {
  robot.on('pull_request.closed', async (context: Context) => {
    const d = debug('roller/github:pull_request.closed');

    const { pull_request: pr } = context.payload as PullRequestClosedEvent;

    if (!pr.merged) return;

    const isNodePR = pr.title.startsWith(`chore: bump ${ROLL_TARGETS.node.name}`);
    const isChromiumPR = pr.title.startsWith(`chore: bump ${ROLL_TARGETS.chromium.name}`);

    try {
      if (isChromiumPR) {
        d('Chromium PR merged - opening a new one');
        await handleChromiumCheck();
      } else if (isNodePR) {
        d('Node.js PR merged - opening a new one');
        await handleNodeCheck();
      }
    } catch (error) {
      const type = isChromiumPR ? 'Chromium' : 'Node.js';
      d(`Failed to autoroll new ${type} PR to ${pr.base.ref}: ${error.message}`);
    }
  });

  robot.on('issue_comment.created', async (context: Context) => {
    const d = debug('roller/github:issue_comment.created');

    const { issue, comment } = context.payload as IssueCommentCreatedEvent;

    const match = comment.body.match(/^\/roll (main|\d+-x-y)$/);
    if (!match || !match[1]) {
      return;
    }

    if (!issue.pull_request) {
      d(`Invalid usage - only roll PRs can be triggered with the roll command`);
      return;
    }

    const branch = match[1];
    const isNodePR = issue.title.startsWith(`chore: bump ${ROLL_TARGETS.node.name}`);
    const isChromiumPR = issue.title.startsWith(`chore: bump ${ROLL_TARGETS.chromium.name}`);

    try {
      if (isChromiumPR) {
        d(`Chromium roll requested on ${branch}`);
        await context.octokit.issues.createComment(
          context.repo({
            issue_number: issue.number,
            body: `Checking for new Chromium commits on \`${branch}\``,
          }),
        );
        await handleChromiumCheck(branch);
      } else if (isNodePR) {
        d('Node.js roll requested');
        await context.octokit.issues.createComment(
          context.repo({
            issue_number: issue.number,
            body: `Checking for new Node.js commits on \`${branch}\``,
          }),
        );
        await handleNodeCheck(branch);
      }
    } catch (error) {
      d(`Failed to check for possible roll on ${issue.number}: ${error.message}`);
    }
  });
};

module.exports = handler;
