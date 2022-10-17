import * as debug from 'debug';
import { Context, Probot } from 'probot';
import { PullRequestClosedEvent } from '@octokit/webhooks-types';
import { handleChromiumCheck, handleNodeCheck } from './handlers';
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
};
