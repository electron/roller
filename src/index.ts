import github from '@octokit/rest';
import slack from '@slack/client';

import * as express from 'express';
import * as bodyParser from 'body-parser';
import * as GithubWebHook from 'express-github-webhook';

import rollChromium from './roll-chromium';

const app = express();
app.use(bodyParser.json());

const libccHookHandler = GithubWebHook({
  path: '/libcc-hook',
  secret: process.env.GITHUB_SECRET || 'secret'
});

app.use(libccHookHandler);

libccHookHandler.on('push', (repo, data) => {
  let targetElectronBranch: string;
  const { ref } = data;
  // In a string that looks like ""/HEAD/blub/blab", match
  // the last [A-Za-z] that isn't followed by a /
  const lastRefMatch = ref.match(/([A-Za-z]*)(?!.*\/)/i);
  const lastRef = Array.isArray(lastRefMatch) ? lastRefMatch[0] : null;

  if (!lastRef) return;

  if (lastRef === 'master') {
    targetElectronBranch = 'master';
  } else {
    const electronBranchMatch = /^electron-([0-9]-[0-9]-x)$/.match(lastRef);
    if (electronBranchMatch) {
      targetElectronBranch = electronBranchMatch[1];
    }
  }
  if (targetElectronBranch) {
    rollChromium(targetElectronBranch, data.head)
  }
});

app.

