import debug from 'debug';
import type { Octokit } from '@octokit/rest';

import {
  BACKPORT_CHECK_SKIP,
  MAIN_BRANCH,
  NO_BACKPORT,
  REPOS,
  ROLLER_BOT_LOGIN,
  SPEC_WEIGHTS,
} from '../constants.js';
import type { Branch, PullsListResponseItem } from '../types.js';
import { getContent } from './github-utils.js';
import { addLabels } from './label-utils.js';
import { getOctokit } from './octokit.js';
import {
  aggregateRun,
  assessChange,
  jobKeyOfArtifact,
  mergeRuns,
  serializeWeights,
  timingsFromArtifactZip,
  type JobTimings,
  type Materiality,
  type Weights,
} from './spec-weights.js';

/** Spec files the sharder would see on `ref`: spec/*-spec.ts, as split-tests.js globs them. */
export async function listSpecFiles(octokit: Octokit, ref: string): Promise<string[]> {
  const { data } = await octokit.git.getTree({
    ...REPOS.electron,
    tree_sha: `${ref}:${SPEC_WEIGHTS.specDir}`,
  });
  return data.tree
    .filter((entry) => entry.type === 'blob' && entry.path?.endsWith('-spec.ts'))
    .map((entry) => `${SPEC_WEIGHTS.specDir}/${entry.path}`)
    .sort();
}

/** The most recent successful push runs of build.yml on `branch`, newest first. */
export async function listTimingRuns(
  octokit: Octokit,
  branch: string,
  count: number,
): Promise<number[]> {
  const { data } = await octokit.actions.listWorkflowRuns({
    ...REPOS.electron,
    workflow_id: SPEC_WEIGHTS.workflowFile,
    branch,
    event: 'push',
    status: 'success',
    per_page: count,
  });
  return data.workflow_runs.map((run) => run.id);
}

/** Every spec-timings.json uploaded by the test jobs of one run, tagged with its job key. */
export async function fetchRunTimings(octokit: Octokit, runId: number): Promise<JobTimings[]> {
  const d = debug(`roller/spec-weights:fetchRunTimings(${runId})`);
  const artifacts = await octokit.paginate(octokit.actions.listWorkflowRunArtifacts, {
    ...REPOS.electron,
    run_id: runId,
    per_page: 100,
  });
  const jobs: JobTimings[] = [];
  for (const artifact of artifacts) {
    const key = jobKeyOfArtifact(artifact.name);
    if (!key || artifact.expired) continue;
    const { data } = await octokit.actions.downloadArtifact({
      ...REPOS.electron,
      artifact_id: artifact.id,
      archive_format: 'zip',
    });
    const found = timingsFromArtifactZip(Buffer.from(data as ArrayBuffer));
    d(`${artifact.name}: ${found.length} timing file(s) -> ${key}`);
    jobs.push(...found.map((timings) => ({ key, timings })));
  }
  return jobs;
}

export interface SpecWeightsRefresh {
  branch: string;
  /** The sampled runs whose timings actually went into `fresh`. */
  runIds: number[];
  committed: Weights;
  fresh: Weights;
  content: string;
  assessment: Materiality;
}

/**
 * Computes fresh weights for `branch` from its last few green push runs and
 * compares them with the table committed on the branch.
 */
export async function computeRefresh(
  octokit: Octokit,
  branch: string,
): Promise<SpecWeightsRefresh | null> {
  const d = debug(`roller/spec-weights:computeRefresh(${branch})`);

  const runIds = await listTimingRuns(octokit, branch, SPEC_WEIGHTS.runsToSample);
  if (!runIds.length) {
    d('no successful push runs found - skipping');
    return null;
  }

  // A run whose artifacts have expired, or one with a corrupt upload, drops
  // out of the median rather than failing the branch: the others still count.
  const runs: Weights[] = [];
  const usedRunIds: number[] = [];
  for (const runId of runIds) {
    let jobs: JobTimings[];
    try {
      jobs = await fetchRunTimings(octokit, runId);
    } catch (e) {
      d(`run ${runId}: could not read its timing artifacts (${e.message}) - ignoring`);
      continue;
    }
    if (!jobs.length) {
      d(`run ${runId} has no timing artifacts (expired?) - ignoring`);
      continue;
    }
    runs.push(aggregateRun(jobs));
    usedRunIds.push(runId);
  }
  if (!runs.length) {
    d('no timing data in any sampled run - skipping');
    return null;
  }

  const specFiles = await listSpecFiles(octokit, branch);
  const fresh = mergeRuns(runs, specFiles);

  const existing = await getContent(octokit, {
    ...REPOS.electron,
    path: SPEC_WEIGHTS.filePath,
    ref: branch,
  });
  let committed: Weights = {};
  if (existing) {
    try {
      committed = JSON.parse(existing.content);
    } catch (e) {
      // Treat an unparseable file as no weights at all: the refresh replaces it.
      d(`committed ${SPEC_WEIGHTS.filePath} is not valid JSON (${e.message}) - treating as empty`);
    }
  }

  return {
    branch,
    runIds: usedRunIds,
    committed,
    fresh,
    content: serializeWeights(fresh),
    assessment: assessChange(committed, fresh, specFiles),
  };
}

const minutes = (seconds: number) => (seconds / 60).toFixed(1);

