import { branchFromRef } from '../../src/utils/branch-from-ref';

describe('branchFromRef()', () => {
  it('returns master', () => {
    const branch = branchFromRef(`refs/HEADS/master`);
    expect(branch).toBe('master');
  });

  it('returns an electron release branch', () => {
    const branch = branchFromRef(`refs/HEADS/electron-3-0-x`);
    expect(branch).toBe('3-0-x');
  });

  it(`returns null if it's anything else`, () => {
    const branch = branchFromRef(`refs/HEADS/bwap-bwap`);
    expect(branch).toBe(null);
  });
})
