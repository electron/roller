import { inflateRawSync } from 'node:zlib';

// The per-file timing tables that electron/electron's script/split-tests.js
// packs CI test shards from: seconds per spec file, one table per CI test
// job, keyed the way the job names its test_artifacts_* upload -
// `<build type>_<arch>[_<sanitizer>]` (darwin_x64, mas_arm64, linux_x64_asan,
// win_x64). Regenerating them is what script/gen-spec-weights.js does from
// one run; this module does the same from several runs so a single slow
// shard cannot skew a file for a week.

export type WeightTable = Record<string, number>;
export type Weights = Record<string, WeightTable>;

export interface SpecTimings {
  platform: string;
  arch: string;
  mas: boolean;
  sanitizer?: 'asan' | 'ubsan' | null;
  files: Record<string, number>;
}

/** A run's timing file together with the job key its artifact name carries. */
export interface JobTimings {
  key: string;
  timings: SpecTimings;
}

// test_artifacts_<key>[_x11]_<shard>: the plain and sanitizer test jobs on
// every platform. The Wayland job runs an allowlist and is left out.
const TIMING_ARTIFACT =
  /^test_artifacts_((?:darwin|mas|linux|win)_(?:x64|arm64)(?:_(?:asan|ubsan))?)(?:_x11)?_\d+$/;

/** The job key of a test_artifacts_* name, or null for artifacts that carry no usable timings. */
export const jobKeyOfArtifact = (name: string): string | null =>
  TIMING_ARTIFACT.exec(name)?.[1] ?? null;

/**
 * How many shards a job splits its specs into in CI (the matrix in
 * pipeline-electron-build-and-test.yml): Linux and macOS x64 run 3, macOS
 * UBSan 3, everything else 2.
 */
export function shardCountOf(key: string): number {
  const [buildType, arch, sanitizer] = key.split('_');
  if (buildType === 'linux') return 3;
  if (
    (buildType === 'darwin' || buildType === 'mas') &&
    (arch === 'x64' || sanitizer === 'ubsan')
  ) {
    return 3;
  }
  return 2;
}

/**
 * Builds the weight tables for one CI run from that run's timing files, one
 * table per job, taking the largest time seen where several shards of a job
 * cover a file - what script/gen-spec-weights.js does.
 */
export function aggregateRun(jobs: JobTimings[]): Weights {
  const weights: Weights = {};
  for (const { key, timings } of jobs) {
    const table = (weights[key] ??= {});
    for (const [spec, seconds] of Object.entries(timings.files)) {
      table[spec] = Math.max(table[spec] ?? 0, seconds);
    }
  }
  return weights;
}

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/**
 * Merges the per-run tables of several runs: the median across runs of each
 * file's time, rounded to whole seconds, restricted to the spec files that
 * exist on the branch today. A file measured in only some runs uses the runs
 * that have it; a file no run measured gets no entry (split-tests.js then
 * gives it the median weight of the known files).
 */
export function mergeRuns(runs: Weights[], specFiles: string[]): Weights {
  const merged: Weights = {};
  const tables = new Set(runs.flatMap((r) => Object.keys(r)));
  for (const table of [...tables].sort()) {
    const out: WeightTable = {};
    for (const spec of [...specFiles].sort()) {
      const seen = runs.map((r) => r[table]?.[spec]).filter((s) => s !== undefined);
      if (seen.length) out[spec] = Math.round(median(seen));
    }
    merged[table] = out;
  }
  return merged;
}

export function serializeWeights(weights: Weights): string {
  const sorted: Weights = {};
  for (const table of Object.keys(weights).sort()) {
    sorted[table] = Object.fromEntries(
      Object.entries(weights[table]).sort(([a], [b]) => a.localeCompare(b)),
    );
  }
  return JSON.stringify(sorted, null, 2) + '\n';
}

/**
 * Packs `specFiles` into `shardCount` shards exactly as split-tests.js does:
 * heaviest first into the currently lightest shard, unknown files at the
 * median of the known ones. Returns the files of each shard.
 */
export function packShards(
  table: WeightTable,
  specFiles: string[],
  shardCount: number,
): string[][] {
  const known = specFiles.filter((f) => table[f] !== undefined).map((f) => table[f]);
  const fallback = known.length
    ? [...known].sort((a, b) => a - b)[Math.floor(known.length / 2)]
    : 0;
  const weightOf = (f: string) => table[f] ?? fallback;
  const buckets = Array.from({ length: shardCount }, () => ({ total: 0, files: [] as string[] }));
  const ordered = [...specFiles].sort((a, b) => weightOf(b) - weightOf(a) || a.localeCompare(b));
  for (const file of ordered) {
    let target = buckets[0];
    for (const bucket of buckets) if (bucket.total < target.total) target = bucket;
    target.files.push(file);
    target.total += weightOf(file);
  }
  return buckets.map((b) => b.files);
}

/** Seconds the longest shard would take, packed by `packedBy`, timed by `actual`. */
export function longestShard(
  packedBy: WeightTable,
  actual: WeightTable,
  specFiles: string[],
  shardCount: number,
): number {
  return Math.max(
    ...packShards(packedBy, specFiles, shardCount).map((files) =>
      files.reduce((sum, f) => sum + (actual[f] ?? 0), 0),
    ),
  );
}

