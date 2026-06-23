const DEFAULT_PROTECTED_BRANCHES = new Set(["main", "master", "dev"]);

export function parseBranchLines(output) {
  return output
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [name, upstream, commit, lastCommittedAt] = line.split("\u0000");
      return {
        name,
        lastCommittedAt: lastCommittedAt || "",
        upstream: upstream || "",
        commit: commit || "",
      };
    });
}

export function parseRemoteLines(output) {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.endsWith("/HEAD"));
}

export function classifyBranches({
  baseBranch,
  currentBranch,
  locals,
  mergedBranches,
  protectedBranches = DEFAULT_PROTECTED_BRANCHES,
  remotes,
}) {
  const remoteSet = new Set(remotes);

  return locals.map((branch) => {
    const matchingRemote = findRemoteRef(branch, remotes, remoteSet);
    const mergedToBase = mergedBranches.has(branch.name);
    const protection = getProtectionReason({
      baseBranch,
      branchName: branch.name,
      currentBranch,
      protectedBranches,
    });

    return {
      commit: branch.commit,
      lastCommittedAt: branch.lastCommittedAt,
      mergedToBase,
      name: branch.name,
      protected: Boolean(protection),
      protectedReason: protection,
      remoteRef: matchingRemote.remoteRef,
      remoteStatus: matchingRemote.remoteStatus,
      upstream: branch.upstream,
    };
  });
}

export function selectDeleteCommand({ branch, force }) {
  if (branch.protected) {
    throw new Error(
      `Cannot delete protected branch ${branch.name}: ${branch.protectedReason}`,
    );
  }

  if (!branch.mergedToBase && !force) {
    throw new Error(
      `Branch ${branch.name} is not merged. Re-run with force enabled to delete it.`,
    );
  }

  return ["branch", force ? "-D" : "-d", "--", branch.name];
}

function findRemoteRef(branch, remotes, remoteSet) {
  const sameNameRemote = remotes.find((remoteRef) =>
    remoteRef.endsWith(`/${branch.name}`),
  );

  if (sameNameRemote) {
    return {
      remoteRef: sameNameRemote,
      remoteStatus: "present",
    };
  }

  if (branch.upstream) {
    return {
      remoteRef: branch.upstream,
      remoteStatus: remoteSet.has(branch.upstream) ? "present" : "stale-upstream",
    };
  }

  return {
    remoteRef: "",
    remoteStatus: "none",
  };
}

function getProtectionReason({
  baseBranch,
  branchName,
  currentBranch,
  protectedBranches,
}) {
  if (branchName === currentBranch) {
    return "current branch";
  }

  if (branchName === baseBranch) {
    return "base branch";
  }

  if (protectedBranches.has(branchName)) {
    return "protected branch";
  }

  return "";
}
