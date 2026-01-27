import * as semver from 'semver';

export const NODE_SCHEDULE_URL =
  'https://raw.githubusercontent.com/nodejs/Release/main/schedule.json';

interface NodeMajorLine {
  start: string;
  lts?: string;
  maintenance?: string;
  end: string;
  codeName?: string;
}

// Returns the latest major version of Node.js that's in active LTS.
export async function getLatestLTSVersion(): Promise<string | null> {
  let data: Record<string, NodeMajorLine>;
  try {
    const response = await fetch(NODE_SCHEDULE_URL, {
      headers: { accept: 'application/json' },
    });
    data = (await response.json()) as Record<string, NodeMajorLine>;
  } catch (error) {
    console.error('Failed to fetch Node.js release schedule:', error);
    return null;
  }

  const latestLTSVersion = Object.entries(data)
    .filter(([, { lts }]) => lts && new Date(lts) < new Date())
    .reduce(
      (latest, [version, { lts }]) => {
        if (!latest.lts || new Date(lts) > new Date(latest.lts)) {
          return { version, lts };
        }
        return latest;
      },
      { version: null, lts: null },
    );

  return semver.valid(semver.coerce(latestLTSVersion.version));
}
