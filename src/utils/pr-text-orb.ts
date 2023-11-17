import { OrbTarget } from '../constants';

interface PRTextDetails {
  previousVersion: string;
  newVersion: string;
  branchName: string;
}

export function getOrbPRText(OrbTarget: OrbTarget, details: PRTextDetails) {
  const { newVersion, previousVersion, branchName } = details;

  return {
    title: `chore: bump ${OrbTarget.name} to ${newVersion} (${branchName})`,
    body: `Updating ${OrbTarget.name} to ${newVersion} (${branchName})

<!--
Original-Version: ${previousVersion}
-->`,
  };
}
