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
