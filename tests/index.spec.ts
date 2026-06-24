import nock from 'nock';
import { Context, Probot, ProbotOctokit } from 'probot';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import handler from '../src/index.js';
import { handleChromiumCheck } from '../src/chromium-handler.js';
import { ROLLER_BOT_LOGIN } from '../src/constants.js';
import { handleNodeCheck } from '../src/node-handler.js';
import { isAuthorizedElectronRepoUser } from '../src/utils/is-authorized-user.js';
import { updatePRBranch } from '../src/utils/update-pr-branch.js';

import issueCommentRollCreatedEvent from './fixtures/issue_comment_roll.created.json' with { type: 'json' };
import issueCommentUpdateBranchCreatedEvent from './fixtures/issue_comment_update_branch.created.json' with { type: 'json' };

vi.mock('../src/chromium-handler.js');
vi.mock('../src/node-handler.js');
vi.mock('../src/utils/is-authorized-user.js');
vi.mock('../src/utils/update-pr-branch.js');

const GH_API = 'https://api.github.com';

const MOCK_PR = {
  merged: true,
  head: {
    sha: '6dcb09b5b57875f334f61aebed695e2e4193db5e',
  },
  base: {
    ref: 'main',
    repo: {
      default_branch: 'main',
    },
  },
  labels: [
    {
      url: 'my_cool_url',
      name: 'target/X-X-X',
      color: 'fc2929',
    },
  ],
  user: {
    login: ROLLER_BOT_LOGIN,
  },
};

describe('roller', () => {
  describe('issue_comment.created event', () => {
    let probot: Probot;

    beforeEach(() => {
      vi.clearAllMocks();
      nock.disableNetConnect();

      probot = new Probot({
        githubToken: 'test',
        Octokit: ProbotOctokit.defaults((instanceOptions: any) => {
          return {
            ...instanceOptions,
            retry: { enabled: false },
            throttle: { enabled: false },
          };
        }),
      });

      probot.load(handler);
    });

    afterEach(() => {
      expect(nock.isDone(), 'Not all Nock interceptors used');
      nock.cleanAll();
      nock.enableNetConnect();
    });

    it('rolls Chromium when an authorized user comments /roll main', async () => {
      vi.mocked(isAuthorizedElectronRepoUser).mockResolvedValue(true);

      nock(GH_API)
        .post('/repos/electron/electron/issues/0/comments', ({ body }) => {
          expect(body).toEqual('Checking for new Chromium commits on `main`');
          return true;
        })
        .reply(200);

      await probot.receive(issueCommentRollCreatedEvent as Parameters<typeof probot.receive>[0]);

      expect(handleChromiumCheck).toHaveBeenCalledWith('main');
    });

    it('rolls Node.js when an authorized user comments /roll main', async () => {
      vi.mocked(isAuthorizedElectronRepoUser).mockResolvedValue(true);

      nock(GH_API)
        .post('/repos/electron/electron/issues/0/comments', ({ body }) => {
          expect(body).toEqual('Checking for new Node.js commits on `main`');
          return true;
        })
        .reply(200);

      const event = JSON.parse(JSON.stringify(issueCommentRollCreatedEvent));
      event.payload.issue.title = 'chore: bump node to 1.2.3.4';
      await probot.receive(event as Parameters<typeof probot.receive>[0]);

      expect(handleNodeCheck).toHaveBeenCalledWith('main');
    });

    it('ignores roll commands from repositories other than electron/electron', async () => {
      vi.mocked(isAuthorizedElectronRepoUser).mockResolvedValue(true);

      const event = JSON.parse(JSON.stringify(issueCommentRollCreatedEvent));
      event.payload.repository.name = 'other-repo';
      event.payload.repository.full_name = 'electron/other-repo';
      await probot.receive(event as Parameters<typeof probot.receive>[0]);

      expect(isAuthorizedElectronRepoUser).not.toHaveBeenCalled();
      expect(handleChromiumCheck).not.toHaveBeenCalled();
      expect(handleNodeCheck).not.toHaveBeenCalled();
    });

    it('blocks unauthorized users from triggering a roll', async () => {
      vi.mocked(isAuthorizedElectronRepoUser).mockResolvedValue(false);

      nock(GH_API)
        .post('/repos/electron/electron/issues/0/comments', ({ body }) => {
          expect(body).toEqual('@dsanders11 is not authorized to run roller commands.');
          return true;
        })
        .reply(200);

      await probot.receive(issueCommentRollCreatedEvent as Parameters<typeof probot.receive>[0]);

      expect(handleChromiumCheck).not.toHaveBeenCalled();
      expect(handleNodeCheck).not.toHaveBeenCalled();
    });

    it('triggers a branch update on `/roller update-branch` comment', async () => {
      vi.mocked(isAuthorizedElectronRepoUser).mockResolvedValue(true);

      nock(GH_API).persist().get('/repos/electron/electron/pulls/0').reply(200, MOCK_PR);

      await probot.receive(
        issueCommentUpdateBranchCreatedEvent as Parameters<typeof probot.receive>[0],
      );

      expect(updatePRBranch).toHaveBeenCalled();
    });

    it('does not trigger a branch update on `/roller update-branch` comment when roller is not the author', async () => {
      vi.mocked(isAuthorizedElectronRepoUser).mockResolvedValue(true);

      nock(GH_API)
        .persist()
        .get('/repos/electron/electron/pulls/0')
        .reply(200, { ...MOCK_PR, user: { login: 'someone-else' } });

      let comment: string | undefined;
      nock(GH_API)
        .post('/repos/electron/electron/issues/0/comments', ({ body }) => {
          comment = body;
          return true;
        })
        .reply(200);

      await probot.receive(
        issueCommentUpdateBranchCreatedEvent as Parameters<typeof probot.receive>[0],
      );

      expect(updatePRBranch).not.toHaveBeenCalled();
      expect(comment).toEqual(
        'This PR was not created by roller and cannot be updated via this command.',
      );
    });
  });
});
