import nock from 'nock';
import { afterEach, describe, expect, it } from 'vitest';

import { getChromiumReleases, Release } from '../../src/utils/get-chromium-tags.js';

describe('getChromiumReleases', () => {
  afterEach(() => {
    nock.cleanAll();
  });

  function mockReleases(releases: Partial<Release>[]) {
    return nock('https://chromiumdash.appspot.com')
      .get('/fetch_releases')
      .query(true)
      .reply(200, releases);
  }

  it('orders releases by version rather than by release time', async () => {
    // An Extended release can go out after a Stable or Beta release in the
    // same milestone while still carrying an older version.
    mockReleases([
      {
        channel: 'Extended',
        platform: 'Windows',
        milestone: 156,
        time: 4000,
        version: '156.0.8078.13',
      },
      {
        channel: 'Stable',
        platform: 'Windows',
        milestone: 156,
        time: 3000,
        version: '156.0.8078.12',
      },
      {
        channel: 'Beta',
        platform: 'Windows',
        milestone: 156,
        time: 2000,
        version: '156.0.8078.17',
      },
      { channel: 'Beta', platform: 'Mac', milestone: 156, time: 1000, version: '156.0.8078.4' },
    ]);

    const releases = await getChromiumReleases({ milestone: 156 });

    expect(releases).toEqual(['156.0.8078.4', '156.0.8078.12', '156.0.8078.13', '156.0.8078.17']);
    expect(releases[releases.length - 1]).toEqual('156.0.8078.17');
  });

  it('compares version components numerically', async () => {
    mockReleases([
      { channel: 'Stable', platform: 'Linux', milestone: 156, time: 2000, version: '156.0.8078.9' },
      {
        channel: 'Stable',
        platform: 'Linux',
        milestone: 156,
        time: 1000,
        version: '156.0.8078.10',
      },
    ]);

    await expect(getChromiumReleases({ milestone: 156 })).resolves.toEqual([
      '156.0.8078.9',
      '156.0.8078.10',
    ]);
  });

  it('passes the channel and milestone filters to chromiumdash', async () => {
    const scope = nock('https://chromiumdash.appspot.com')
      .get('/fetch_releases')
      .query({
        platform: 'Win32,Windows,Linux,Mac',
        num: '10',
        channel: 'Canary',
        milestone: '157',
      })
      .reply(200, []);

    await expect(getChromiumReleases({ channel: 'Canary', milestone: 157 })).resolves.toEqual([]);
    expect(scope.isDone()).toBe(true);
  });

  it('throws when chromiumdash responds with an error', async () => {
    nock('https://chromiumdash.appspot.com').get('/fetch_releases').query(true).reply(500);

    await expect(getChromiumReleases({ milestone: 156 })).rejects.toThrow(
      'Failed to fetch Chromium releases: 500',
    );
  });
});
