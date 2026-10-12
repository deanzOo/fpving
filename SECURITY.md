# Security policy

## Reporting a vulnerability

Report vulnerabilities privately through [GitHub Security Advisories](https://github.com/deanzOo/fpving/security/advisories/new). Do not open a public issue or pull request for a suspected vulnerability.

Include what you found, the affected version or commit, and steps to reproduce. You should get an acknowledgement within a few days. Fixes ship in a normal release and the advisory is published afterwards.

## Scope

fpving runs locally on your machine and ships no store plugins. Plugins run in worker threads for crash containment, not as a security sandbox, so install only plugins you trust. Reports about a third-party plugin belong with that plugin's author.

## Supported versions

The project is pre-alpha. Only the latest commit on `main` is supported.
