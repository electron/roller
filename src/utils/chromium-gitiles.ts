import * as https from 'https';

const CHROMIUM_GITILES_BASE = 'https://chromium.googlesource.com/chromium/src';

function get(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        let s = '';
        res.on('data', (d) => {
          s += d.toString('utf8');
        });
        res.on('end', () => {
          resolve(s);
        });
      })
      .on('error', (e) => {
        reject(e);
      });
  });
}

function getJSON(url: string): Promise<any> {
  return get(url).then((s) => JSON.parse(s.slice(s.indexOf('{'))));
}

/**
 * Get the current HEAD SHA from Chromium main branch
 */
export async function getChromiumHeadSha(): Promise<string> {
  const data = await getJSON(`${CHROMIUM_GITILES_BASE}/+/refs/heads/main?format=JSON`);
  return data.commit;
}

/**
 * Get file content at a specific SHA from Chromium repo
 */
export async function getChromiumFileContent(filePath: string, sha: string): Promise<string> {
  const url = `${CHROMIUM_GITILES_BASE}/+/${sha}/${filePath}?format=TEXT`;
  const base64Content = await get(url);
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
