export const REPOS = {
  electron: {
    owner: 'electron',
    repo: 'electron',
  },
  electronInfra: {
    owner: 'electron',
    repo: 'infra',
  },
  node: {
    owner: 'nodejs',
    repo: 'node',
  },
};

export const ORB_KEY = 'orbs';
export const REPO_OWNER = 'electron';

export const MAIN_BRANCH = 'main';

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

export const ORB_TARGETS = [
  {
    name: 'electronjs/node',
    owner: 'electron',
    repo: 'node-orb',
  },
  {
    name: 'continuousauth/npm',
    owner: 'continuousauth',
    repo: 'npm-orb',
  },
];

export const BACKPORT_CHECK_SKIP = 'backport-check-skip';
export const NO_BACKPORT = 'no-backport';

export const ARC_RUNNER_ENVIRONMENTS = {
  prod: 'terraform/modules/arc/argo_runners_template.tmpl',
};
export const WINDOWS_DOCKER_FILE = 'docker/windows-actions-runner/Dockerfile';
export const WINDOWS_DOCKER_IMAGE_NAME = 'windows-actions-runner';

export interface Commit {
  sha: string;
  message: string;
}

export interface RollTarget {
  name: string;
  depsKey: string;
}

export interface OrbTarget {
  name: string;
  owner: string;
  repo: string;
}

export interface Repository {
  owner: string;
  repo: string;
}
