import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  classifyBranches,
  parseBranchLines,
  parseRemoteLines,
  selectDeleteCommand,
} from "../src/branch-data.mjs";

describe("branch classification", () => {
  it("marks same-name remote refs, stale upstreams, merge status, and protected branches", () => {
    const locals = parseBranchLines([
      "dev\u0000origin/dev\u0000aaa",
      "feat/merged\u0000origin/feat/merged\u0000bbb",
      "feat/stale\u0000origin/feat/stale\u0000ccc",
      "feat/local-only\u0000\u0000ddd",
    ].join("\n"));
    const remotes = parseRemoteLines([
      "origin/dev",
      "origin/feat/merged",
      "upstream/feat/local-only",
      "origin/HEAD",
    ].join("\n"));

    const rows = classifyBranches({
      baseBranch: "dev",
      currentBranch: "feat/local-only",
      locals,
      mergedBranches: new Set(["dev", "feat/merged"]),
      remotes,
    });

    assert.deepEqual(
      rows.map((row) => ({
        name: row.name,
        remoteStatus: row.remoteStatus,
        remoteRef: row.remoteRef,
        mergedToBase: row.mergedToBase,
        protected: row.protected,
        protectedReason: row.protectedReason,
      })),
      [
        {
          name: "dev",
          remoteStatus: "present",
          remoteRef: "origin/dev",
          mergedToBase: true,
          protected: true,
          protectedReason: "base branch",
        },
        {
          name: "feat/merged",
          remoteStatus: "present",
          remoteRef: "origin/feat/merged",
          mergedToBase: true,
          protected: false,
          protectedReason: "",
        },
        {
          name: "feat/stale",
          remoteStatus: "stale-upstream",
          remoteRef: "origin/feat/stale",
          mergedToBase: false,
          protected: false,
          protectedReason: "",
        },
        {
          name: "feat/local-only",
          remoteStatus: "present",
          remoteRef: "upstream/feat/local-only",
          mergedToBase: false,
          protected: true,
          protectedReason: "current branch",
        },
      ],
    );
  });
});

describe("delete command selection", () => {
  it("refuses protected branches", () => {
    assert.throws(
      () =>
        selectDeleteCommand({
          branch: {
            mergedToBase: true,
            name: "dev",
            protected: true,
            protectedReason: "base branch",
          },
          force: false,
        }),
      /Cannot delete protected branch dev: base branch/,
    );
  });

  it("uses safe delete for merged branches and requires force for unmerged branches", () => {
    assert.deepEqual(
      selectDeleteCommand({
        branch: { mergedToBase: true, name: "feat/merged", protected: false },
        force: false,
      }),
      ["branch", "-d", "--", "feat/merged"],
    );

    assert.throws(
      () =>
        selectDeleteCommand({
          branch: { mergedToBase: false, name: "feat/unmerged", protected: false },
          force: false,
        }),
      /Branch feat\/unmerged is not merged/,
    );

    assert.deepEqual(
      selectDeleteCommand({
        branch: { mergedToBase: false, name: "feat/unmerged", protected: false },
        force: true,
      }),
      ["branch", "-D", "--", "feat/unmerged"],
    );
  });
});
