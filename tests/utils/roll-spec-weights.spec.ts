import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getOctokit } from '../../src/utils/octokit.js';
import {
  computeRefresh,
  getSpecWeightsPRText,
  rollSpecWeights,
  type SpecWeightsRefresh,
} from '../../src/utils/roll-spec-weights.js';
import { BACKPORT_CHECK_SKIP, NO_BACKPORT, ROLLER_BOT_LOGIN } from '../../src/constants.js';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const fixtureZip = readFileSync(
  join(
    dirname(fileURLToPath(import.meta.url)),
    '../fixtures/spec-weights/test_artifacts_darwin_x64_1.zip',
  ),
);

vi.mock('../../src/utils/octokit.js');

const refresh: SpecWeightsRefresh = {
  branch: '45-x-y',
  runIds: [1, 2, 3],
  committed: { darwin: { 'spec/a-spec.ts': 5 } },
  fresh: { darwin: { 'spec/a-spec.ts': 400 } },
  content: '{\n  "darwin": {\n    "spec/a-spec.ts": 400\n  }\n}\n',
  assessment: {
    material: true,
    reasons: ['darwin: longest shard 700s -> 600s'],
    changes: [
      {
        table: 'darwin',
        shardCount: 3,
        before: 700,
        after: 600,
        unweighted: [],
        moved: [{ spec: 'spec/a-spec.ts', from: 5, to: 400 }],
      },
    ],
  },
};
const branch = { name: '45-x-y', commit: { sha: 'abc123' } };
const encoded = (s: string) => ({
  data: { content: Buffer.from(s).toString('base64'), sha: 'f1' },
});

describe('rollSpecWeights()', () => {
  let mockOctokit: any;

  beforeEach(() => {
    mockOctokit = {
      paginate: vi.fn().mockResolvedValue([]),
      pulls: {
        update: vi.fn(),
        create: vi.fn().mockResolvedValue({ data: { number: 7, html_url: 'https://x' } }),
      },
      git: {
        getRef: vi.fn().mockRejectedValue({ status: 404 }),
        deleteRef: vi.fn(),
        createRef: vi.fn(),
      },
      repos: {
        getContent: vi.fn().mockResolvedValue(encoded('{}')),
        createOrUpdateFileContents: vi.fn(),
      },
      issues: { addLabels: vi.fn(), listLabelsOnIssue: vi.fn().mockResolvedValue({ data: [] }) },
    };
    vi.mocked(getOctokit).mockResolvedValue(mockOctokit);
  });

  it('creates a roll branch, commits the weights, and opens a labelled PR', async () => {
    expect(await rollSpecWeights(branch, refresh)).toBe(true);

    expect(mockOctokit.git.createRef).toHaveBeenCalledWith(
      expect.objectContaining({ ref: 'refs/heads/roller/spec-weights/45-x-y', sha: 'abc123' }),
    );
    expect(mockOctokit.repos.createOrUpdateFileContents).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'script/spec-weights.json',
        branch: 'roller/spec-weights/45-x-y',
        content: Buffer.from(refresh.content).toString('base64'),
      }),
    );
    expect(mockOctokit.pulls.create).toHaveBeenCalledWith(
      expect.objectContaining({
        base: '45-x-y',
        head: 'electron:roller/spec-weights/45-x-y',
        title: 'build: refresh spec weights (45-x-y)',
      }),
    );
    expect(mockOctokit.issues.addLabels).toHaveBeenCalledWith(
      expect.objectContaining({ issue_number: 7, labels: ['semver/none', BACKPORT_CHECK_SKIP] }),
    );
  });

  it('labels a main refresh no-backport', async () => {
    await rollSpecWeights({ name: 'main', commit: { sha: 'm' } }, { ...refresh, branch: 'main' });
    expect(mockOctokit.issues.addLabels).toHaveBeenCalledWith(
      expect.objectContaining({ labels: ['semver/none', NO_BACKPORT] }),
    );
  });

  const ownPr = (overrides = {}) => ({
    number: 9,
    title: 'build: refresh spec weights (45-x-y)',
    user: { login: ROLLER_BOT_LOGIN },
    head: { repo: { full_name: 'electron/electron' }, ref: 'roller/spec-weights/45-x-y' },
    labels: [],
    ...overrides,
  });

  it('updates its own open PR instead of opening another', async () => {
    mockOctokit.paginate.mockResolvedValue([ownPr()]);
    mockOctokit.repos.getContent.mockResolvedValue(encoded('{"darwin":{}}'));

    expect(await rollSpecWeights(branch, refresh)).toBe(true);
    expect(mockOctokit.pulls.create).not.toHaveBeenCalled();
    expect(mockOctokit.git.createRef).not.toHaveBeenCalled();
    expect(mockOctokit.repos.createOrUpdateFileContents).toHaveBeenCalledWith(
      expect.objectContaining({ branch: 'roller/spec-weights/45-x-y', sha: 'f1' }),
    );
    expect(mockOctokit.pulls.update).toHaveBeenCalledWith(
      expect.objectContaining({ pull_number: 9 }),
    );
  });

  it('leaves an open PR alone when it already carries these weights', async () => {
    mockOctokit.paginate.mockResolvedValue([ownPr()]);
    mockOctokit.repos.getContent.mockResolvedValue(encoded(refresh.content));

    expect(await rollSpecWeights(branch, refresh)).toBe(false);
    expect(mockOctokit.repos.createOrUpdateFileContents).not.toHaveBeenCalled();
  });

  it('respects roller/pause', async () => {
    mockOctokit.paginate.mockResolvedValue([ownPr({ labels: [{ name: 'roller/pause' }] })]);
    expect(await rollSpecWeights(branch, refresh)).toBe(false);
    expect(mockOctokit.repos.createOrUpdateFileContents).not.toHaveBeenCalled();
  });

  it('never writes to a PR it did not author, even with the right title and branch name', async () => {
    mockOctokit.paginate.mockResolvedValue([
      ownPr({ user: { login: 'someone-else' } }),
      ownPr({ head: { repo: { full_name: 'fork/electron' }, ref: 'roller/spec-weights/45-x-y' } }),
    ]);
    await rollSpecWeights(branch, refresh);
    // Neither matched, so it fell through to creating its own PR.
    expect(mockOctokit.pulls.update).not.toHaveBeenCalled();
    expect(mockOctokit.pulls.create).toHaveBeenCalledTimes(1);
  });
});

