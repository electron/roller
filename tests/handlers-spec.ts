import { rollChromium } from '../src/roll-chromium';
import { handleLibccPush } from '../src/handlers';

jest.mock('../src/roll-chromium');

describe('handleLibccPush()', () => {
  it('rolls chromium for the right branch', async () => {
    const mockData = { ref: 'electron-3-0-x' };
    await handleLibccPush(null, mockData as any)

    expect(rollChromium).toHaveBeenCalled();
  });

  it('does not do anything for anything else', async () => {
    const mockData = { ref: '💩' };
    await handleLibccPush(null, mockData as any)

    expect(rollChromium).toHaveBeenCalledTimes(0);
  });

  it('handles garbage data', async () => {
    await handleLibccPush(null, '💩' as any)

    expect(rollChromium).toHaveBeenCalledTimes(0);
  });
});
