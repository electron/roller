import { RollTarget, rollTargets } from '../constants';

interface PRTextDetails {
  previousVersion: string;
  newVersion: string;
  branchName: string;
}

export function getPRText(rollTarget: RollTarget, details: PRTextDetails) {
  switch (rollTarget.name) {
    case rollTargets.node.name:
      return getNodePRText(details);
    case rollTargets.chromium.name:
      return getChromiumPRText(details);
    default:
      throw new Error(`Roll target ${rollTarget.name} does not have PR text defined!`);
  }
}

function getChromiumPRText(details: PRTextDetails) {
  const { newVersion, previousVersion, branchName } = details;

  const isLKGR = !newVersion.includes('.');
  const shortVersion = isLKGR ? newVersion.substr(11) : newVersion;
  const shortPreviousVersion = isLKGR ? previousVersion.substr(11) : previousVersion;
  const diffLink = `https://chromium.googlesource.com/chromium/src/+log/` +
                   `${previousVersion}..${newVersion}?n=10000&pretty=fuller`;
  return {
    title: `chore: bump ${rollTargets.chromium.name} to ${shortVersion} (${branchName})`,
    body: `Updating Chromium to ${shortVersion}${isLKGR ? ' (lkgr)' : ''}.

See [all changes in ${shortPreviousVersion}..${shortVersion}](${diffLink})

<!--
Original-Version: ${previousVersion}
-->

Notes: ${isLKGR ? 'no-notes' : `Updated Chromium to ${newVersion}.`}`,
  };
}

function getNodePRText(details: PRTextDetails) {
  const { newVersion, previousVersion, branchName } = details;

  const diffLink = `https://github.com/nodejs/node/compare/${previousVersion}...${newVersion}`;
  return {
    title: `chore: bump ${rollTargets.node.name} to ${newVersion} (${branchName})`,
    body: `Updating Node.js to ${newVersion}.

See [all changes in ${previousVersion}..${newVersion}](${diffLink})

<!--
Original-Version: ${previousVersion}
-->

Notes: Updated Node.js to ${newVersion}.`};
}
