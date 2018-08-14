export const mockOctokit = {
  gitdata: {
    createReference: jest.fn(),
    getReference: jest.fn()
  },
  repos: {
    getContent: jest.fn(),
    updateFile: jest.fn()
  }
}
