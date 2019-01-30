import * as debug from 'debug';

import { getChromiumTags } from './get-chromium-tags';
import { getExtraCommits } from './get-extra-commits';
import { raisePR, raisePR4 } from './pr';
import { rollChromium, rollChromium4 } from './roll-chromium';
import { branchFromRef } from './utils/branch-from-ref';
import { getOctokit } from './utils/octokit';

const d = debug('roller:handleLibccPush()');

/**
 * Handle a push to `/libcc-hook`.
 *
 * @param {*} _
 * @param {(GitdataCreateReferenceParams & ReposMergeParams)} data
 * @returns {Promise void}
 */
export async function handleLibccPush(
  _,
  data?: { ref: string, after: string },
): Promise<void> {
  if (data && data.ref) {
    d('handling push');
    const { ref } = data;
    const branch = branchFromRef(ref);

    if (branch) {
      d('upgrading chromium in fork');
      const forkBranchName = await rollChromium(branch, data.after);
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

function lexicographical(a: number[], b: number[]) {
  for (const i in a) {
    if (a[i] !== b[i]) {
      return a[i] - b[i];
    }
  }
  return 0;
}
function compareVersions(a: string, b: string): number {
  return lexicographical(a.split('.').map(Number), b.split('.').map(Number));
}

export async function handleChromiumCheck(): Promise<void> {
  d('fetching chromium tags');
  const chromiumTags = await getChromiumTags();

  const github = await getOctokit();
  d('getting electron branches');
  const branches = await github.repos.getBranches({owner: 'electron', repo: 'electron', protected: true});
  const post4Branches = branches.data
    .filter((branch) => branch.name === 'master' || Number(branch.name.split(/-/)[0]) >= 4);

  for (const branch of post4Branches) {
    d(`getting DEPS for ${branch.name}`);
    const depsData = await github.repos.getContent({
      owner: 'electron',
      repo: 'electron',
      path: 'DEPS',
      ref: branch.commit.sha,
    });
    const deps = Buffer.from(depsData.data.content, 'base64').toString('utf8');
    const [, chromiumVersion] = /chromium_version':\n +'(.+?)',/m.exec(deps);
    const chromiumMajorVersion = Number(chromiumVersion.split('.')[0]);
    d(`computing latest upstream version for Chromium ${chromiumMajorVersion}`);
    const upstreamVersions = Object.keys(chromiumTags)
      .filter((v) => Number(v.split('.')[0]) === chromiumMajorVersion)
      .sort(compareVersions);
    const latestUpstreamVersion = upstreamVersions[upstreamVersions.length - 1];
    if (compareVersions(latestUpstreamVersion, chromiumVersion) > 0) {
      d(`branch ${branch.name} could upgrade from ${chromiumVersion} to ${latestUpstreamVersion}`);
      const forkBranchName = await rollChromium4(branch.name, latestUpstreamVersion);
      if (forkBranchName) {
        d('raising PR');
        await raisePR4(forkBranchName, branch.name, [], latestUpstreamVersion);
        return;
      } else {
        d('chromium upgrade failed, not raising any PRs');
        return;
      }
    }
  }
}
