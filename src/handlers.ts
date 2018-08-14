import { GitdataCreateReferenceParams, ReposMergeParams } from '@octokit/rest';

import { raisePR } from './pr';
import { rollChromium } from "./roll-chromium";
import { branchFromRef } from './utils/branch-from-ref';

/**
 * Handle a push to `/libcc-hook`.
 *
 * @param {*} _
 * @param {(GitdataCreateReferenceParams & ReposMergeParams)} data
 * @returns {Promise void}
 */
export async function handleLibccPush(
  _, data?: any
): Promise<void> {
  if (data && data.ref) {
    const { ref } = data;
    const branch = branchFromRef(ref);

    if (branch) {
      const forkBranchName = await rollChromium(branch, data.after)
      if (forkBranchName) {
        await raisePR(forkBranchName, branch);
      }
    } else {
      console.log(`handleLibccPush(): Received ${ref}, not doing anything.`);
    }
  }

  console.log(`handleLibccPush(): Received unknown request, not doing anything`);
}
