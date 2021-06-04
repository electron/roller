import { getChromiumMajorForElectronMajor } from '../../src/utils/get-chromium-major';

describe('getChromiumMajorForElectronMajor', () => {
  it('returns M85 for Electron 10', () => {
    expect(getChromiumMajorForElectronMajor(10)).toEqual(85);
  });

  it('returns M87 for Electron 11', () => {
    expect(getChromiumMajorForElectronMajor(11)).toEqual(87);
  });

  it('returns M89 for Electron 12', () => {
    expect(getChromiumMajorForElectronMajor(12)).toEqual(89);
  });

  it('returns M91 for Electron 13', () => {
    expect(getChromiumMajorForElectronMajor(13)).toEqual(91);
  });

  it('returns M93 for Electron 14', () => {
    expect(getChromiumMajorForElectronMajor(14)).toEqual(93);
  });

  it('returns M96 for Electron 15', () => {
    expect(getChromiumMajorForElectronMajor(15)).toEqual(96);
  });
});
