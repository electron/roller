export const REPOS = {
  electron: {
    owner: 'electron',
    repo: 'electron',
  },
  electronInfra: {
    owner: 'electron',
    repo: 'infra',
  },
  buildImages: {
    owner: 'electron',
    repo: 'build-images',
  },
  node: {
    owner: 'nodejs',
    repo: 'node',
  },
};

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

export const BACKPORT_CHECK_SKIP = 'backport-check-skip';
export const NO_BACKPORT = 'no-backport';

export const ARC_RUNNER_ENVIRONMENTS = {
  prod: 'terraform/modules/arc/argo_runners_template.tmpl',
};
export const WINDOWS_DOCKER_FILE = 'docker/windows-actions-runner/Dockerfile';
export const WINDOWS_DOCKER_IMAGE_NAME = 'windows-actions-runner';

// Build-images Chromium deps configuration
export const BUILD_IMAGES_INSTALL_DEPS_FILE = 'tools/install-deps.sh';
export const CHROMIUM_DEPS_FILES = ['build/install-build-deps.sh', 'build/install-build-deps.py'];

export interface Commit {
  sha: string;
  message: string;
}

export interface RollTarget {
  name: string;
  depsKey: string;
}

export interface Repository {
  owner: string;
  repo: string;
}
