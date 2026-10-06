import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  aggregateRun,
  assessChange,
  jobKeyOfArtifact,
  longestShard,
  pickTable,
  mergeRuns,
  packShards,
  serializeWeights,
  shardCountOf,
  timingsFromArtifactZip,
} from '../../src/utils/spec-weights.js';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), '../fixtures/spec-weights');

describe('spec-weights', () => {
  describe('timingsFromArtifactZip()', () => {
    it('reads spec-timings.json out of a test_artifacts zip and ignores the rest', () => {
      const zip = readFileSync(join(fixtures, 'test_artifacts_darwin_x64_1.zip'));
      const timings = timingsFromArtifactZip(zip);
      expect(timings).toHaveLength(1);
      expect(timings[0]).toMatchObject({ platform: 'darwin', arch: 'x64', mas: false });
      expect(timings[0].files['spec/api-browser-window-spec.ts']).toBeCloseTo(364.971, 3);
    });

    it('rejects a timings file with no per-file data', () => {
      const zip = readFileSync(join(fixtures, 'test_artifacts_truncated_1.zip'));
      expect(() => timingsFromArtifactZip(zip)).toThrow(/no per-file timings/);
    });

    it('rejects something that is not a zip', () => {
      expect(() => timingsFromArtifactZip(Buffer.from('nope'))).toThrow(/not a zip/);
    });
  });

  describe('jobKeyOfArtifact()', () => {
    it('maps the plain and sanitizer test artifacts to their job key', () => {
      expect(jobKeyOfArtifact('test_artifacts_darwin_x64_1')).toBe('darwin_x64');
      expect(jobKeyOfArtifact('test_artifacts_mas_arm64_2')).toBe('mas_arm64');
      expect(jobKeyOfArtifact('test_artifacts_linux_x64_x11_3')).toBe('linux_x64');
      expect(jobKeyOfArtifact('test_artifacts_linux_x64_asan_x11_1')).toBe('linux_x64_asan');
      expect(jobKeyOfArtifact('test_artifacts_linux_arm64_x11_2')).toBe('linux_arm64');
      expect(jobKeyOfArtifact('test_artifacts_darwin_arm64_ubsan_3')).toBe('darwin_arm64_ubsan');
      expect(jobKeyOfArtifact('test_artifacts_win_arm64_2')).toBe('win_arm64');
    });

    it('ignores the Wayland allowlist job and non-test artifacts', () => {
      expect(jobKeyOfArtifact('test_artifacts_linux_x64_wayland_1')).toBeNull();
      expect(jobKeyOfArtifact('generated_artifacts_darwin_x64')).toBeNull();
      expect(jobKeyOfArtifact('test_artifacts_darwin_x64')).toBeNull();
    });
  });

  describe('pickTable()', () => {
    const all = {
      darwin_x64: { a: 1 },
      darwin_arm64: { a: 2 },
      mas_x64: { a: 3 },
      linux_x64: { a: 4 },
      linux_x64_asan: { a: 5 },
    };

    it("uses the job's own table when there is one", () => {
      expect(pickTable(all, 'linux_x64_asan')).toBe(all.linux_x64_asan);
    });

    it('falls back to the nearest table of the same build type, same arch first', () => {
      expect(pickTable(all, 'darwin_arm64_ubsan')).toBe(all.darwin_arm64);
      expect(pickTable(all, 'mas_arm64')).toBe(all.mas_x64);
      expect(pickTable(all, 'linux_arm64')).toBe(all.linux_x64);
    });

    it('falls back from mas to darwin, and to a legacy per-platform table', () => {
      expect(pickTable({ darwin_arm64: { a: 9 } }, 'mas_x64')).toEqual({ a: 9 });
      const legacy = { darwin: { a: 1 }, linux: { a: 2 }, win32: { a: 3 } };
      expect(pickTable(legacy, 'mas_x64')).toBe(legacy.darwin);
      expect(pickTable(legacy, 'linux_x64_asan')).toBe(legacy.linux);
      expect(pickTable(legacy, 'win_arm64')).toBe(legacy.win32);
      expect(pickTable({}, 'win_x64')).toEqual({});
    });
  });

  describe('shardCountOf()', () => {
    it('matches the CI matrix', () => {
      expect(shardCountOf('darwin_x64')).toBe(3);
      expect(shardCountOf('mas_x64')).toBe(3);
      expect(shardCountOf('darwin_arm64')).toBe(2);
      expect(shardCountOf('mas_arm64')).toBe(2);
      expect(shardCountOf('darwin_arm64_ubsan')).toBe(3);
      expect(shardCountOf('linux_x64')).toBe(3);
      expect(shardCountOf('linux_arm64')).toBe(3);
      expect(shardCountOf('linux_x64_asan')).toBe(3);
      expect(shardCountOf('win_x64')).toBe(2);
      expect(shardCountOf('win_arm64')).toBe(2);
    });
  });

  describe('aggregateRun()', () => {
    it("keeps one table per job and takes the max across a job's shards", () => {
      const t = (files: Record<string, number>) => ({
        platform: 'x',
        arch: 'x',
        mas: false,
        files,
      });
      const weights = aggregateRun([
        { key: 'darwin_x64', timings: t({ 'spec/a-spec.ts': 10 }) },
        { key: 'darwin_x64', timings: t({ 'spec/a-spec.ts': 14, 'spec/b-spec.ts': 1 }) },
        { key: 'darwin_arm64', timings: t({ 'spec/a-spec.ts': 6 }) },
        { key: 'linux_x64_asan', timings: t({ 'spec/a-spec.ts': 40 }) },
      ]);
      expect(weights).toEqual({
        darwin_x64: { 'spec/a-spec.ts': 14, 'spec/b-spec.ts': 1 },
        darwin_arm64: { 'spec/a-spec.ts': 6 },
        linux_x64_asan: { 'spec/a-spec.ts': 40 },
      });
    });
  });

  describe('mergeRuns()', () => {
    const files = ['spec/a-spec.ts', 'spec/b-spec.ts', 'spec/new-spec.ts'];

    it('takes the median across runs so one slow run does not stick', () => {
      const merged = mergeRuns(
        [
          { darwin_x64: { 'spec/a-spec.ts': 10, 'spec/b-spec.ts': 4.4 } },
          { darwin_x64: { 'spec/a-spec.ts': 11, 'spec/b-spec.ts': 4.6 } },
          { darwin_x64: { 'spec/a-spec.ts': 95, 'spec/b-spec.ts': 4.5 } },
        ],
        files,
      );
      expect(merged.darwin_x64).toEqual({ 'spec/a-spec.ts': 11, 'spec/b-spec.ts': 5 });
    });

    it('uses the runs that measured a file when some did not, and drops files gone from the tree', () => {
      const merged = mergeRuns(
        [
          { darwin_x64: { 'spec/a-spec.ts': 10, 'spec/gone-spec.ts': 99 } },
          { darwin_x64: { 'spec/a-spec.ts': 20, 'spec/b-spec.ts': 7 } },
        ],
        files,
      );
      expect(merged.darwin_x64).toEqual({ 'spec/a-spec.ts': 15, 'spec/b-spec.ts': 7 });
    });
  });

  describe('packShards()', () => {
    it('packs heaviest-first into the lightest shard, unknown files at the median', () => {
      const table = { a: 30, b: 20, c: 10, d: 10 };
      const shards = packShards(table, ['a', 'b', 'c', 'd', 'e'], 2);
      // e is unknown -> median of [10,10,20,30] = 20 (upper middle, as split-tests.js)
      expect(shards).toEqual([
        ['a', 'c', 'd'],
        ['b', 'e'],
      ]);
      expect(longestShard(table, table, ['a', 'b', 'c', 'd'], 2)).toBe(40);
    });
  });

  describe('assessChange()', () => {
    const files = ['spec/a-spec.ts', 'spec/b-spec.ts', 'spec/c-spec.ts'];

    it('is not material when the shards already pack within a minute of optimal', () => {
      const committed = {
        darwin_x64: { 'spec/a-spec.ts': 100, 'spec/b-spec.ts': 100, 'spec/c-spec.ts': 100 },
      };
      const fresh = {
        darwin_x64: { 'spec/a-spec.ts': 105, 'spec/b-spec.ts': 98, 'spec/c-spec.ts': 101 },
      };
      const result = assessChange(committed, fresh, files);
      expect(result.material).toBe(false);
      expect(result.changes[0]).toMatchObject({
        table: 'darwin_x64',
        shardCount: 3,
        unweighted: [],
      });
    });

    it('is material when the committed table leaves a shard over a minute too long', () => {
      // win_x64 runs 2 shards. Committed thinks a is tiny, so it pairs a with b
      // (300 + 5) against c (300); a is really 400s, so that shard runs 700s
      // where a fresh packing would put a alone and reach 600s.
      const committed = {
        win_x64: { 'spec/a-spec.ts': 5, 'spec/b-spec.ts': 300, 'spec/c-spec.ts': 300 },
      };
      const fresh = {
        win_x64: { 'spec/a-spec.ts': 400, 'spec/b-spec.ts': 300, 'spec/c-spec.ts': 300 },
      };
      const result = assessChange(committed, fresh, files);
      expect(result.material).toBe(true);
      expect(result.reasons).toContain('win_x64: longest shard 700s -> 600s');
      expect(result.reasons).toContain('win_x64: spec/a-spec.ts 5s -> 400s');
    });

    it('is material when a spec file has no committed weight or a table is new', () => {
      const committed = { darwin_x64: { 'spec/a-spec.ts': 10, 'spec/b-spec.ts': 10 } };
      const fresh = {
        darwin_x64: { 'spec/a-spec.ts': 10, 'spec/b-spec.ts': 10, 'spec/c-spec.ts': 10 },
        mas_x64: { 'spec/a-spec.ts': 10, 'spec/b-spec.ts': 10, 'spec/c-spec.ts': 10 },
        win_x64: { 'spec/a-spec.ts': 10, 'spec/b-spec.ts': 10, 'spec/c-spec.ts': 10 },
      };
      const result = assessChange(committed, fresh, files);
      // Both new jobs pack from darwin_x64 today (mas by family, win as the
      // last resort), so they inherit that table's one gap.
      expect(result.reasons).toEqual([
        'darwin_x64: 1 spec file(s) without a weight',
        'mas_x64: no committed table',
        'mas_x64: 1 spec file(s) without a weight',
        'win_x64: no committed table',
        'win_x64: 1 spec file(s) without a weight',
      ]);
    });

    it('ignores small moves on small files', () => {
      const committed = {
        win_x64: { 'spec/a-spec.ts': 4, 'spec/b-spec.ts': 100, 'spec/c-spec.ts': 100 },
      };
      const fresh = {
        win_x64: { 'spec/a-spec.ts': 12, 'spec/b-spec.ts': 100, 'spec/c-spec.ts': 100 },
      };
      expect(assessChange(committed, fresh, files).material).toBe(false);
    });
  });

  describe('serializeWeights()', () => {
    it('writes sorted tables and files with a trailing newline, like gen-spec-weights.js', () => {
      const out = serializeWeights({
        mas_x64: { 'spec/b-spec.ts': 1, 'spec/a-spec.ts': 2 },
        darwin_x64: {},
      });
      expect(out).toBe(
        '{\n  "darwin_x64": {},\n  "mas_x64": {\n    "spec/a-spec.ts": 2,\n    "spec/b-spec.ts": 1\n  }\n}\n',
      );
    });
  });
});
