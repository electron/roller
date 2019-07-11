import * as debug from 'debug';
import { getOctokit } from './utils/octokit';

const d = debug('roller:rollNode()');

const updateDepsFile = async (branch: string, nodeVersion: string) => {
  d(`updating deps file for: ${branch}`);
  const github = await getOctokit();

  const existing = await github.repos.getContents({
    owner: 'dddpppmmm',
    repo: 'electron',
    path: 'DEPS',
    ref: branch,
  });
  const content = Buffer.from(existing.data.content, 'base64').toString('utf8');
  const [, previousVersion] = /node_version':\n +'(.+?)',/m.exec(content);

  if (nodeVersion !== previousVersion) {
    const newContent = content.replace(
      /(node_version':\n +').+?',/gm,
      `$1${nodeVersion}',`,
    );
    await github.repos.updateFile({
      owner: 'dddpppmmm',
      repo: 'electron',
      path: 'DEPS',
      content: Buffer.from(newContent).toString('base64'),
      message: `chore: bump Node.js in DEPS to ${nodeVersion}`,
      sha: existing.data.sha,
      branch,
    });
  }
  return previousVersion;
};

function prText(previousNodeVersion: string, nodeVersion: string, branchName: string) {

  const diffLink = `https://github.com/nodejs/node/compare/${previousNodeVersion}...${nodeVersion}`;
  return {
    title: `chore: bump Node.js to ${nodeVersion} (${branchName})`,
    body: `Updating Node.js to ${previousNodeVersion}.

See [all changes in ${previousNodeVersion}..${nodeVersion}](${diffLink})

<!--
Original-Node-Version: ${previousNodeVersion}
-->

Notes: ${`Updated Node.js to ${nodeVersion}.`}`,
  };
}

export async function rollNode(
  electronBranch: {name: string, commit: {sha: string}},
  nodeVersion: string,
): Promise<void> {
  d(`roll triggered for electronBranch=${electronBranch.name} nodeVersion=${nodeVersion}`);
  const github = await getOctokit();

  // Look for a pre-existing PR that targets this branch to see if we can update that.
  const existingPrsForBranch = await github.pulls.list({
    per_page: 100, // TODO: paginate
    base: electronBranch.name,
    owner: 'dddpppmmm',
    repo: 'electron',
    state: 'open',
  });

  const myPrs = existingPrsForBranch.data
    .filter((pr) => pr.user.login === 'erickzhao' && pr.title.includes('Node.js'));

  if (myPrs.length) {
    // Update the existing PR (s?)
    for (const pr of myPrs) {
      d(`found existing PR: #${pr.number}, updating`);
      const previousVersion = await updateDepsFile(pr.head.ref, nodeVersion);
      if (previousVersion === nodeVersion) {
        d(`version unchanged, skipping PR body update`);
        continue;
      }
      d(`version changed, updating PR body`);
      const m = /^Original-Node-Version: (\S+)/m.exec(pr.body);
      const previousNodeVersion = m ? m[1] : /Node\/src\/\+\/(.+?)\.\./.exec(pr.body)[1];
      await github.pulls.update({
        owner: 'dddpppmmm',
        repo: 'electron',
        pull_number: pr.number,
        ...prText(previousNodeVersion, nodeVersion, electronBranch.name),
      });
    }
  } else {
    d(`no existing PR found, raising a new PR`);
    // Create a new ref that the PR will point to
    const electronSha = electronBranch.commit.sha;
    const branchName = `roller/node/${electronBranch.name}`;
    const newRef = `refs/heads/${branchName}`;

    d(`creating ref=${newRef} at sha=${electronSha}`);

    await github.git.createRef({
      owner: 'dddpppmmm',
      repo: 'electron',
      ref: newRef,
      sha: electronSha,
    });

    // Update the ref
    d(`updating the new ref with NodeVersion=${nodeVersion}`);
    const previousNodeVersion = await updateDepsFile(branchName, nodeVersion);

    // Raise a PR
    d(`raising a PR for ${branchName} to ${electronBranch.name}`);
    const newPr = await github.pulls.create({
      owner: 'dddpppmmm',
      repo: 'electron',
      base: electronBranch.name,
      head: `dddpppmmm:${branchName}`,
      ...prText(previousNodeVersion, nodeVersion, electronBranch.name),
    });
    d(`new PR: ${newPr.data.html_url}`);
    // TODO: add comment with commit list to new PR.
  }
}
