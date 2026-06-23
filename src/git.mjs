import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  classifyBranches,
  parseBranchLines,
  parseRemoteLines,
  selectDeleteCommand,
} from "./branch-data.mjs";

const execFileAsync = promisify(execFile);

export async function getRepoRoot(repoPath) {
  const output = await runGit(repoPath, ["rev-parse", "--show-toplevel"]);
  return output.trim();
}

export async function getDefaultBaseBranch(repoPath) {
  const candidates = ["dev", "main", "master"];

  for (const candidate of candidates) {
    const exists = await gitSucceeds(repoPath, [
      "rev-parse",
      "--verify",
      "--quiet",
      candidate,
    ]);
    if (exists) {
      return candidate;
    }
  }

  const current = await runGit(repoPath, ["branch", "--show-current"]);
  return current.trim();
}

export async function loadBranches({ baseBranch, repoPath }) {
  const [localOutput, remoteOutput, mergedOutput, currentOutput] =
    await Promise.all([
      runGit(repoPath, [
        "for-each-ref",
        "--format=%(refname:short)%00%(upstream:short)%00%(objectname:short)%00%(authordate:iso-strict)",
        "refs/heads",
      ]),
      runGit(repoPath, [
        "for-each-ref",
        "--format=%(refname:short)",
        "refs/remotes",
      ]),
      runGit(repoPath, [
        "for-each-ref",
        "--format=%(refname:short)",
        "refs/heads",
        "--merged",
        baseBranch,
      ]),
      runGit(repoPath, ["branch", "--show-current"]),
    ]);

  return classifyBranches({
    baseBranch,
    currentBranch: currentOutput.trim(),
    locals: parseBranchLines(localOutput),
    mergedBranches: new Set(mergedOutput.split("\n").filter(Boolean)),
    remotes: parseRemoteLines(remoteOutput),
  });
}

export async function fetchPrune(repoPath) {
  await runGit(repoPath, ["fetch", "--prune"]);
}

export async function deleteBranches({ branches, force, repoPath, rows }) {
  const rowByName = new Map(rows.map((row) => [row.name, row]));
  const results = [];

  for (const branchName of branches) {
    const branch = rowByName.get(branchName);
    if (!branch) {
      throw new Error(`Unknown local branch: ${branchName}`);
    }

    const args = selectDeleteCommand({ branch, force });
    await runGit(repoPath, args);
    results.push({ branch: branchName, command: `git ${args.join(" ")}` });
  }

  return results;
}

export async function runGit(repoPath, args) {
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd: repoPath,
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    });
    return stdout.trimEnd();
  } catch (error) {
    const stderr = error.stderr ? String(error.stderr).trim() : "";
    const message = stderr || error.message;
    throw new Error(`git ${args.join(" ")} failed: ${message}`);
  }
}

async function gitSucceeds(repoPath, args) {
  try {
    await runGit(repoPath, args);
    return true;
  } catch {
    return false;
  }
}
