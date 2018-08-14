import * as debug from 'debug';

// In a string that looks like ""/HEAD/blub/blab", match
// the last [A-Za-z] that isn't followed by a /
const RGX_LAST_SLASHED_PART = /([A-Za-z_-\d]*)(?!.*\/)/gi;
// Is this an Electron release branch?
const RGX_ELECTRON_RELEASE = /^electron-([0-9]-[0-9]-x)$/gi;

const d = debug('roller:branchFromRef()');

/**
 * Returns the target branch given a ref.
 *
 * @export
 * @param {string} input
 * @returns {string}
 */
export function branchFromRef(input: string): string | null {
  d(`calculating branch from ref "${input}"`);
  const lastRefMatch = input.match(RGX_LAST_SLASHED_PART);
  const lastRef = Array.isArray(lastRefMatch) ? lastRefMatch[0] : null;

  if (lastRef === 'master') {
    return 'master';
  } else {
    RGX_ELECTRON_RELEASE.lastIndex = 0;
    const electronBranchMatch = RGX_ELECTRON_RELEASE.exec(lastRef);

    if (Array.isArray(electronBranchMatch)) {
      return electronBranchMatch[1] || null;
    }
  }

  return null;
}
