import { execFile, spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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
  if (passphrase !== undefined) {
    await assertSafeInteractiveFetch(repoPath);
  }

  const secret = passphrase === undefined ? null : writePassphraseFile(passphrase);

  try {
    const child = spawn("git", args, {
      cwd: repoPath,
      env: buildInteractiveGitEnv({ env, passphraseFile: secret?.path }),
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

    // Repo-controlled git config (core.sshCommand, hooks, ...) can echo the
    // passphrase into stderr; never reflect it back to the caller/UI.
    const redact = (text) =>
      passphrase ? text.split(passphrase).join("***") : text;
    const details = redact(stderrText || signal || `exit code ${code}`);
    throw new Error(`git ${args.join(" ")} failed: ${details}`);
  } finally {
    secret?.cleanup();
  }
}

// ponytail: pass the secret via a 0600 file consumed by askpass, not a
// process-wide env var inherited by every git subprocess. Hardening, not a
// hard boundary — anyone who already controls .git/config can still read the
// path during the fetch window; Fix 1 (redaction) is what neutralizes the leak.
function writePassphraseFile(passphrase) {
  const dir = mkdtempSync(join(tmpdir(), "branch-purge-"));
  const path = join(dir, "passphrase");
  writeFileSync(path, passphrase, { mode: 0o600 });
  return {
    path,
    cleanup() {
      rmSync(dir, { force: true, recursive: true });
    },
  };
}

function buildInteractiveGitEnv({ env, passphraseFile }) {
  const nextEnv = {
    ...process.env,
    ...env,
    DISPLAY: process.env.DISPLAY || "branch-purge",
    GIT_TERMINAL_PROMPT: "0",
    SSH_ASKPASS: ASKPASS_PATH,
    SSH_ASKPASS_REQUIRE: "force",
  };

  // Never broadcast the passphrase value itself in the environment.
  delete nextEnv.BRANCH_PURGE_SSH_PASSPHRASE;
  if (passphraseFile === undefined) {
    delete nextEnv.BRANCH_PURGE_SSH_PASSPHRASE_FILE;
  } else {
    nextEnv.BRANCH_PURGE_SSH_PASSPHRASE_FILE = passphraseFile;
  }

  return nextEnv;
}

// ponytail: only gates the UI passphrase-refresh path, so a plain `fetch` is
// untouched. Blocks the leak at its source by refusing to run when repo-local
// config could execute repo-controlled commands while the passphrase is live;
// the file+redaction layers handle anything that slips past.
async function assertSafeInteractiveFetch(repoPath) {
  const sshCommand = await getGitConfig(repoPath, "core.sshCommand");
  if (sshCommand) {
    throw new Error(
      "unsafe SSH command in repo config blocks UI passphrase refresh",
    );
  }

  const remoteUrls = await getGitConfigValues(repoPath, "^remote\\..*\\.url$");
  if (remoteUrls.some(isDangerousRemoteUrl)) {
    throw new Error(
      "Unsafe remote URL in repo config blocks UI passphrase refresh",
    );
  }

  const urlRewrites = [
    ...(await getGitConfigValues(repoPath, "^url\\..*\\.insteadOf$")),
    ...(await getGitConfigValues(repoPath, "^url\\..*\\.pushInsteadOf$")),
  ];
  if (urlRewrites.length > 0) {
    throw new Error(
      "Unsafe Git URL rewrite in repo config blocks UI passphrase refresh",
    );
  }
}

async function getGitConfig(repoPath, key) {
  try {
    // --includes so the probe sees what `git fetch` sees: included config
    // files (include.path/includeIf) are honored by fetch but ignored by a
    // bare --local read, which would let an included sshCommand bypass the gate.
    return (
      await runGit(repoPath, ["config", "--local", "--includes", "--get", key])
    ).trim();
  } catch {
    return "";
  }
}

async function getGitConfigValues(repoPath, pattern) {
  try {
    const output = await runGit(repoPath, [
      "config",
      "--local",
      "--includes",
      "--get-regexp",
      pattern,
    ]);
    return output
      .split("\n")
      .filter(Boolean)
      .map((line) => line.replace(/^\S+ /, ""));
  } catch {
    return [];
  }
}

// `ext::`/`fd::` and other `<helper>::` transport forms can execute arbitrary
// commands; normal remotes (https://, ssh://, git://, user@host:path) never use
// the double-colon syntax, so this allows them without a regression.
function isDangerousRemoteUrl(url) {
  return /^[a-z][a-z0-9+.-]*::/i.test(url);
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
