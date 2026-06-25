import debug from 'debug';
import type { Probot } from 'probot';
import { handleNodeCheck } from './node-handler.js';
import { handleChromiumCheck } from './chromium-handler.js';
import { handleBuildImagesCheck } from './build-images-handler.js';
import { handleBuildImagesChromiumDepsCheck } from './build-images-chromium-deps-handler.js';
import { REPOS, ROLL_TARGETS } from './constants.js';
import { isAuthorizedElectronRepoUser } from './utils/is-authorized-user.js';

const handler = (robot: Probot) => {
  robot.on('pull_request.closed', async (context) => {
    const d = debug('roller/github:pull_request.closed');

    const { pull_request: pr, repository } = context.payload;

    if (!pr.merged) return;

    // Merging a `chore: bump ...` PR triggers privileged rolls against electron/electron,
    // so only react to merges in that repository. Otherwise a merged PR with a crafted
    // title in any other repo where this app is installed could trigger a roll.
    if (repository.full_name !== `${REPOS.electron.owner}/${REPOS.electron.repo}`) return;

    const isNodePR = pr.title.startsWith(`chore: bump ${ROLL_TARGETS.node.name}`);
    const isChromiumPR = pr.title.startsWith(`chore: bump ${ROLL_TARGETS.chromium.name}`);

    try {
      if (isChromiumPR) {
        d('Chromium PR merged - opening a new one');
        await handleChromiumCheck();
        // Also check if build-images chromium deps need updating
        d('Checking if build-images chromium deps need updating');
        await handleBuildImagesChromiumDepsCheck();
      } else if (isNodePR) {
        d('Node.js PR merged - opening a new one');
        await handleNodeCheck();
      }
    } catch (error) {
      const type = isChromiumPR ? 'Chromium' : 'Node.js';
      d(`Failed to autoroll new ${type} PR to ${pr.base.ref}: ${error.message}`);
    }
  });

  robot.on('registry_package.published', async (context) => {
    const d = debug('roller/github:package.published');

    const { repository, registry_package } = context.payload;

    const payload = context.payload;
    if (repository.full_name !== 'electron/build-images') return;

    // There are three packages in the build-images repo (build, devcontainer, test)
    // that will all have the same target_oid. We only need to update the shas once.
    if (registry_package.name !== 'build') return;

    try {
      await handleBuildImagesCheck(payload);
    } catch (error) {
      d(`Failed to autoroll new build-images version: ${error.message}`);
    }
  });

  robot.on('issue_comment.created', async (context) => {
    const d = debug('roller/github:issue_comment.created');
    const { issue, comment } = context.payload;

    const match = comment.body.match(/^\/roll (main|\d+-x-y)$/);
    if (!match || !match[1]) {
      return;
    }

    // Roll commands perform privileged actions against electron/electron, so only
    // honor them when issued from that repository. This prevents permissions on
    // unrelated repos where this app is installed from authorizing a roll.
    const { repository } = context.payload;
    if (repository.full_name !== `${REPOS.electron.owner}/${REPOS.electron.repo}`) {
      d(`Ignoring roll command from ${repository.full_name} - only electron/electron is allowed`);
      return;
    }

    if (!issue.pull_request) {
      d(`Invalid usage - only roll PRs can be triggered with the roll command`);
      return;
    }

    // Allow all users with push access to run commands
    if (!(await isAuthorizedElectronRepoUser(context, comment.user.login))) {
      d(`@${comment.user.login} is not authorized to run roller commands - stopping`);
      await context.octokit.rest.issues.createComment(
        context.repo({
          issue_number: issue.number,
          body: `@${comment.user.login} is not authorized to run roller commands.`,
        }),
      );
      return;
    }

    const branch = match[1];
    const isNodePR = issue.title.startsWith(`chore: bump ${ROLL_TARGETS.node.name}`);
    const isChromiumPR = issue.title.startsWith(`chore: bump ${ROLL_TARGETS.chromium.name}`);

    try {
      if (isChromiumPR) {
        d(`Chromium roll requested on ${branch}`);
        await context.octokit.rest.issues.createComment(
          context.repo({
            issue_number: issue.number,
            body: `Checking for new Chromium commits on \`${branch}\``,
          }),
        );
        await handleChromiumCheck(branch);
      } else if (isNodePR) {
        d('Node.js roll requested');
        await context.octokit.rest.issues.createComment(
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

export default handler;
