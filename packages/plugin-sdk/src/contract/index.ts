/**
 * The Vitest contract suite, imported from `@fpving/plugin-sdk/contract`. Vitest is an optional peer dependency needed
 * only by this entry; to run the contract without it, use `@fpving/plugin-sdk/contract/check`.
 *
 * @module contract
 */
export type { ContractFixtures, FixturePage } from "./fixtures.js";
export { runStorePluginContract } from "./run-contract.js";
