import { Octokit } from '@octokit/rest';
import { REPOS } from '../constants';

export const addLabels = async (
  octokit: Octokit,
  data: {
    prNumber: number;
    labels: string[];
  },
) => {
  // If the PR already has the label, don't try to add it.
  const labels = data.labels.filter(async (label) => {
    const labelExists = await labelExistsOnPR(octokit, {
      prNumber: data.prNumber,
      name: label,
    });
    return !labelExists;
  });

  if (labels.length === 0) return;

  await octokit.issues.addLabels({
    owner: REPOS.electron.owner,
    repo: REPOS.electron.repo,
    issue_number: data.prNumber,
    labels,
  });
};

export const removeLabel = async (
  octokit: Octokit,
  data: {
    prNumber: number;
    name: string;
  },
) => {
  // If the issue does not have the label, don't try remove it.
  const labelExists = await labelExistsOnPR(octokit, data);
  if (labelExists) {
    await octokit.issues.removeLabel({
      owner: REPOS.electron.owner,
      repo: REPOS.electron.repo,
      issue_number: data.prNumber,
      name: data.name,
    });
  }
};

export const labelExistsOnPR = async (
  octokit: Octokit,
  data: {
    prNumber: number;
    name: string;
  },
) => {
  const { data: labelData } = await octokit.issues.listLabelsOnIssue({
    owner: REPOS.electron.owner,
    repo: REPOS.electron.repo,
    issue_number: data.prNumber,
    per_page: 100,
    page: 1,
  });

  const labels = labelData.map((l) => l.name);
  return labels.some((label) => label === data.name);
};
