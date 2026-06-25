import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";

import { fetchPrune, GitPassphraseRequiredError } from "../src/git.mjs";

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
});

async function createFakeGit(script) {
  const binDir = await mkdtemp(join(tmpdir(), "branch-cleaner-git-"));
  cleanups.push(() => rm(binDir, { force: true, recursive: true }));
  const gitPath = join(binDir, "git");
  await writeFile(gitPath, script.trimStart(), "utf8");
  await chmod(gitPath, 0o755);
  return binDir;
}
