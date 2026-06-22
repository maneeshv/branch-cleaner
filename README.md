# Branch Cleaner

Branch Cleaner is a standalone local Git branch cleanup tool. It starts a
localhost web UI for searching, filtering, selecting, and deleting local
branches in any Git repository.

The default mode is local-only. It reads existing local refs and remote-tracking
refs without contacting the network. Fetching and pruning remote-tracking refs
only happens when requested explicitly.

## Install

From this repository, install the package binary globally:

```bash
npm install -g .
```

For local development, you can link the package instead:

```bash
npm link
```

Verify the CLI is available:

```bash
branch-cleaner --help
```

## Usage

Run from this repository:

```bash
node src/cli.mjs serve --repo /path/to/repo --base dev
```

Or use the package binary after linking or installing:

```bash
branch-cleaner serve --repo /path/to/repo --base dev
```

Options:

```text
--repo PATH      Git repository to inspect. Defaults to the current directory.
--base BRANCH    Branch used for merged status. Defaults to dev, main, master, then current.
--fetch          Run git fetch --prune once before starting the server.
--port PORT      Local server port. Defaults to a random open port.
--no-open        Do not open the browser automatically.
```

## Safety Model

- Uses `git branch -d` for normal local branch deletion.
- Requires explicit force mode in the UI before using `git branch -D`.
- Protects the current branch, base branch, `main`, `master`, and `dev`.
- Does not delete remote branches.
- Does not run `git fetch --prune` unless `--fetch` is passed or the UI refresh
  button is confirmed.

## Development

```bash
npm test
```
