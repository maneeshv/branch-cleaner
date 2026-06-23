# Security Policy

## Supported Versions

Security fixes are provided for the latest published version of Branch Cleaner.

## Reporting a Vulnerability

Please report security issues privately by opening a GitHub security advisory or
emailing the maintainer listed on the npm package. Do not disclose exploitable
details in public issues until a fix is available.

When reporting, include:

- The affected version or commit.
- The operating system and Node.js version.
- A minimal reproduction or clear steps to trigger the issue.
- The impact you believe the issue has.

## Security Model

Branch Cleaner starts a local HTTP server bound to `127.0.0.1` by default. It
does not expose remote branch deletion and does not contact remotes unless
`--fetch` is passed or the UI refresh action is confirmed.

Mutating HTTP routes require an ephemeral per-server request token. This reduces
the risk of another local page issuing branch deletion or fetch requests against
an open Branch Cleaner session.

Branch names and repository paths may be sensitive. Avoid sharing screenshots or
logs publicly if they reveal private repository information.
