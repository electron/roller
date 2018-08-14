
import * as express from 'express';
import * as bodyParser from 'body-parser';
import * as GithubWebHook from 'express-github-webhook';

import { handleLibccPush } from './handlers';

const app = express();
app.use(bodyParser.json());

const libccHookHandler = GithubWebHook({
  path: '/libcc-hook',
  secret: process.env.GITHUB_SECRET || 'secret'
});

app.use(libccHookHandler);

libccHookHandler.on('push', handleLibccPush);

const port = process.env.PORT || 8080;

app.listen(port, () => {
  console.info(`Listening on port: ${port}`);
});
