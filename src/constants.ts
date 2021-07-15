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

export const ROLL_TARGETS = {
  node: {
    name: 'node',
    depsKey: 'node_version',
  },
  chromium: {
    name: 'chromium',
    depsKey: 'chromium_version',
  },
};

export const BACKPORT_CHECK_SKIP = 'backport-check-skip';
export const NO_BACKPORT = 'no-backport';

export interface Commit {
  sha: string;
  message: string;
}

export interface RollTarget {
  name: string;
  depsKey: string;
}
