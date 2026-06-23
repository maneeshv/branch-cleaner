#!/usr/bin/env node
import { spawn } from "node:child_process";
import process from "node:process";

import { startServer } from "./server.mjs";

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help || args.command !== "serve") {
    printHelp();
    process.exit(args.help ? 0 : 1);
  }

  const server = await startServer({
    baseBranch: args.base,
    fetchAtStartup: args.fetch,
    port: args.port,
    repoPath: args.repo,
  });

  console.log(`Branch Purge running at ${server.url}`);
  console.log(`Repository: ${server.repoPath}`);
  console.log(`Base branch: ${server.baseBranch}`);
  console.log("Press Ctrl+C to stop.");

  if (args.open) {
    openBrowser(server.url);
  }
}

export function parseArgs(argv) {
  const args = {
    base: "",
    command: argv[0] && !argv[0].startsWith("-") ? argv[0] : "serve",
    fetch: false,
    help: argv.includes("--help") || argv.includes("-h"),
    open: true,
    port: 0,
    repo: process.cwd(),
  };

  const startIndex = argv[0] && !argv[0].startsWith("-") ? 1 : 0;
  for (let index = startIndex; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else if (arg === "--fetch") {
      args.fetch = true;
    } else if (arg === "--no-open") {
      args.open = false;
    } else if (arg === "--repo") {
      args.repo = requireValue(argv, (index += 1), "--repo");
    } else if (arg === "--base") {
      args.base = requireValue(argv, (index += 1), "--base");
    } else if (arg === "--port") {
      args.port = Number(requireValue(argv, (index += 1), "--port"));
      if (!Number.isInteger(args.port) || args.port < 0) {
        throw new Error("--port must be a non-negative integer");
      }
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function requireValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function openBrowser(url) {
  const command =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "cmd"
        : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  const child = spawn(command, args, {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}

function printHelp() {
  console.log(`Usage:
  branch-purge serve [--repo PATH] [--base BRANCH] [--fetch] [--port PORT] [--no-open]

Options:
  --repo PATH      Git repository to inspect. Defaults to the current directory.
  --base BRANCH    Branch used for merged status. Defaults to dev, main, master, then current.
  --fetch          Run git fetch --prune once before starting the server.
  --port PORT      Local server port. Defaults to a random open port.
  --no-open        Do not open the browser automatically.
`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
