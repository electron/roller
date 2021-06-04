export const getChromiumMajorForElectronMajor = (electronMajor: number) => {
  if (electronMajor < 10) {
    return null;
  }

  // Up and till Electron 15 we did every other M release
  if (electronMajor < 15) {
    const offset = 85;
    const releasesSinceOffset = electronMajor - 10;
    return offset + releasesSinceOffset * 2;
  }

  // From Electron 15 onwards we did every other M release but we SKIPPED a release between 14 and 15
  const offset = 96;
  const releasesSinceOffset = electronMajor - 15;
  return offset + releasesSinceOffset * 2;
};
