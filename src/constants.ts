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

// Login of the GitHub App that opens and maintains roll PRs. The bot only ever
// updates roll PRs it authored itself.
export const ROLLER_BOT_LOGIN = 'electron-roller[bot]';

export const MAIN_BRANCH = 'main';

export const CHROMIUM_UPGRADE_WORKFLOW = {
  owner: 'electron',
  repo: 'agent-workflows',
  workflow_id: 'chromium-upgrade.yml',
  ref: 'main',
};

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

// The CI test-shard weight tables in electron/electron, refreshed from the
// spec-timings.json files the test jobs upload.
export const SPEC_WEIGHTS = {
  filePath: 'script/spec-weights.json',
  specDir: 'spec',
  workflowFile: 'build.yml',
  // Green push runs whose timings are combined (median per file) for one refresh.
  runsToSample: 3,
};
