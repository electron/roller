const CHROMIUM_GITILES_BASE = 'https://chromium.googlesource.com/chromium/src';

/**
 * Get the current HEAD SHA from Chromium main branch
 */
export async function getChromiumHeadSha(): Promise<string> {
  const response = await fetch(`${CHROMIUM_GITILES_BASE}/+/refs/heads/main?format=JSON`);
  const text = await response.text();
  // Gitiles returns JSON with )]}' prefix for security
  const data = JSON.parse(text.slice(text.indexOf('{')));
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
