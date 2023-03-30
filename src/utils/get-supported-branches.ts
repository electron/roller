import { NUM_SUPPORTED_VERSIONS } from '../constants';

// Get array of currently supported branches
export function getSupportedBranches(branches: { name: string }[]): string[] {
  const releaseBranches = branches
    .filter(branch => {
      const releasePattern = /^(\d)+-(?:(?:[0-9]+-x$)|(?:x+-y$))$/;
      return releasePattern.test(branch.name);
    })
    .map(b => b.name);

  const filtered: Record<string, string> = {};
  releaseBranches
    .sort((a, b) => {
      const aParts = a.split('-');
      const bParts = b.split('-');
      for (let i = 0; i < aParts.length; i += 1) {
        if (aParts[i] === bParts[i]) continue;
        return parseInt(aParts[i], 10) - parseInt(bParts[i], 10);
      }
      return 0;
    })
    .forEach(branch => {
      return (filtered[branch.split('-')[0]] = branch);
    });

  const values = Object.values(filtered);
  return values.sort((a, b) => parseInt(a, 10) - parseInt(b, 10)).slice(-NUM_SUPPORTED_VERSIONS);
}