describe('getSpecWeightsPRText()', () => {
  it('links the sampled runs, tabulates the shard change, and ends with a Notes line', () => {
    const { title, body } = getSpecWeightsPRText(refresh);
    expect(title).toBe('build: refresh spec weights (45-x-y)');
    expect(body).toContain('[1](https://github.com/electron/electron/actions/runs/1)');
    expect(body).toContain('| `darwin` | 3 | 11.7 min | 10.0 min | 0 |');
    expect(body).toContain('`darwin` spec/a-spec.ts: 5s -> 400s');
    expect(body.trim().endsWith('Notes: none')).toBe(true);
  });
});

describe('computeRefresh()', () => {
  it('drops a run whose artifacts are unreadable or gone and reports only the runs it used', async () => {
    const zipOf = (id: number) => (id === 2 ? Buffer.from('not a zip') : fixtureZip);
    const octokit: any = {
      actions: {
        listWorkflowRuns: vi
          .fn()
          .mockResolvedValue({ data: { workflow_runs: [{ id: 1 }, { id: 2 }, { id: 3 }] } }),
        listWorkflowRunArtifacts: vi.fn(),
        downloadArtifact: vi
          .fn()
          .mockImplementation(({ artifact_id }) => ({ data: zipOf(artifact_id) })),
      },
      paginate: vi
        .fn()
        .mockImplementation((_fn, { run_id }) =>
          run_id === 3 ? [] : [{ id: run_id, name: 'test_artifacts_darwin_x64_1', expired: false }],
        ),
      git: {
        getTree: vi.fn().mockResolvedValue({
          data: { tree: [{ type: 'blob', path: 'api-browser-window-spec.ts' }] },
        }),
      },
      // The committed file is unparseable here too; that must not fail the branch.
      repos: {
        getContent: vi
          .fn()
          .mockResolvedValue({ data: { content: Buffer.from('{').toString('base64'), sha: 's' } }),
      },
    };

    const refresh = await computeRefresh(octokit, 'main');
    expect(refresh?.runIds).toEqual([1]);
    expect(refresh?.committed).toEqual({});
    expect(refresh?.fresh.darwin_x64['spec/api-browser-window-spec.ts']).toBe(365);
  });
});
