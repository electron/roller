import { YAML_ROLL_TARGETS, YamlRollTarget } from '../constants';

interface PRTextDetails {
  previousValue: string;
  newValue: string;
  branchName: string;
}

export function getYamlPRText(rollTarget: YamlRollTarget, details: PRTextDetails) {
  switch (rollTarget.name) {
    case YAML_ROLL_TARGETS.nodeOrb.name:
      return getNodeOrbPRText(details);
    default:
      throw new Error(`Roll target ${rollTarget.name} does not have PR text defined!`);
  }
}

function getNodeOrbPRText(details: PRTextDetails) {
  const { newValue, previousValue, branchName } = details;

  return {
    title: `chore: bump ${YAML_ROLL_TARGETS.nodeOrb.name} to ${newValue} (${branchName}))`,
    body: `Updating node-orb to ${newValue} (${branchName})

<!--
Original-Version: ${previousValue}
-->

Notes: no-notes`,
  };
}
