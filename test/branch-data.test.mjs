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
      "dev\u0000origin/dev\u0000aaa\u00002026-06-20T10:11:12+00:00",
      "feat/merged\u0000origin/feat/merged\u0000bbb\u00002026-06-21T10:11:12+00:00",
      "feat/stale\u0000origin/feat/stale\u0000ccc\u00002026-06-22T10:11:12+00:00",
      "feat/local-only\u0000\u0000ddd\u00002026-06-23T10:11:12+00:00",
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
        lastCommittedAt: row.lastCommittedAt,
        remoteStatus: row.remoteStatus,
        remoteRef: row.remoteRef,
        mergedToBase: row.mergedToBase,
        protected: row.protected,
        protectedReason: row.protectedReason,
      })),
      [
        {
          name: "dev",
          lastCommittedAt: "2026-06-20T10:11:12+00:00",
          remoteStatus: "present",
          remoteRef: "origin/dev",
          mergedToBase: true,
          protected: true,
          protectedReason: "base branch",
        },
        {
          name: "feat/merged",
          lastCommittedAt: "2026-06-21T10:11:12+00:00",
          remoteStatus: "present",
          remoteRef: "origin/feat/merged",
          mergedToBase: true,
          protected: false,
          protectedReason: "",
        },
        {
          name: "feat/stale",
          lastCommittedAt: "2026-06-22T10:11:12+00:00",
          remoteStatus: "stale-upstream",
          remoteRef: "origin/feat/stale",
          mergedToBase: false,
          protected: false,
          protectedReason: "",
        },
        {
          name: "feat/local-only",
          lastCommittedAt: "2026-06-23T10:11:12+00:00",
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
