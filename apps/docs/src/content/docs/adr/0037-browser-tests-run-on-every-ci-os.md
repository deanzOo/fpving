---
title: "0037. Browser tests run on every CI OS"
description: Corrects ADR 0019's note that browser tests cover Chromium on Linux only.
---

- Status: Accepted
- Date: 2026-11-04
- Amends: [ADR 0019](../0019-playwright-for-the-browser-driver/)

## Context and problem statement

ADR 0019 lists as a downside that the browser integration test does not run on macOS or Windows CI, so it covers Chromium on Linux only. That stopped being true when the UI tests needed a browser on every OS. The `.github/actions/chromium` composite action now installs Chromium on all three.

## Decision outcome

ADR 0019's consequence no longer holds: the browser integration test and the UI tests run on Linux, macOS and Windows CI.

Only Linux sets `FPVING_REQUIRE_BROWSER`, so a missing browser fails the job there. On macOS and Windows a missing browser would skip the browser integration test instead.

## Consequences

- Good: the browser driver is covered on each OS the app supports.
- Bad: each CI job pays for a browser download or cache restore, and Windows runs have shown timing failures such as a locked profile file.
