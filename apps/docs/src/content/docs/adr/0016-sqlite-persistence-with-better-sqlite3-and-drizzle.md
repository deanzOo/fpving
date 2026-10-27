---
title: "0016. SQLite persistence with better-sqlite3 and Drizzle"
description: Which driver, query builder and migration tool implement the Repository port.
---

- Status: Accepted
- Date: 2026-10-27

## Context and problem statement

The `Repository` port needs a real adapter. ADR 0002 already chose SQLite in a local Node server, running on macOS, Windows and Linux. What remains is the driver, how queries are written and typed, and how the schema changes over time without losing a user's data. Each repository method must be atomic, and the contract separates expected refusals (`not_found`, `duplicate_url`) from bugs, so constraint failures must be told apart reliably.

## Considered options

- `better-sqlite3` with Drizzle ORM and drizzle-kit. Chosen.
- `node:sqlite`, built into Node 24, with Drizzle. Rejected for now: it is not yet marked stable in Node 24, and Drizzle's support for it is only in the 1.0 pre-releases, not the stable line.
- `better-sqlite3` with hand-written SQL and hand-written migrations. Rejected: every row type would be written by hand next to the schema and could drift from it, and migrations would have to be written and checked by hand.

## Decision outcome

`apps/fpving` depends on `better-sqlite3` (MIT), `drizzle-orm` (Apache-2.0) and, for development only, `drizzle-kit` (MIT) and `@types/better-sqlite3` (MIT). `better-sqlite3` 13 is a Node-API addon and ships prebuilt binaries for macOS, Windows and Linux (x64 and arm64, glibc and musl) inside the package, so nothing is compiled on install and its build script is not run (`pnpm.ignoredBuiltDependencies`). It is synchronous, so a repository method runs as one `db.transaction` with no interleaving, and it reports SQLite's extended result codes (`SQLITE_CONSTRAINT_UNIQUE`, `SQLITE_CONSTRAINT_FOREIGNKEY`, `SQLITE_CONSTRAINT_PRIMARYKEY`), which the adapter maps to `Result` refusals per statement instead of matching error text.

The schema lives in `apps/fpving/src/adapters/sqlite/schema.ts`. Instants are integer epoch milliseconds, enum columns carry `CHECK` constraints generated from the core `as const` objects, and foreign keys are enforced with `ON DELETE RESTRICT`: a listing references its product, a product its cheapest listing, a snapshot its listing, a match candidate its product, and an alert its product, listing and before and after snapshots. Scan runs and plugin health name a plugin id, which has no table to reference. Rows are parsed back with the core Zod schemas, so a corrupted row throws instead of reaching the domain. `pnpm --filter @fpving/app db:generate` runs drizzle-kit to write SQL migrations into `apps/fpving/drizzle/`, which are committed and reviewed. `migrate(path)` copies an existing database with `VACUUM INTO` to a timestamped `.bak` beside it before applying pending migrations, which gives a consistent copy in any journal mode. It applies them in one transaction, and on failure throws with the backup's path. It runs before any repository connection is opened.

## Consequences

- Good: types come from the schema, migrations are generated and reviewable SQL, and a failed upgrade leaves both the database and a backup.
- Good: no native toolchain is needed on any supported platform.
- Bad: three new dependencies, and drizzle-kit pulls esbuild into development installs.
- Bad: a platform without a prebuilt binary (for example FreeBSD) would need a C++ toolchain to build `better-sqlite3`. Moving to `node:sqlite` once it is stable and supported by stable Drizzle would remove the native addon.
