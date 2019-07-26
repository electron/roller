export const REPOS = {
  electron: {
    owner: 'electron',
    name: 'electron',
  },
  node: {
    owner: 'nodejs',
    name: 'node',
  },
  libcc: {
    owner: 'electron',
    name: 'libchromiumcontent',
  },
};

export const rollTargets = {
  node: {
    name: 'node',
    key: 'node_version',
  },
  chromium: {
    name: 'chromium',
    key: 'chromium_version',
  },
};

export const PR_USER = 'electron-bot';

export interface Commit {
  sha: string;
  message: string;
}

export interface RollTarget {
  name: string;
  key: string;
}
