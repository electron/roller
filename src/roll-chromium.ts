import GitHub from '@octkit/rest';

const github = new GitHub()
github.authenticate({
  type: 'token',
  token: process.env.GITHUB_TOKEN
});

export default async (electronBranch, libccRef) => {
  github.
}