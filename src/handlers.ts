import * as debug from 'debug';

import { getExtraCommits } from './get-extra-commits';
import { raisePR } from './pr';
import { rollChromium } from "./roll-chromium";
import { branchFromRef } from './utils/branch-from-ref';

const d = debug('roller:handleLibccPush()');

/**
 * Handle a push to `/libcc-hook`.
 *
 * @param {*} _
 * @param {(GitdataCreateReferenceParams & ReposMergeParams)} data
 * @returns {Promise void}
 */
export async function handleLibccPush(
  _, data?: { ref: string, after: string }
): Promise<void> {
  if (data && data.ref) {
    d('handling push');
    const { ref } = data;
    const branch = branchFromRef(ref);

    if (branch) {
      d('upgrading chromium in fork');
      const forkBranchName = await rollChromium(branch, data.after)
      if (forkBranchName) {
        d('raising PR');
        await raisePR(forkBranchName, branch, await getExtraCommits(branch, data.after));
        return;
      } else {
        d('libcc upgrade failed, not raising any PRs');
        return;
      }
    } else {
      d(`received ${ref}, could not detect target branch, not doing anything`);
      return;
    }
  }

  d(`received unknown request, not doing anything`);
}
