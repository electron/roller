import * as https from 'https';

function get(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    https
      .get(url, res => {
        let s = '';
        res.on('data', d => {
          s += d.toString('utf8');
        });
        res.on('end', () => {
          resolve(s);
        });
      })
      .on('error', e => {
        reject(e);
      });
  });
}

function getJSON(url: string): Promise<any> {
  return get(url).then(s => JSON.parse(s.slice(s.indexOf('{'))));
}

export type OmahaReleaseVersion = {
  current_version: string;
  current_reldate: string;
  channel: string;
};

export type OmahaRelease = {
  os: 'win' | 'mac' | 'linux' | 'webview' | 'android' | 'cros' | 'ios' | 'win64';
  channel: 'stable' | 'beta' | 'dev' | 'canary' | 'canary_asan';
  timestamp: string;
  version: string;
};

export function getChromiumReleases(): Promise<OmahaRelease[]> {
  return get('https://omahaproxy.appspot.com/history.json').then(s => JSON.parse(s));
}

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

export function getChromiumCommits(
  fromRef: string,
  toRef: string,
): Promise<{ log: ChromiumCommit[]; next?: string }> {
  return getJSON(
    `https://chromium.googlesource.com/chromium/src/+log/${fromRef}..${toRef}?format=JSON`,
  );
}
