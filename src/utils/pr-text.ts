import { ROLL_TARGETS, RollTarget } from '../constants';

interface PRTextDetails {
  previousVersion: string;
  newVersion: string;
  branchName: string;
}

export function getPRText(rollTarget: RollTarget, details: PRTextDetails) {
  switch (rollTarget.name) {
    case ROLL_TARGETS.node.name:
      return getNodePRText(details);
    case ROLL_TARGETS.chromium.name:
      return getChromiumPRText(details);
    default:
      throw new Error(`Roll target ${rollTarget.name} does not have PR text defined!`);
  }
}

function getChromiumPRText(details: PRTextDetails) {
  const { newVersion, previousVersion, branchName } = details;

  const isMain = !newVersion.includes('.');
  const shortVersion = isMain ? newVersion.substr(11) : newVersion;
  const shortPreviousVersion = isMain ? previousVersion.substr(11) : previousVersion;
  const diffLink =
    `https://chromium.googlesource.com/chromium/src/+log/` +
    `${previousVersion}..${newVersion}?n=10000&pretty=fuller`;
  return {
    title: `chore: bump ${ROLL_TARGETS.chromium.name} to ${shortVersion} (${branchName})`,
    body: `Updating Chromium to ${shortVersion}${isMain ? ' (main)' : ''}.

See [all changes in ${shortPreviousVersion}..${shortVersion}](${diffLink})

<!--
Original-Version: ${previousVersion}
-->

Notes: ${isMain ? 'no-notes' : `Updated Chromium to ${newVersion}.`}`,
  };
}

function getNodePRText(details: PRTextDetails) {
  const { newVersion, previousVersion, branchName } = details;

  const diffLink = `https://github.com/nodejs/node/compare/${previousVersion}...${newVersion}`;
  return {
    title: `chore: bump ${ROLL_TARGETS.node.name} to ${newVersion} (${branchName})`,
    body: `Updating Node.js to ${newVersion}.

See [all changes in ${previousVersion}..${newVersion}](${diffLink})

<!--
Original-Version: ${previousVersion}
-->

Notes: Updated Node.js to ${newVersion}.`,
  };
}

export function getInfraPRText(bumpSubject: string, newShortVersion: string) {
  return {
    title: `build: bump ${bumpSubject} to ${newShortVersion}`,
    body: `Updating ${bumpSubject} to \`${newShortVersion}\``,
  };
}
