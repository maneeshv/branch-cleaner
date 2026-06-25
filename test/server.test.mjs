import { execFile } from "node:child_process";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";

import { startServer } from "../src/server.mjs";

const execFileAsync = promisify(execFile);

const cleanups = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

describe("server mutation protection", () => {
  it("prevents the UI from being embedded in another page", async () => {
    const repoPath = await createRepo();
    const server = await startServer({ baseBranch: "main", repoPath });
    cleanups.push(() => server.close());

    const response = await fetch(server.url);

    assert.equal(
      response.headers.get("content-security-policy"),
      "frame-ancestors 'none'",
    );
    assert.equal(response.headers.get("x-frame-options"), "DENY");
  });

  it("returns and labels each branch last committed time", async () => {
    const repoPath = await createRepo();
    const server = await startServer({ baseBranch: "main", repoPath });
    cleanups.push(() => server.close());

    const htmlResponse = await fetch(server.url);
    const html = await htmlResponse.text();
    const apiResponse = await fetch(`${server.url}/api/branches`);
    const body = await apiResponse.json();
    const deleteBranch = body.branches.find(
      (branch) => branch.name === "feature/delete-me",
    );

    assert.match(html, />Last committed</);
    assert.equal(apiResponse.status, 200);
    assert.match(deleteBranch.lastCommittedAt, /^\d{4}-\d{2}-\d{2}T/);
  });

  it("rejects branch deletion without the server token", async () => {
    const repoPath = await createRepo();
    const server = await startServer({ baseBranch: "main", repoPath });
    cleanups.push(() => server.close());

    const response = await fetch(`${server.url}/api/delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ branches: ["feature/delete-me"], force: false }),
    });
    const body = await response.json();

    assert.equal(response.status, 403);
    assert.match(body.error, /Invalid request token/);
    assert.equal(await branchExists(repoPath, "feature/delete-me"), true);
  });

  it("allows branch deletion with the server token", async () => {
    const repoPath = await createRepo();
    const server = await startServer({ baseBranch: "main", repoPath });
    cleanups.push(() => server.close());

    const response = await fetch(`${server.url}/api/delete`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Branch-Cleaner-Token": server.token,
      },
      body: JSON.stringify({ branches: ["feature/delete-me"], force: false }),
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body.deleted, [
      {
        branch: "feature/delete-me",
        command: "git branch -d -- feature/delete-me",
      },
    ]);
    assert.equal(await branchExists(repoPath, "feature/delete-me"), false);
  });

  it("returns an SSH passphrase prompt for refresh from remote", async () => {
    const repoPath = await createRepo();
    const binDir = await createFakeGit(`
#!/bin/sh
"$SSH_ASKPASS" "Enter passphrase for key '/tmp/test_key':" >/dev/null
exit 1
`);
    const server = await startServer({
      baseBranch: "main",
      fetchOptions: { env: { PATH: `${binDir}:${process.env.PATH}` } },
      repoPath,
    });
    cleanups.push(() => server.close());

    const response = await fetch(`${server.url}/api/fetch`, {
      method: "POST",
      headers: { "X-Branch-Cleaner-Token": server.token },
    });
    const body = await response.json();

    assert.equal(response.status, 401);
    assert.equal(body.code, "SSH_PASSPHRASE_REQUIRED");
    assert.equal(body.prompt, "Enter passphrase for key '/tmp/test_key':");
  });

  it("accepts an SSH passphrase for refresh from remote", async () => {
    const repoPath = await createRepo();
    const binDir = await createFakeGit(`
#!/bin/sh
passphrase="$("$SSH_ASKPASS" "Enter passphrase for key '/tmp/test_key':")"
if [ "$passphrase" = "secret" ]; then
  exit 0
fi
echo "bad passphrase" >&2
exit 1
`);
    const server = await startServer({
      baseBranch: "main",
      fetchOptions: { env: { PATH: `${binDir}:${process.env.PATH}` } },
      repoPath,
    });
    cleanups.push(() => server.close());

    const response = await fetch(`${server.url}/api/fetch`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Branch-Cleaner-Token": server.token,
      },
      body: JSON.stringify({ passphrase: "secret" }),
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body, { ok: true });
  });

  it("rejects oversized JSON mutation bodies", async () => {
    const repoPath = await createRepo();
    const server = await startServer({ baseBranch: "main", repoPath });
    cleanups.push(() => server.close());

    const response = await fetch(`${server.url}/api/delete`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Branch-Cleaner-Token": server.token,
      },
      body: JSON.stringify({ branches: [], padding: "x".repeat(70 * 1024) }),
    });
    const body = await response.json();

    assert.equal(response.status, 413);
    assert.match(body.error, /Request body too large/);
  });
});

async function createRepo() {
  const repoPath = await mkdtemp(join(tmpdir(), "branch-cleaner-test-"));
  cleanups.push(() => rm(repoPath, { force: true, recursive: true }));

  await git(repoPath, ["init", "-b", "main"]);
  await git(repoPath, ["config", "user.name", "Branch Cleaner Test"]);
  await git(repoPath, ["config", "user.email", "branch-cleaner@example.invalid"]);
  await git(repoPath, ["commit", "--allow-empty", "-m", "initial"]);
  await git(repoPath, ["checkout", "-b", "feature/delete-me"]);
  await git(repoPath, ["checkout", "main"]);
  await git(repoPath, ["merge", "--no-edit", "feature/delete-me"]);

  return repoPath;
}

async function branchExists(repoPath, branchName) {
  try {
    await git(repoPath, ["rev-parse", "--verify", "--quiet", branchName]);
    return true;
  } catch {
    return false;
  }
}

async function git(repoPath, args) {
  await execFileAsync("git", args, { cwd: repoPath });
}

async function createFakeGit(script) {
  const binDir = await mkdtemp(join(tmpdir(), "branch-cleaner-git-"));
  cleanups.push(() => rm(binDir, { force: true, recursive: true }));
  const gitPath = join(binDir, "git");
  await writeFile(gitPath, script.trimStart(), "utf8");
  await chmod(gitPath, 0o755);
  return binDir;
}
