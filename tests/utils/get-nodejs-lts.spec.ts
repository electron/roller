import fs from 'node:fs';
import path from 'node:path';

import nock from 'nock';
import { describe, expect, it } from 'vitest';

import { getLatestLTSVersion, NODE_SCHEDULE_URL } from '../../src/utils/get-nodejs-lts';

describe('getLatestLTSVersion', () => {
  it('returns the latest Node.js LTS version', async () => {
    const fixture = fs.readFileSync(
      path.join(__dirname, '../fixtures/node-release-schedule.json'),
      'utf8',
    );
    const url = new URL(NODE_SCHEDULE_URL);
    nock(url.origin).get(url.pathname).reply(200, fixture);

    await expect(getLatestLTSVersion()).resolves.toEqual('22.0.0');
  });
});
