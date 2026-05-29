export const CHROMIUM_GITILES_BASE = 'https://chromium.googlesource.com/chromium/src';

export interface ChromiumCommit {
  commit: string;
  tree: string;
  parents: string[];
  author: {
    name: string;
    email: string;
    time: string;
  };
  committer: {
    name: string;
    email: string;
    time: string;
  };
  message: string;
}

/**
 * Parse a Gitiles JSON response, stripping the )]}' security prefix.
 */
function parseGitilesJSON(text: string) {
  return JSON.parse(text.slice(text.indexOf('{')));
}

/**
 * Get the current HEAD SHA from Chromium main branch
 */
export async function getChromiumHeadSha(): Promise<string> {
  const response = await fetch(`${CHROMIUM_GITILES_BASE}/+/refs/heads/main?format=JSON`);
  const text = await response.text();
  const data = parseGitilesJSON(text);
  return data.commit;
}

/**
 * Get file content at a specific SHA from Chromium repo
 */
export async function getChromiumFileContent(filePath: string, sha: string): Promise<string> {
  const url = `${CHROMIUM_GITILES_BASE}/+/${sha}/${filePath}?format=TEXT`;
  const response = await fetch(url);
  const base64Content = await response.text();
  return Buffer.from(base64Content, 'base64').toString('utf8');
}

/**
 * Check if any of the specified files changed between two SHAs
 */
export async function didChromiumFilesChange(
  files: string[],
  fromSha: string,
  toSha: string,
): Promise<boolean> {
  for (const file of files) {
    const [fromContent, toContent] = await Promise.all([
      getChromiumFileContent(file, fromSha),
      getChromiumFileContent(file, toSha),
    ]);

    if (fromContent.trim() !== toContent.trim()) {
      return true;
    }
  }

  return false;
}

export async function getChromiumCommits(
  fromRef: string,
  toRef: string,
): Promise<{ log: ChromiumCommit[]; next?: string }> {
  const url = `${CHROMIUM_GITILES_BASE}/+log/${fromRef}..${toRef}?format=JSON`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch Chromium commits: ${response.status}`);
  }
  const text = await response.text();
  return parseGitilesJSON(text);
}
