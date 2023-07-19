import * as debug from 'debug';
import { Context, Probot } from 'probot';
import { IssueCommentCreatedEvent, PullRequestClosedEvent } from '@octokit/webhooks-types';
import { handleNodeCheck } from './node-handler';
import { handleChromiumCheck } from './chromium-handler';
import { REPOS, ROLL_TARGETS } from './constants';
import { getSupportedBranches } from './utils/get-supported-branches';
import { ReposListBranchesResponseItem } from './types';

const d = debug('Autorolling On Merge');

const handler = (robot: Probot) => {
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

    const branchMatch = comment.body.match(/^\/roll (main|\d+-x-y)$/);
    if (!branchMatch || !branchMatch[0]) {
      return;
    }

    if (!issue.pull_request) {
      d(`Invalid usage - only roll PRs can be triggered with the roll command`);
      return;
    }

    const branch = branchMatch[0];
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
            body: 'Checking for new Node.js commits...',
          }),
        );
        await handleNodeCheck();
      }
    } catch (error) {
      d(`Failed to check for possible roll on ${issue.number}: ${error.message}`);
    }
  });
};

module.exports = handler;
