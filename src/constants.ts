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
  fiddle: {
    owner: 'electron',
    repo: 'fiddle',
  },
  forge: {
    owner: 'electron',
    repo: 'forge',
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
    key: ['orb', 'node'],
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
  key: string[];
}

export interface repository {
  owner: string;
  repo: string;
}
