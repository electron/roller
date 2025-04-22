import * as https from 'https';

function get(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        let s = '';
        res.on('data', (d) => {
          s += d.toString('utf8');
        });
        res.on('end', () => {
          resolve(s);
        });
      })
      .on('error', (e) => {
        reject(e);
      });
  });
}

function getJSON(url: string): Promise<any> {
  return get(url).then((s) => JSON.parse(s.slice(s.indexOf('{'))));
}

type ReleaseType = 'Extended' | 'Stable' | 'Beta' | 'Dev' | 'Canary';

export type ReleaseParams = {
  channel?: ReleaseType;
  milestone?: number;
};

export type Release = {
  platform: 'Linux' | 'Mac' | 'Win32' | 'Windows';
  channel: ReleaseType;
  milestone: number;
  time: number;
  version: string;
};

export async function getChromiumReleases({
  channel,
  milestone,
}: ReleaseParams): Promise<string[]> {
  const url = new URL('https://chromiumdash.appspot.com/fetch_releases');

  url.searchParams.set('platform', 'Win32,Windows,Linux,Mac');
  url.searchParams.set('num', '10');

  if (channel) url.searchParams.set('channel', channel);
  if (milestone) url.searchParams.set('milestone', milestone.toString());

  const releases = await get(url.toString()).then((s) => JSON.parse(s));
  return releases.sort((a, b) => a.time - b.time).map((r) => r.version);
}

export interface ChromiumCommit {
  commit: string;
  tree: string;
  parents: string[];
  author: {
    name: string;
    email: string;
    time: string;
  };
  committer: {
    name: string;
    email: string;
    time: string;
  };
  message: string;
}

export function getChromiumCommits(
  fromRef: string,
  toRef: string,
): Promise<{ log: ChromiumCommit[]; next?: string }> {
  return getJSON(
    `https://chromium.googlesource.com/chromium/src/+log/${fromRef}..${toRef}?format=JSON`,
  );
}
