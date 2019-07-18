export const REPOS = {
  ELECTRON: {
    OWNER: 'electron',
    NAME: 'electron',
  },
  NODE: {
    OWNER: 'nodejs',
    NAME: 'node',
  },
  LIBCC: {
    OWNER: 'electron',
    NAME: 'libchromiumcontent',
  },
};

export const ROLL_TARGETS = {
  NODE: {
    name: 'node',
    key: 'node_version',
  },
  CHROMIUM: {
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