// Mirrors pickTable() in electron/electron's script/split-tests.js: the table
// CI actually packs a job from when the file has no table under its own key -
// the nearest of the same build type (MAS falls back to darwin), same arch
// first, then the plainest; else a legacy per-platform table; else anything.
export function pickTable(all: Weights, key: string): WeightTable {
  if (all[key]) return all[key];
  const [buildType, arch] = key.split('_');
  const family = buildType === 'mas' ? ['mas', 'darwin'] : [buildType];
  for (const type of family) {
    const nearest = Object.keys(all)
      .filter((k) => k.startsWith(`${type}_`))
      .sort(
        (a, b) =>
          (a.split('_')[1] === arch ? 0 : 1) - (b.split('_')[1] === arch ? 0 : 1) ||
          a.split('_').length - b.split('_').length ||
          a.localeCompare(b),
      )[0];
    if (nearest) return all[nearest];
  }
  const legacy = { darwin: 'darwin', mas: 'darwin', linux: 'linux', win: 'win32' }[buildType];
  return all[legacy] ?? all.darwin_x64 ?? all.darwin ?? Object.values(all)[0] ?? {};
}

export interface TableChange {
  table: string;
  shardCount: number;
  /** Longest shard in seconds if CI keeps packing with the committed table. */
  before: number;
  /** Longest shard in seconds packed with the fresh table. */
  after: number;
  /** Spec files on the branch with no committed weight. */
  unweighted: string[];
  /** Files whose weight moved by at least 25% and 30 seconds. */
  moved: { spec: string; from: number; to: number }[];
}

export interface Materiality {
  material: boolean;
  reasons: string[];
  changes: TableChange[];
}

// Thresholds below which a refresh is not worth a PR: the longest shard of
// some platform must get at least a minute shorter, or a spec file must be
// missing from the table, or a file's weight must have moved substantially.
const MIN_SHARD_GAIN_SECONDS = 60;
const MOVED_RATIO = 0.25;
const MOVED_SECONDS = 30;

/**
 * Decides whether `fresh` is different enough from `committed` to be worth a
 * PR, treating `fresh` as the truth about how long files take today.
 */
export function assessChange(committed: Weights, fresh: Weights, specFiles: string[]): Materiality {
  const reasons: string[] = [];
  const changes: TableChange[] = [];
  for (const table of Object.keys(fresh).sort()) {
    const shardCount = shardCountOf(table);
    const actual = fresh[table];
    const old = pickTable(committed, table);
    const before = longestShard(old, actual, specFiles, shardCount);
    const after = longestShard(actual, actual, specFiles, shardCount);
    const unweighted = specFiles.filter((f) => old[f] === undefined);
    const moved = specFiles
      .filter((f) => old[f] !== undefined && actual[f] !== undefined)
      .map((f) => ({ spec: f, from: old[f], to: actual[f] }))
      .filter(
        ({ from, to }) =>
          Math.abs(to - from) >= MOVED_SECONDS &&
          Math.abs(to - from) >= MOVED_RATIO * Math.max(from, 1),
      );
    changes.push({ table, shardCount, before, after, unweighted, moved });

    if (!committed[table]) reasons.push(`${table}: no committed table`);
    if (before - after >= MIN_SHARD_GAIN_SECONDS) {
      reasons.push(`${table}: longest shard ${Math.round(before)}s -> ${Math.round(after)}s`);
    }
    if (unweighted.length) {
      reasons.push(`${table}: ${unweighted.length} spec file(s) without a weight`);
    }
    for (const { spec, from, to } of moved) reasons.push(`${table}: ${spec} ${from}s -> ${to}s`);
  }
  return { material: reasons.length > 0, reasons, changes };
}

/**
 * Reads every spec-timings.json out of a test_artifacts_* zip. Artifact zips
 * from actions/upload-artifact carry sizes in the central directory, so the
 * entries are located from there rather than from the local headers.
 */
export function timingsFromArtifactZip(zip: Buffer): SpecTimings[] {
  const found: SpecTimings[] = [];
  const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error('not a zip file: no end-of-central-directory record');
  const entries = zip.readUInt16LE(eocd + 10);
  let offset = zip.readUInt32LE(eocd + 16);
  for (let i = 0; i < entries; i++) {
    if (zip.readUInt32LE(offset) !== 0x02014b50) throw new Error('corrupt zip central directory');
    const method = zip.readUInt16LE(offset + 10);
    const compressedSize = zip.readUInt32LE(offset + 20);
    const nameLength = zip.readUInt16LE(offset + 28);
    const extraLength = zip.readUInt16LE(offset + 30);
    const commentLength = zip.readUInt16LE(offset + 32);
    const localHeader = zip.readUInt32LE(offset + 42);
    const name = zip.toString('utf8', offset + 46, offset + 46 + nameLength);
    offset += 46 + nameLength + extraLength + commentLength;
    if (!name.endsWith('spec-timings.json')) continue;

    const localNameLength = zip.readUInt16LE(localHeader + 26);
    const localExtraLength = zip.readUInt16LE(localHeader + 28);
    const dataStart = localHeader + 30 + localNameLength + localExtraLength;
    const data = zip.subarray(dataStart, dataStart + compressedSize);
    const raw = method === 0 ? data : method === 8 ? inflateRawSync(data) : null;
    if (!raw) throw new Error(`unsupported zip compression method ${method} for ${name}`);
    found.push(JSON.parse(raw.toString('utf8')));
  }
  return found;
}
