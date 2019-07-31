export function compareChromiumVersions(a: string, b: string): number {
  return lexicographical(a.split('.').map(Number), b.split('.').map(Number));
}

function lexicographical(a: number[], b: number[]) {
  for (const i in a) {
    if (a[i] !== b[i]) {
      return a[i] - b[i];
    }
  }
  return 0;
}
