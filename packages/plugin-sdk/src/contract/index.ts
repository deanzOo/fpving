/**
 * The contract test kit, imported from `@fpving/plugin-sdk/contract`. Vitest is an optional peer dependency needed
 * only by this entry.
 *
 * @module contract
 */
export { checkStorePluginContract } from "./check-contract.js";
export type { ContractFailure } from "./check-contract.js";
export type { ContractFixtures, FixturePage } from "./fixtures.js";
export { runStorePluginContract } from "./run-contract.js";
