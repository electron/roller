import fs from 'node:fs';
import path from 'node:path';

import nock from 'nock';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ELECTRON_RELEASE_SCHEDULE_URL,
  getBranchesTrackedByMain,
  getTargetBranchLabels,
} from '../../src/utils/get-target-branch-labels.js';

describe('getTargetBranchLabels', () => {
  let mockOctokit: any;

  const fixture = fs.readFileSync(
    path.join(import.meta.dirname, '../fixtures/electron-release-schedule.json'),
    'utf8',
  );
  const url = new URL(ELECTRON_RELEASE_SCHEDULE_URL);

  beforeEach(() => {
    nock.cleanAll();
    mockOctokit = {
      paginate: vi.fn().mockResolvedValue(
        // 41-x-y is EOL and outside the supported window of 4.
        ['41-x-y', '42-x-y', '43-x-y', '44-x-y', '45-x-y'].map((name) => ({ name })),
      ),
      repos: {
        listBranches: {
          endpoint: {
            merge: vi.fn(),
          },
        },
      },
    };
  });

  it('returns labels for supported branches scheduled for >= the rolled major', async () => {
    nock(url.origin).get(url.pathname).reply(200, fixture);

    // 45-x-y ships Chromium 156, 44-x-y ships 152 - rolling to 154 only
    // targets 45-x-y.
    await expect(getTargetBranchLabels(mockOctokit, 154)).resolves.toEqual(['target/45-x-y']);
  });

  it('includes a branch whose scheduled major equals the rolled major', async () => {
    nock(url.origin).get(url.pathname).reply(200, fixture);

    await expect(getTargetBranchLabels(mockOctokit, 156)).resolves.toEqual(['target/45-x-y']);
  });

  it('returns labels for every matching supported branch', async () => {
    nock(url.origin).get(url.pathname).reply(200, fixture);

    await expect(getTargetBranchLabels(mockOctokit, 150)).resolves.toEqual([
      'target/43-x-y',
      'target/44-x-y',
      'target/45-x-y',
    ]);
  });

  it('returns no labels if the rolled major is newer than every scheduled version', async () => {
    nock(url.origin).get(url.pathname).reply(200, fixture);

    await expect(getTargetBranchLabels(mockOctokit, 157)).resolves.toEqual([]);
  });

  it('ignores schedule entries for unsupported branches', async () => {
    nock(url.origin).get(url.pathname).reply(200, fixture);

    // 41-x-y ships Chromium 146 but is no longer supported, and main is not a
    // release branch - neither should produce a label.
    await expect(getTargetBranchLabels(mockOctokit, 140)).resolves.toEqual([
      'target/42-x-y',
      'target/43-x-y',
      'target/44-x-y',
      'target/45-x-y',
    ]);
  });

  it('returns tracked branch names via getBranchesTrackedByMain', async () => {
    nock(url.origin).get(url.pathname).reply(200, fixture);

    await expect(getBranchesTrackedByMain(mockOctokit, 154)).resolves.toEqual(['45-x-y']);
  });

  it('throws if the schedule fetch fails', async () => {
    nock(url.origin).get(url.pathname).reply(500);

    await expect(getTargetBranchLabels(mockOctokit, 154)).rejects.toThrowError(
      'Failed to fetch Electron release schedule: 500',
    );
  });
});
