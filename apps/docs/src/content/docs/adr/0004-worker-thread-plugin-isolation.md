---
title: "0004. Worker-thread plugin isolation"
description: Worker-thread plugin isolation.
---

- Status: Accepted
- Date: 2026-10-12

## Context and problem statement

Plugins are third-party code that can hang or crash. The host must stay up and keep scanning other stores.

## Considered options

- Run plugins in the main thread.
- Run each plugin in its own worker thread.
- Run each plugin in a child process or a hardened sandbox.

## Decision outcome

Each plugin will run in its own worker thread with hard timeouts. The design is that a crashed or hung worker is killed and restarted once, and a second failure disables the plugin for the session. Not built yet.

## Consequences

- Good: crash and hang containment with low overhead.
- Good: the host can enforce timeouts it controls.
- Bad: worker threads are not a security boundary. The docs state that users should install only plugins they trust.