export function getSpecWeightsPRText(refresh: SpecWeightsRefresh) {
  const { branch, runIds, assessment } = refresh;
  const runLinks = runIds
    .map((id) => `[${id}](https://github.com/electron/electron/actions/runs/${id})`)
    .join(', ');
  const rows = assessment.changes
    .map(
      (c) =>
        `| \`${c.table}\` | ${c.shardCount} | ${minutes(c.before)} min | ${minutes(c.after)} min | ${
          c.unweighted.length
        } |`,
    )
    .join('\n');
  const moved = assessment.changes
    .flatMap((c) => c.moved.map((m) => `- \`${c.table}\` ${m.spec}: ${m.from}s -> ${m.to}s`))
    .join('\n');
  return {
    title: `build: refresh spec weights (${branch})`,
    body: `Regenerates \`${SPEC_WEIGHTS.filePath}\` from the timings uploaded by the last ${
      runIds.length
    } green push run(s) on \`${branch}\`: ${runLinks}. Each file's weight is the median across those runs; the tables drive how \`script/split-tests.js\` packs the CI test shards.

Longest test shard, timed with the fresh measurements, packed by the committed weights versus these:

| job | shards | committed | refreshed | unweighted files |
| --- | --- | --- | --- | --- |
${rows}
${moved ? `\nFiles that moved by 25% or more:\n${moved}\n` : ''}
Notes: none`,
  };
}

/**
 * Opens or updates the roller's spec-weights PR on `electronBranch`. Returns
 * true when a PR was created or its content changed.
 */
export async function rollSpecWeights(
  electronBranch: Branch,
  refresh: SpecWeightsRefresh,
): Promise<boolean> {
  const d = debug(`roller/spec-weights:rollSpecWeights(${electronBranch.name})`);
  const octokit = await getOctokit();

  const rollBranchName = `roller/spec-weights/${electronBranch.name}`;
  const shortRef = `heads/${rollBranchName}`;
  const ref = `refs/${shortRef}`;
  const electronRepoFullName = `${REPOS.electron.owner}/${REPOS.electron.repo}`;
  const prText = getSpecWeightsPRText(refresh);
  const commitMessage = `build: refresh spec weights from CI timings\n\nMedian of push runs ${refresh.runIds.join(
    ', ',
  )} on ${electronBranch.name}.`;

  const existingPrsForBranch = (await octokit.paginate('GET /repos/:owner/:repo/pulls', {
    ...REPOS.electron,
    base: electronBranch.name,
    state: 'open',
  })) as PullsListResponseItem[];

  // Only ever write to the bot's own PR: authored by the roller, head in the
  // electron/electron repo itself, named exactly as the bot names it. Any open
  // PR can share the title prefix, and a fork PR's fields are attacker-controlled.
  const prs = existingPrsForBranch.filter(
    (pr) =>
      pr.title.startsWith('build: refresh spec weights') &&
      pr.user?.login === ROLLER_BOT_LOGIN &&
      pr.head.repo?.full_name === electronRepoFullName &&
      pr.head.ref === rollBranchName,
  );

  if (prs.length) {
    let changed = false;
    for (const pr of prs) {
      d(`Found existing PR #${pr.number}`);
      if (pr.labels.some((label) => label.name === 'roller/pause')) {
        d(`Automatic updates have been paused for #${pr.number}, skipping.`);
        continue;
      }
      const current = await getContent(octokit, {
        ...REPOS.electron,
        path: SPEC_WEIGHTS.filePath,
        ref: rollBranchName,
      });
      if (current?.content === refresh.content) {
        d('PR already carries these weights');
        continue;
      }
      await octokit.repos.createOrUpdateFileContents({
        ...REPOS.electron,
        path: SPEC_WEIGHTS.filePath,
        message: commitMessage,
        content: Buffer.from(refresh.content).toString('base64'),
        branch: rollBranchName,
        sha: current?.sha,
      });
      await octokit.pulls.update({ ...REPOS.electron, pull_number: pr.number, ...prText });
      changed = true;
    }
    return changed;
  }

  d(`No existing PR - creating ${ref} at ${electronBranch.commit.sha}`);
  try {
    await octokit.git.getRef({ ...REPOS.electron, ref: shortRef });
    d(`Found orphan ref ${ref} with no open PR - deleting`);
    await octokit.git.deleteRef({ ...REPOS.electron, ref: shortRef });
    // Ref deletion is eventually consistent; recreating it at once can fail.
    await new Promise<void>((r) => setTimeout(r, 2000));
  } catch {
    // No orphan ref.
  }
  await octokit.git.createRef({ ...REPOS.electron, ref, sha: electronBranch.commit.sha });

  const current = await getContent(octokit, {
    ...REPOS.electron,
    path: SPEC_WEIGHTS.filePath,
    ref: rollBranchName,
  });
  await octokit.repos.createOrUpdateFileContents({
    ...REPOS.electron,
    path: SPEC_WEIGHTS.filePath,
    message: commitMessage,
    content: Buffer.from(refresh.content).toString('base64'),
    branch: rollBranchName,
    sha: current?.sha,
  });

  const { data: pr } = await octokit.pulls.create({
    ...REPOS.electron,
    base: electronBranch.name,
    head: `${REPOS.electron.owner}:${rollBranchName}`,
    ...prText,
  });
  // Weights are measured per branch, so a refresh is never backported.
  await addLabels(octokit, {
    prNumber: pr.number,
    labels: [
      'semver/none',
      electronBranch.name === MAIN_BRANCH ? NO_BACKPORT : BACKPORT_CHECK_SKIP,
    ],
  });
  d(`New PR: ${pr.html_url}`);
  return true;
}
