export const REPOS = {
  electron: {
    owner: 'electron',
    repo: 'electron',
  },
  node: {
    owner: 'nodejs',
    repo: 'node',
  },
  nodeOrb: {
    owner: 'electron',
    repo: 'node-orb',
  },
};

export const NODE_ORB_REPOS = {
  asar: {
    owner: 'electron',
    repo: 'asar',
  },
  docsParser: {
    owner: 'electron',
    repo: 'docs-parser',
  },
  electronPackager: {
    owner: 'electron',
    repo: 'packager',
  },
  fiddle: {
    owner: 'electron',
    repo: 'fiddle',
  },
  forge: {
    owner: 'electron',
    repo: 'forge',
  },
  get: {
    owner: 'electron',
    repo: 'get',
  },
  nodeMinidump: {
    owner: 'electron',
    repo: 'node-minidump',
  },
  nodeRcedit: {
    owner: 'electron',
    repo: 'node-rcedit',
  },
  notarize: {
    owner: 'electron',
    repo: 'notarize',
  },
  osxSign: {
    owner: 'electron',
    repo: 'osx-sign',
  },
  rebuild: {
    owner: 'electron',
    repo: 'rebuild',
  },
  releases: {
    owner: 'electron',
    repo: 'remote',
  },
  symbolicateMac: {
    owner: 'electron',
    repo: 'symbolicate-mac',
  },
  typescriptDefinitions: {
    owner: 'electron',
    repo: 'typescript-definitions',
  },
  updateElectronApp: {
    owner: 'electron',
    repo: 'update-electron-app',
  },
  updateElectronJsOrg: {
    owner: 'electron',
    repo: 'update.electronjs.org',
  },
  windowsInstaller: {
    owner: 'electron',
    repo: `windows-installer`,
  },

  [Symbol.iterator]: function*() {
    const repos = Object.values(this);
    for (const repo of repos) {
      yield repo as repository;
    }
  },
};

export const MAIN_BRANCH = 'main';

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

export const YAML_ROLL_TARGETS = {
  nodeOrb: {
    name: 'node-orb',
    keys: ['orb', 'node'],
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

export interface YamlRollTarget {
  name: string;
  keys: string[];
}

export interface repository {
  owner: string;
  repo: string;
}
