# @fpving/plugin-sdk

The public contract for fpving store plugins. fpving supports stores only through plugins built on this SDK.

- `@fpving/plugin-sdk` (module `plugin-sdk`): the plugin types, the Zod schemas the host validates plugin output with, the store error taxonomy, the ISO currency and country codes, and `Result`.
- `@fpving/plugin-sdk/contract` (module `contract`): `runStorePluginContract`, the contract test kit as a Vitest suite. Vitest is an optional peer dependency needed only by this entry.
- `@fpving/plugin-sdk/contract/check` (module `contract/check`): `checkStorePluginContract`, the same checks without a test runner. Nothing it imports loads Vitest.

See the "Writing a plugin" guide on the documentation site for a walkthrough.
