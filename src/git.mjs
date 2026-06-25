import { execFile, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

import {
  classifyBranches,
  parseBranchLines,
  parseRemoteLines,
  selectDeleteCommand,
} from "./branch-data.mjs";

const execFileAsync = promisify(execFile);
const ASKPASS_PROMPT_PREFIX = "BRANCH_PURGE_ASKPASS_PROMPT:";
const ASKPASS_PATH = join(dirname(fileURLToPath(import.meta.url)), "askpass.mjs");

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

export async function fetchPrune(repoPath, options = {}) {
  if (options.interactive) {
    await runInteractiveGit(repoPath, ["fetch", "--prune"], options);
    return;
  }

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

export class GitPassphraseRequiredError extends Error {
  constructor(prompt) {
    super("SSH key passphrase required");
    this.code = "SSH_PASSPHRASE_REQUIRED";
    this.prompt = prompt;
    this.statusCode = 401;
  }
}

async function runInteractiveGit(repoPath, args, { env = {}, passphrase } = {}) {
  const child = spawn("git", args, {
    cwd: repoPath,
    env: buildInteractiveGitEnv({ env, passphrase }),
    stdio: ["ignore", "pipe", "pipe"],
  });

  const stdout = [];
  const stderr = [];

  child.stdout.on("data", (chunk) => stdout.push(chunk));
  child.stderr.on("data", (chunk) => stderr.push(chunk));

  const { code, signal } = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (closedCode, closedSignal) => {
      resolve({ code: closedCode, signal: closedSignal });
    });
  });

  const stdoutText = Buffer.concat(stdout).toString("utf8").trimEnd();
  const stderrText = Buffer.concat(stderr).toString("utf8").trim();
  if (code === 0) {
    return stdoutText;
  }

  const prompt = extractAskpassPrompt(stderrText);
  if (prompt && passphrase === undefined) {
    throw new GitPassphraseRequiredError(prompt);
  }

  const details = stderrText || signal || `exit code ${code}`;
  throw new Error(`git ${args.join(" ")} failed: ${details}`);
}

function buildInteractiveGitEnv({ env, passphrase }) {
  const nextEnv = {
    ...process.env,
    ...env,
    DISPLAY: process.env.DISPLAY || "branch-purge",
    GIT_TERMINAL_PROMPT: "0",
    SSH_ASKPASS: ASKPASS_PATH,
    SSH_ASKPASS_REQUIRE: "force",
  };

  if (passphrase === undefined) {
    delete nextEnv.BRANCH_PURGE_SSH_PASSPHRASE;
  } else {
    nextEnv.BRANCH_PURGE_SSH_PASSPHRASE = passphrase;
  }

  return nextEnv;
}

function extractAskpassPrompt(stderrText) {
  const line = stderrText
    .split(/\r?\n/)
    .find((entry) => entry.startsWith(ASKPASS_PROMPT_PREFIX));
  if (!line) return "";

  const encodedPrompt = line.slice(ASKPASS_PROMPT_PREFIX.length);
  try {
    return Buffer.from(encodedPrompt, "base64").toString("utf8");
  } catch {
    return "";
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
