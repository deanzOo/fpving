---
title: "0020. Plugin list in DATA_DIR/plugins.json"
description: Why the plugins to load are listed in a JSON file in the data directory, and how bad entries are handled.
---

- Status: Accepted
- Date: 2026-10-28

## Context and problem statement

The host needs to know which store plugins to load. The list belongs to the user, not to the repository, must survive app updates, must be editable by hand and later from the Plugins screen, and must never stop the app from starting. The earlier docs sketched a typed `plugins.config.ts`.

## Considered options

- A typed `plugins.config.ts`. Rejected: the app would have to import and run a user file to read a list, and the Plugins screen could not rewrite it safely.
- Discovery: load every `fpving-plugin-*` package in `node_modules`. Rejected: anything installed would run without the user choosing it.
- A JSON file in `DATA_DIR`. Chosen.

## Decision outcome

The list is `<DATA_DIR>/plugins.json`, a JSON array of `{ "path": "<absolute folder>" }` or `{ "package": "<npm name>" }` entries, validated with Zod. It lives with the database and logs, so each worktree and each user has its own, and the UI can rewrite it as plain data.

- A missing file means no plugins.
- A file that cannot be read, is not valid JSON or is not an array is a typed `config_invalid` error; the app runs with no plugins and shows the reason.
- Each entry is validated on its own, so one bad entry disables only itself (`entry_invalid`). Relative paths are rejected, because they would resolve against whatever directory the app was started from.
- Folder paths are normalized; a later entry naming the same folder or package as an earlier one is reported as `duplicate_entry` and the first one is kept.

The file is read through an injected reader, so tests use temp directories or fakes and never touch a real `DATA_DIR`.

## Consequences

- Good: a broken list or entry never stops the app, and every rejection has a reason the Plugins screen can show.
- Good: no user code runs to read the list.
- Bad: JSON has no comments, so the file cannot carry notes.
