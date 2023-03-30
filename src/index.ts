import * as debug from 'debug';
import { Context, Probot } from 'probot';
import { IssueCommentCreatedEvent, PullRequestClosedEvent } from '@octokit/webhooks-types';
import { handleNodeCheck } from './node-handler';
import { handleChromiumCheck } from './chromium-handler';
import { ROLL_TARGETS } from './constants';

const d = debug('Autorolling On Merge');

export default (robot: Probot) => {
  robot.on('pull_request.closed', async (context: Context) => {
    const { pull_request: pr } = context.payload as PullRequestClosedEvent;

    if (!pr.merged) return;

    const isNodePR = pr.title.startsWith(`chore: bump ${ROLL_TARGETS.node.name}`);
    const isChromiumPR = pr.title.startsWith(`chore: bump ${ROLL_TARGETS.chromium.name}`);

    // If a roller PR is merged, we should automatically make the next PR.
    if (isChromiumPR) {
      d('Chromium PR merged - opening a new one');
      handleChromiumCheck().catch(err => console.error(err));
    } else if (isNodePR) {
      d('Node.js PR merged - opening a new one');
      handleNodeCheck().catch(err => console.error(err));
    }
  });

  robot.on('issue_comment.created', async (context: Context) => {
    const { issue, comment } = context.payload as IssueCommentCreatedEvent;

    if (!comment.body.startsWith('/roll')) return;

    const isNodePR = issue.title.startsWith(`chore: bump ${ROLL_TARGETS.node.name}`);
    const isChromiumPR = issue.title.startsWith(`chore: bump ${ROLL_TARGETS.chromium.name}`);
    if (isChromiumPR) {
      d('Chromium roll requested');
      context.octokit.issues.createComment({
        ...context.repo(),
        body: 'Checking for new Chromium commits...',
      });
      handleChromiumCheck().catch(err => console.error(err));
    } else if (isNodePR) {
      d('Node.js roll requested');
      context.octokit.issues.createComment({
        ...context.repo(),
        body: 'Checking for new Node commits...',
      });
      handleNodeCheck().catch(err => console.error(err));
    }
  });
};
