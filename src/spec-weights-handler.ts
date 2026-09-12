import debug from 'debug';

import { MAIN_BRANCH, REPOS } from './constants.js';
import { getOctokit } from './utils/octokit.js';
import { getSupportedBranches } from './utils/get-supported-branches.js';
import { computeRefresh, rollSpecWeights } from './utils/roll-spec-weights.js';
import type { Branch } from './types.js';

/**
 * Refreshes script/spec-weights.json on main and every supported release
 * branch from the timings their CI test jobs upload, opening a PR per branch
 * whose shards would pack materially better with fresh numbers.
 */
export async function handleSpecWeightsCheck(target?: string): Promise<void> {
  const d = debug('roller/spec-weights:handleSpecWeightsCheck()');
  const github = await getOctokit();

  let branches: Branch[];
  if (target) {
    const { data } = await github.repos.getBranch({ ...REPOS.electron, branch: target });
    branches = [{ name: data.name, commit: { sha: data.commit.sha } }];
  } else {
    d('Fetching release branches for electron/electron');
    const releaseBranches = await getSupportedBranches(github, 4);
    const { data: main } = await github.repos.getBranch({
      ...REPOS.electron,
      branch: MAIN_BRANCH,
    });
    branches = [...releaseBranches, { name: main.name, commit: { sha: main.commit.sha } }];
  }
  d(`Checking ${branches.map((b) => b.name).join(', ')}`);

  let failed = false;
  for (const branch of branches) {
    try {
      await refreshBranch(branch);
    } catch (e) {
      d(`Failed to refresh ${branch.name}: ${e.message}`);
      failed = true;
    }
  }

  if (failed) {
    throw new Error('One or more spec weight refreshes failed - see logs for more details');
  }
}

async function refreshBranch(branch: Branch): Promise<void> {
  const d = debug(`roller/spec-weights:refreshBranch(${branch.name})`);
  const github = await getOctokit();

  const refresh = await computeRefresh(github, branch.name);
  if (!refresh) return;

  if (!refresh.assessment.material) {
    d('Committed weights are within tolerance of the fresh measurements - nothing to do');
    return;
  }

  d(`Refresh is material:\n  ${refresh.assessment.reasons.join('\n  ')}`);
  const rolled = await rollSpecWeights(branch, refresh);
  d(rolled ? 'PR created or updated' : 'Open PR already up to date');
}
