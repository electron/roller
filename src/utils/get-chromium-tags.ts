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

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`Failed to fetch Chromium releases: ${response.status}`);
  }
  const releases: Release[] = await response.json();
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

export async function getChromiumCommits(
  fromRef: string,
  toRef: string,
): Promise<{ log: ChromiumCommit[]; next?: string }> {
  const url = `https://chromium.googlesource.com/chromium/src/+log/${fromRef}..${toRef}?format=JSON`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch Chromium commits: ${response.status}`);
  }
  const text = await response.text();
  // Gitiles prefixes JSON responses with )]}' for security, so strip it
  return JSON.parse(text.slice(text.indexOf('{')));
}
