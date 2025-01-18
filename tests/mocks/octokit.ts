import { vi } from 'vitest';

export const mockOctokit = {
  git: {
    createRef: vi.fn(),
    getRef: vi.fn(),
  },
  repos: {
    getContent: vi.fn(),
    updateFile: vi.fn(),
  },
};
