import { Octokit } from '@octokit/rest';

import { REPOS } from '../constants.js';
import { ReposListBranchesResponseItem } from '../types.js';
import { getSupportedBranches } from './get-supported-branches.js';

export const ELECTRON_RELEASE_SCHEDULE_URL = 'https://releases.electronjs.org/schedule.json';

interface ReleaseScheduleEntry {
  version: string;
  branch: string;
  chromiumVersion: number;
}

// Returns the `target/N-x-y` label for every supported release branch whose
// scheduled Chromium version is greater than or equal to the Chromium major
// being rolled to, per https://releases.electronjs.org/schedule.
export async function getTargetBranchLabels(
  octokit: Octokit,
  chromiumMajorVersion: number,
): Promise<string[]> {
  const response = await fetch(ELECTRON_RELEASE_SCHEDULE_URL, {
    headers: { accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch Electron release schedule: ${response.status}`);
  }
  const schedule = (await response.json()) as ReleaseScheduleEntry[];

  const branches: ReposListBranchesResponseItem[] = await octokit.paginate(
    octokit.repos.listBranches.endpoint.merge({
      ...REPOS.electron,
      protected: true,
    }),
  );
  const supported = getSupportedBranches(branches);

  return schedule
    .filter(
      (entry) =>
        supported.includes(entry.branch) && Number(entry.chromiumVersion) >= chromiumMajorVersion,
    )
    .map((entry) => `target/${entry.branch}`)
    .sort();
}
