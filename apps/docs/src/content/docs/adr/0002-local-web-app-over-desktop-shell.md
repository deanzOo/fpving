---
title: "0002. Local web app over a desktop shell"
description: Local web app over a desktop shell.
---

- Status: Accepted
- Date: 2026-10-12

## Context and problem statement

fpving watches prices for individual hobbyists. Each person's data is personal and nothing needs to be hosted. The app must run on macOS, Windows and Linux and be simple to build and contribute to.

## Considered options

- A local Node server with SQLite and a React UI opened in the browser.
- A packaged desktop app with Electron or Tauri.
- A hosted service.

## Decision outcome

A local web app: Node server, SQLite and a React UI at `localhost`.

## Consequences

- Good: one codebase, no native packaging or installer pipeline, simple CI.
- Good: each machine keeps its own data and nothing is hosted.
- Bad: the user starts a server and opens a browser.
- Revisit a packaged shell only if starting the server proves to be real friction.
