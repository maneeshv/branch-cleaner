# Contributing

Thanks for helping improve Branch Cleaner.

## Development Setup

Requirements:

- Node.js 20 or newer.
- Git.

Run the tests:

```bash
npm test
```

Check the npm package contents:

```bash
npm run pack:dry-run
```

## Pull Requests

- Keep changes focused and small.
- Add or update tests for behavior changes.
- Preserve the local-only safety model unless the change explicitly documents a
  different security tradeoff.
- Use Conventional Commits for commit messages, for example
  `fix: reject unauthorized delete requests`.

## Safety Expectations

Branch Cleaner can delete local Git branches. Changes that touch deletion,
fetching, protected branches, or server routes should include tests covering the
failure path as well as the successful path.
