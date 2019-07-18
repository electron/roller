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

export const PR_USER = 'electron-bot';

export interface Commit {
  sha: string;
  message: string;
}

export interface Repo {
  OWNER: string;
  NAME: string;
}
