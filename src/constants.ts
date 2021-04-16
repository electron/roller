export const REPOS = {
  electron: {
    owner: 'electron',
    repo: 'electron',
  },
  node: {
    owner: 'nodejs',
    repo: 'node',
  },
};

export const NUM_SUPPORTED_VERSIONS = 4;

// This is 3.9 days to handle the couple of minutes of lag/drift that can occur around the cron job.
export const FOURISH_DAYS_AGO = 3.9 * 24 * 60 * 60 * 1000;

export const PAUSE_LABEL = 'roller/pause';

export const ROLL_TARGETS = {
  node: {
    name: 'node',
    depsKey: 'node_version',
  } as RollTarget,
  chromium: {
    name: 'chromium',
    depsKey: 'chromium_version',
  } as RollTarget,
};

export const PR_USER = 'electron-bot';

export interface Commit {
  sha: string;
  message: string;
}

export interface RollTarget {
  name: string;
  depsKey: string;
}
