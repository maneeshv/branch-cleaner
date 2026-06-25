import { execFile } from "node:child_process";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";

import { fetchPrune, GitPassphraseRequiredError } from "../src/git.mjs";

const execFileAsync = promisify(execFile);
const cleanups = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

describe("interactive git fetch", () => {
  it("leaves the default fetch path on the normal git environment", async () => {
    const binDir = await createFakeGit(`
#!/bin/sh
if [ -n "$SSH_ASKPASS" ]; then
  echo "unexpected askpass" >&2
  exit 1
fi
exit 0
`);
    const originalPath = process.env.PATH;
    const originalAskpass = process.env.SSH_ASKPASS;
    process.env.PATH = `${binDir}:${originalPath}`;
    delete process.env.SSH_ASKPASS;

    try {
      await fetchPrune(process.cwd());
    } finally {
      process.env.PATH = originalPath;
      if (originalAskpass === undefined) {
        delete process.env.SSH_ASKPASS;
      } else {
        process.env.SSH_ASKPASS = originalAskpass;
      }
    }
  });

  it("reports an SSH passphrase prompt instead of hanging on terminal input", async () => {
    const binDir = await createFakeGit(`
#!/bin/sh
"$SSH_ASKPASS" "Enter passphrase for key '/tmp/test_key':" >/dev/null
exit 1
`);

    await assert.rejects(
      () =>
        fetchPrune(process.cwd(), {
          env: { PATH: `${binDir}:${process.env.PATH}` },
          interactive: true,
        }),
      (error) => {
        assert.ok(error instanceof GitPassphraseRequiredError);
        assert.equal(error.prompt, "Enter passphrase for key '/tmp/test_key':");
        return true;
      },
    );
  });

  it("passes the provided SSH passphrase through askpass for retry", async () => {
    const binDir = await createFakeGit(`
#!/bin/sh
passphrase="$("$SSH_ASKPASS" "Enter passphrase for key '/tmp/test_key':")"
if [ "$passphrase" = "secret" ]; then
  echo "fetched"
  exit 0
fi
echo "bad passphrase" >&2
exit 1
`);

    await fetchPrune(process.cwd(), {
      env: { PATH: `${binDir}:${process.env.PATH}` },
      interactive: true,
      passphrase: "secret",
    });
  });

  it("redacts the passphrase from errors surfaced to the caller", async () => {
    // Simulates repo-controlled git config that echoes the passphrase to stderr.
    const binDir = await createFakeGit(`
#!/bin/sh
secret="$("$SSH_ASKPASS" "Enter passphrase for key '/tmp/test_key':")"
echo "LEAK:$secret" >&2
exit 1
`);

    await assert.rejects(
      () =>
        fetchPrune(process.cwd(), {
          env: { PATH: `${binDir}:${process.env.PATH}` },
          interactive: true,
          passphrase: "secret-proof",
        }),
      (error) => {
        assert.ok(error.message.includes("LEAK:***"));
        assert.ok(!error.message.includes("secret-proof"));
        return true;
      },
    );
  });

  it("blocks the passphrase refresh when repo config sets core.sshCommand", async () => {
    const repoPath = await createRepo();
    await git(repoPath, ["remote", "add", "origin", "git@example.invalid:repo.git"]);
    await git(repoPath, [
      "config",
      "core.sshCommand",
      "sh -c 'echo LEAK:$BRANCH_PURGE_SSH_PASSPHRASE >&2; exit 1'",
    ]);

    await assert.rejects(
      () =>
        fetchPrune(repoPath, {
          interactive: true,
          passphrase: "secret-proof",
        }),
      (error) => {
        assert.match(error.message, /unsafe SSH command/i);
        assert.doesNotMatch(error.message, /secret-proof/);
        return true;
      },
    );
  });

  it("blocks the passphrase refresh when an included config sets core.sshCommand", async () => {
    const repoPath = await createRepo();
    await git(repoPath, ["remote", "add", "origin", "git@example.invalid:repo.git"]);
    // git fetch honors include.path; a bare --local probe would miss this.
    const includedPath = join(repoPath, "evil.config");
    await writeFile(
      includedPath,
      "[core]\n\tsshCommand = sh -c 'echo LEAK:$BRANCH_PURGE_SSH_PASSPHRASE >&2; exit 1'\n",
    );
    await git(repoPath, ["config", "include.path", includedPath]);

    await assert.rejects(
      () =>
        fetchPrune(repoPath, {
          interactive: true,
          passphrase: "secret-proof",
        }),
      (error) => {
        assert.match(error.message, /unsafe SSH command/i);
        assert.doesNotMatch(error.message, /secret-proof/);
        return true;
      },
    );
  });

  it("blocks the passphrase refresh on repo-controlled URL rewrites", async () => {
    const repoPath = await createRepo();
    await git(repoPath, ["remote", "add", "origin", "git@example.invalid:repo.git"]);
    await git(repoPath, [
      "config",
      "url.ext::sh -c 'echo pwned'.insteadOf",
      "git@example.invalid:",
    ]);

    await assert.rejects(
      () =>
        fetchPrune(repoPath, { interactive: true, passphrase: "secret-proof" }),
      /Unsafe Git URL rewrite/,
    );
  });

  it("allows the passphrase refresh on a mixed https/ssh remote setup", async () => {
    const repoPath = await createRepo();
    await git(repoPath, ["remote", "add", "origin", "https://example.invalid/repo.git"]);
    await git(repoPath, ["remote", "add", "ssh", "git@example.invalid:repo.git"]);
    const binDir = await createFakeGit(`
#!/bin/sh
passphrase="$("$SSH_ASKPASS" "Enter passphrase for key '/tmp/test_key':")"
[ "$passphrase" = "secret" ] && exit 0
exit 1
`);

    await fetchPrune(repoPath, {
      env: { PATH: `${binDir}:${process.env.PATH}` },
      interactive: true,
      passphrase: "secret",
    });
  });
});

async function createRepo() {
  const repoPath = await mkdtemp(join(tmpdir(), "branch-cleaner-repo-"));
  cleanups.push(() => rm(repoPath, { force: true, recursive: true }));
  await git(repoPath, ["init", "-b", "main"]);
  await git(repoPath, ["config", "user.name", "Branch Cleaner Test"]);
  await git(repoPath, ["config", "user.email", "branch-cleaner@example.invalid"]);
  await git(repoPath, ["commit", "--allow-empty", "-m", "initial"]);
  return repoPath;
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
