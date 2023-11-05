import { getOrbPRText } from '../../src/utils/pr-text-orb';
import { ORB_TARGETS } from '../../src/constants';

jest.mock('../../src/utils/octokit');

describe('getOrbPRText', () => {
  describe('node-orb target', () => {
    it('returns a node-orb PR body', () => {
      const target = {
        name: 'electronjs/node',
        owner: 'electron',
        repo: 'node-orb',
      };
      const details = {
        newVersion: '1.1.0',
        previousVersion: '1.0.0',
        branchName: 'main',
      };
      const prText = getOrbPRText(target, details);

      // Correct title.
      expect(prText.title).toBe(
        `chore: bump ${target.name} to ${details.newVersion} (${details.branchName}))`,
      );
      expect(prText.body).toContain(
        `Updating ${target.name} to ${details.newVersion} (${details.branchName})`,
      );
      expect(prText.body).toContain(`Original-Version: ${details.previousVersion}`);
      expect(prText.body).toContain(`Notes: no-notes`);
    });
  });
});
