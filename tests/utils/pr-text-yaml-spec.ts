import { getYamlPRText } from '../../src/utils/pr-text-yaml';
import { YAML_ROLL_TARGETS } from '../../src/constants';

jest.mock('../../src/utils/octokit');

describe('getYamlPRText', () => {
  describe('node-orb target', () => {
    it('returns a node-orb PR body', () => {
      const target = YAML_ROLL_TARGETS.nodeOrb;
      const details = {
        newValue: 'v1.1.0',
        previousValue: 'v1.0.0',
        branchName: 'main',
      };
      const prText = getYamlPRText(target, details);

      // Correct title.
      expect(prText.title).toBe(
        `chore: bump ${YAML_ROLL_TARGETS.nodeOrb.name} to ${details.newValue} (${details.branchName}))`,
      );
      expect(prText.body).toContain(
        `Updating node-orb to ${details.newValue} (${details.branchName})`,
      );
      expect(prText.body).toContain(`Original-Version: ${details.previousValue}`);
      expect(prText.body).toContain(`Notes: no-notes`);
    });
  });
});
