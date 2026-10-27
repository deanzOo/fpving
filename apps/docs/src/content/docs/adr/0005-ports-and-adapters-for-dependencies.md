---
title: "0005. Ports and adapters for dependencies"
description: Ports and adapters for dependencies.
---

- Status: Accepted
- Date: 2026-10-12

## Context and problem statement

The app depends on a browser driver, an LLM, an FX API, notifications, a database, HTTP, a clock, a scheduler and logging. Tests must be fast and deterministic without any of them.

## Considered options

- Call libraries directly from domain code.
- Wrap every runtime dependency behind a domain-defined interface and test with in-memory fakes.
- Wrap everything, including frameworks.

## Decision outcome

Every runtime or integration dependency sits behind a port the domain defines, with a default adapter. Tests use in-memory fakes of the same ports. Zod, React, Fastify and dev tooling are not wrapped, because they are framework or type-system level and have no real swap value.

## Consequences

- Good: the domain is testable without network, browser or database.
- Good: swapping an adapter touches one place.
- Bad: more interfaces to maintain.
- A new port requires an ADR.
