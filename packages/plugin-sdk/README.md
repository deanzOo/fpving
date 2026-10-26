# @fpving/plugin-sdk

The public contract for fpving store plugins. fpving supports stores only through plugins built on this SDK.

- `@fpving/plugin-sdk` (module `plugin-sdk`): the plugin types, the Zod schemas the host validates plugin output with, the store error taxonomy, the ISO currency and country codes, and `Result`.
- `@fpving/plugin-sdk/contract` (module `contract`): the contract test kit, `runStorePluginContract` for Vitest and `checkStorePluginContract` without a test runner. Vitest is an optional peer dependency needed only by this entry.

See the "Writing a plugin" guide on the documentation site for a walkthrough.
