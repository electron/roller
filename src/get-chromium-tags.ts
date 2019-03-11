import * as https from 'https';

export function getChromiumTags() {
  return new Promise((resolve, reject) => {
    https.get('https://chromium.googlesource.com/chromium/src/+refs/tags?format=JSON', (res) => {
      let s = '';
      res.on('data', (d) => {
        s += d.toString('utf8');
      });
      res.on('end', () => {
        resolve(JSON.parse(s.slice(s.indexOf('{'))));
      });
    }).on('error', (e) => {
      reject(e);
    });
  });
}

export interface ChromiumCommit {
  'commit': string;
  'tree': string;
  'parents': string[];
  'author': {
    'name': string;
    'email': string;
    'time': string;
  };
  'committer': {
    'name': string;
    'email': string;
    'time': string;
  };
  'message': string;
}

export function getChromiumCommits(fromRef: string, toRef: string): Promise<{log: ChromiumCommit[], next?: string}> {
  return new Promise((resolve, reject) => {
    https.get(`https://chromium.googlesource.com/chromium/src/+log/${fromRef}..${toRef}?format=JSON`, (res) => {
      let s = '';
      res.on('data', (d) => {
        s += d.toString('utf8');
      });
      res.on('end', () => {
        resolve(JSON.parse(s.slice(s.indexOf('{'))));
      });
    }).on('error', (e) => {
      reject(e);
    });
  });
}
