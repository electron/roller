import fs from 'node:fs';
import path from 'node:path';

import nock from 'nock';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ELECTRON_RELEASE_SCHEDULE_URL,
  getBranchesTrackedByMain,
} from '../../src/utils/get-target-branch-labels.js';
import { getSupportedBranches } from '../../src/utils/get-supported-branches.js';

vi.mock('../../src/utils/get-supported-branches.js');

describe('getBranchesTrackedByMain', () => {
  const fixture = fs.readFileSync(
    path.join(import.meta.dirname, '../fixtures/electron-release-schedule.json'),
    'utf8',
  );
  const url = new URL(ELECTRON_RELEASE_SCHEDULE_URL);

  beforeEach(() => {
    nock.cleanAll();
    vi.mocked(getSupportedBranches)
      .mockReset()
      .mockResolvedValue(
        // 41-x-y is EOL and outside the supported window of 4.
        ['42-x-y', '43-x-y', '44-x-y', '45-x-y'].map((name) => ({
          name,
          commit: { sha: `${name}-sha` },
        })),
      );
  });

  it('returns supported branches scheduled for >= the rolled major', async () => {
    nock(url.origin).get(url.pathname).reply(200, fixture);

    // 45-x-y ships Chromium 156, 44-x-y ships 152 - rolling to 154 only
    // targets 45-x-y.
    await expect(getBranchesTrackedByMain({} as any, 154)).resolves.toEqual(['45-x-y']);
  });

  it('includes a branch whose scheduled major equals the rolled major', async () => {
    nock(url.origin).get(url.pathname).reply(200, fixture);

    await expect(getBranchesTrackedByMain({} as any, 156)).resolves.toEqual(['45-x-y']);
  });

  it('returns every matching supported branch', async () => {
    nock(url.origin).get(url.pathname).reply(200, fixture);

    await expect(getBranchesTrackedByMain({} as any, 150)).resolves.toEqual([
      '43-x-y',
      '44-x-y',
      '45-x-y',
    ]);
  });

  it('returns no branches if the rolled major is newer than every scheduled version', async () => {
    nock(url.origin).get(url.pathname).reply(200, fixture);

    await expect(getBranchesTrackedByMain({} as any, 157)).resolves.toEqual([]);
  });

  it('ignores schedule entries for unsupported branches', async () => {
    nock(url.origin).get(url.pathname).reply(200, fixture);

    // 41-x-y ships Chromium 146 but is no longer supported, and main is not a
    // release branch - neither should be returned.
    await expect(getBranchesTrackedByMain({} as any, 140)).resolves.toEqual([
      '42-x-y',
      '43-x-y',
      '44-x-y',
      '45-x-y',
    ]);
  });

  it('throws if the schedule fetch fails', async () => {
    nock(url.origin).get(url.pathname).reply(500);

    await expect(getBranchesTrackedByMain({} as any, 154)).rejects.toThrowError(
      'Failed to fetch Electron release schedule: 500',
    );
  });
});
