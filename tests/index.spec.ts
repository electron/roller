import nock from 'nock';
import { Context, Probot, ProbotOctokit } from 'probot';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import handler from '../src/index.js';
import { handleChromiumCheck } from '../src/chromium-handler.js';
import { handleNodeCheck } from '../src/node-handler.js';
import { isAuthorizedUser } from '../src/utils/is-authorized-user.js';

import issueCommentRollCreatedEvent from './fixtures/issue_comment_roll.created.json' with { type: 'json' };

vi.mock('../src/chromium-handler.js');
vi.mock('../src/node-handler.js');
vi.mock('../src/utils/is-authorized-user.js');

const GH_API = 'https://api.github.com';

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
      vi.mocked(isAuthorizedUser).mockResolvedValue(true);

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
      vi.mocked(isAuthorizedUser).mockResolvedValue(true);

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
      vi.mocked(isAuthorizedUser).mockResolvedValue(true);

      const event = JSON.parse(JSON.stringify(issueCommentRollCreatedEvent));
      event.payload.repository.name = 'other-repo';
      event.payload.repository.full_name = 'electron/other-repo';
      await probot.receive(event as Parameters<typeof probot.receive>[0]);

      expect(isAuthorizedUser).not.toHaveBeenCalled();
      expect(handleChromiumCheck).not.toHaveBeenCalled();
      expect(handleNodeCheck).not.toHaveBeenCalled();
    });

    it('blocks unauthorized users from triggering a roll', async () => {
      vi.mocked(isAuthorizedUser).mockResolvedValue(false);

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
  });
});
