import { getPRText } from '../../src/utils/pr-text';
import { ROLL_TARGETS, RollTarget } from '../../src/constants';

jest.mock('../../src/utils/octokit');

describe('getPRText()', () => {
  describe('Node.js target', () => {
    it('returns a Node.js PR body', () => {
      const target = ROLL_TARGETS.node;
      const details = {
        newVersion: 'v10.0.0',
        previousVersion: 'v4.0.0',
        branchName: 'master'
      };
      const prText = getPRText(target, details);
  
      // Correct title.
      expect(prText.title)
        .toBe(`chore: bump ${ROLL_TARGETS.node.name} to ${details.newVersion} (${details.branchName})`);
      // Contains short description.
      expect(prText.body)
        .toContain(`Updating Node.js to ${details.newVersion}.`);
      // Contains original Node.js version reference.
      expect(prText.body)
        .toContain(`Original-Version: ${details.previousVersion}`);
      // Contains release notes.
      expect(prText.body)
        .toContain(`Notes: Updated Node.js to ${details.newVersion}`);
      // Contains link to Node.js diff.
      expect(prText.body)
        .toContain(`https://github.com/nodejs/node/compare/${details.previousVersion}...${details.newVersion}`);
    });
  });
  describe('Chromium target', () => {
    it('returns a Chromium PR body', () => {
      const target = ROLL_TARGETS.chromium;
      const details = {
        newVersion: '1.0.154.65',
        previousVersion: '1.0.154.61',
        branchName: 'testBranch'
      };

      const prText = getPRText(target, details);

      // Correct title.
      expect(prText.title)
        .toContain(`chore: bump ${ROLL_TARGETS.chromium.name}`);
      // Contains short description.
      expect(prText.body)
        .toContain(`Updating Chromium`);
      // Contains original Chromium version reference
      expect(prText.body)
        .toContain(`Original-Version: ${details.previousVersion}`);
      // Contains link to Chromium diff.
      expect(prText.body)
        .toContain(`https://chromium.googlesource.com/chromium/src/+log/${details.previousVersion}..${details.newVersion}?n=10000&pretty=fuller`);
    });

    it('assumes master if version is a commit SHA', () => {
      const target = ROLL_TARGETS.chromium;
      const details = {
        newVersion: '9F86D081884C7D659A2FEAA0C55',
        previousVersion: 'AD015A3BF4F1B2B0B822CD15D6C15B0F00A08',
        branchName: 'testBranch'
      };

      const prText = getPRText(target, details);

      expect(prText.body).toContain('(master)');
      expect(prText.body).toContain('no-notes');
    });

    it('adds version to release notes if version is release tag', () => {
      const target = ROLL_TARGETS.chromium;
      const details = {
        newVersion: '1.0.154.65',
        previousVersion: '1.0.154.61',
        branchName: 'testBranch'
      };

      const prText = getPRText(target, details);
      expect(prText.body).toContain(`Updated Chromium to ${details.newVersion}.`);
    });
  });
  it('throws if invalid roll target passed in', () => {
    const target: RollTarget = {
      name: '💩',
      depsKey: '🔑'
    };
    const details = {
      newVersion: 'v10.0.0',
      previousVersion: 'v4.0.0',
      branchName: 'master'
    };
    expect(() => {
      getPRText(target, details);
    }).toThrowError('Roll target 💩 does not have PR text defined!');
  });
});
