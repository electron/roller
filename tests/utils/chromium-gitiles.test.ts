import nock from 'nock';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';

import {
  getChromiumHeadSha,
  getChromiumFileContent,
  didChromiumFilesChange,
} from '../../src/utils/chromium-gitiles';

const GITILES_BASE = 'https://chromium.googlesource.com';

describe('chromium-gitiles', () => {
  beforeEach(() => {
    nock.disableNetConnect();
  });

  afterEach(() => {
    nock.cleanAll();
    nock.enableNetConnect();
  });

  describe('getChromiumHeadSha', () => {
    it('returns the HEAD commit SHA', async () => {
      const expectedSha = 'abc123def456789012345678901234567890abcd';
      // Gitiles returns JSON with )]}' prefix for security
      const response = ")]}'\n" + JSON.stringify({ commit: expectedSha });

      nock(GITILES_BASE).get('/chromium/src/+/refs/heads/main?format=JSON').reply(200, response);

      const sha = await getChromiumHeadSha();
      expect(sha).toBe(expectedSha);
    });
  });

  describe('getChromiumFileContent', () => {
    it('returns decoded file content from base64', async () => {
      const fileContent = '#!/bin/bash\necho "Hello World"';
      const base64Content = Buffer.from(fileContent).toString('base64');
      const sha = 'abc123';

      nock(GITILES_BASE)
        .get('/chromium/src/+/abc123/build/test-file.sh?format=TEXT')
        .reply(200, base64Content);

      const content = await getChromiumFileContent('build/test-file.sh', sha);
      expect(content).toBe(fileContent);
    });
  });

  describe('didChromiumFilesChange', () => {
    const fromSha = 'aaa111222333444555666777888999000aaabbbcc';
    const toSha = 'bbb111222333444555666777888999000aaabbbcc';

    it('returns false when no files have changed between SHAs', async () => {
      const fileContent = '#!/bin/bash\ninstall_deps() { echo "deps"; }';
      const base64Content = Buffer.from(fileContent).toString('base64');

      // Both SHAs return the same content for both files
      nock(GITILES_BASE)
        .get(`/chromium/src/+/${fromSha}/build/install-build-deps.sh?format=TEXT`)
        .reply(200, base64Content)
        .get(`/chromium/src/+/${toSha}/build/install-build-deps.sh?format=TEXT`)
        .reply(200, base64Content)
        .get(`/chromium/src/+/${fromSha}/build/install-build-deps.py?format=TEXT`)
        .reply(200, base64Content)
        .get(`/chromium/src/+/${toSha}/build/install-build-deps.py?format=TEXT`)
        .reply(200, base64Content);

      const changed = await didChromiumFilesChange(
        ['build/install-build-deps.sh', 'build/install-build-deps.py'],
        fromSha,
        toSha,
      );

      expect(changed).toBe(false);
    });

    it('returns true when the first file has changed between SHAs', async () => {
      const oldContent = '#!/bin/bash\nold_version';
      const newContent = '#!/bin/bash\nnew_version';
      const oldBase64 = Buffer.from(oldContent).toString('base64');
      const newBase64 = Buffer.from(newContent).toString('base64');

      // First file has different content
      nock(GITILES_BASE)
        .get(`/chromium/src/+/${fromSha}/build/install-build-deps.sh?format=TEXT`)
        .reply(200, oldBase64)
        .get(`/chromium/src/+/${toSha}/build/install-build-deps.sh?format=TEXT`)
        .reply(200, newBase64);

      const changed = await didChromiumFilesChange(
        ['build/install-build-deps.sh', 'build/install-build-deps.py'],
        fromSha,
        toSha,
      );

      expect(changed).toBe(true);
    });

    it('returns true when the second file has changed between SHAs', async () => {
      const sameContent = '#!/bin/bash\nsame_content';
      const sameBase64 = Buffer.from(sameContent).toString('base64');

      const oldPyContent = '#!/usr/bin/env python3\nold_deps = []';
      const newPyContent = '#!/usr/bin/env python3\nnew_deps = ["libfoo"]';
      const oldPyBase64 = Buffer.from(oldPyContent).toString('base64');
      const newPyBase64 = Buffer.from(newPyContent).toString('base64');

      // First file is the same, second file has different content
      nock(GITILES_BASE)
        .get(`/chromium/src/+/${fromSha}/build/install-build-deps.sh?format=TEXT`)
        .reply(200, sameBase64)
        .get(`/chromium/src/+/${toSha}/build/install-build-deps.sh?format=TEXT`)
        .reply(200, sameBase64)
        .get(`/chromium/src/+/${fromSha}/build/install-build-deps.py?format=TEXT`)
        .reply(200, oldPyBase64)
        .get(`/chromium/src/+/${toSha}/build/install-build-deps.py?format=TEXT`)
        .reply(200, newPyBase64);

      const changed = await didChromiumFilesChange(
        ['build/install-build-deps.sh', 'build/install-build-deps.py'],
        fromSha,
        toSha,
      );

      expect(changed).toBe(true);
    });

    it('returns false when content differs only in whitespace', async () => {
      const contentWithTrailingWhitespace = '#!/bin/bash\necho "test"   \n\n';
      const contentWithoutTrailingWhitespace = '#!/bin/bash\necho "test"';
      const base64With = Buffer.from(contentWithTrailingWhitespace).toString('base64');
      const base64Without = Buffer.from(contentWithoutTrailingWhitespace).toString('base64');

      nock(GITILES_BASE)
        .get(`/chromium/src/+/${fromSha}/build/install-build-deps.sh?format=TEXT`)
        .reply(200, base64With)
        .get(`/chromium/src/+/${toSha}/build/install-build-deps.sh?format=TEXT`)
        .reply(200, base64Without);

      const changed = await didChromiumFilesChange(['build/install-build-deps.sh'], fromSha, toSha);

      expect(changed).toBe(false);
    });

    it('returns true when both files have changed', async () => {
      const oldSh = '#!/bin/bash\nold_sh';
      const newSh = '#!/bin/bash\nnew_sh';
      const oldShBase64 = Buffer.from(oldSh).toString('base64');
      const newShBase64 = Buffer.from(newSh).toString('base64');

      // First file changes, so we return true immediately without checking second
      nock(GITILES_BASE)
        .get(`/chromium/src/+/${fromSha}/build/install-build-deps.sh?format=TEXT`)
        .reply(200, oldShBase64)
        .get(`/chromium/src/+/${toSha}/build/install-build-deps.sh?format=TEXT`)
        .reply(200, newShBase64);

      const changed = await didChromiumFilesChange(
        ['build/install-build-deps.sh', 'build/install-build-deps.py'],
        fromSha,
        toSha,
      );

      expect(changed).toBe(true);
    });

    it('returns false for empty file list', async () => {
      const changed = await didChromiumFilesChange([], fromSha, toSha);
      expect(changed).toBe(false);
    });

    it('handles single file correctly when changed', async () => {
      const oldContent = 'version = 1';
      const newContent = 'version = 2';
      const oldBase64 = Buffer.from(oldContent).toString('base64');
      const newBase64 = Buffer.from(newContent).toString('base64');

      nock(GITILES_BASE)
        .get(`/chromium/src/+/${fromSha}/single-file.txt?format=TEXT`)
        .reply(200, oldBase64)
        .get(`/chromium/src/+/${toSha}/single-file.txt?format=TEXT`)
        .reply(200, newBase64);

      const changed = await didChromiumFilesChange(['single-file.txt'], fromSha, toSha);
      expect(changed).toBe(true);
    });

    it('handles single file correctly when unchanged', async () => {
      const content = 'version = 1';
      const base64Content = Buffer.from(content).toString('base64');

      nock(GITILES_BASE)
        .get(`/chromium/src/+/${fromSha}/single-file.txt?format=TEXT`)
        .reply(200, base64Content)
        .get(`/chromium/src/+/${toSha}/single-file.txt?format=TEXT`)
        .reply(200, base64Content);

      const changed = await didChromiumFilesChange(['single-file.txt'], fromSha, toSha);
      expect(changed).toBe(false);
    });
  });
});
