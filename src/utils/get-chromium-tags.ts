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
  const releases = (await response.json()) as Release[];
  return releases.sort((a, b) => a.time - b.time).map((r) => r.version);
}
