export const mockOctokit = {
  git: {
    createRef: jest.fn(),
    getRef: jest.fn(),
  },
  repos: {
    getContent: jest.fn(),
    updateFile: jest.fn(),
  },
};
