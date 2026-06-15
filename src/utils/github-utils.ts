import type { Octokit as GitHub } from '@octokit/rest';

export async function getContent(
  github: GitHub,
  options: Parameters<typeof github.repos.getContent>[0],
): Promise<{ content: string; sha: string } | null> {
  const { data } = await github.repos.getContent(options);

  if (!('content' in data)) return null;

  const content = Buffer.from(data.content, 'base64').toString('utf8');
  return { content, sha: data.sha };
}
