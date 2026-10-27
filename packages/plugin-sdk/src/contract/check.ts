/**
 * The contract check that needs no test runner, imported from `@fpving/plugin-sdk/contract/check`. Nothing it imports
 * touches Vitest.
 *
 * @module contract/check
 */
export { checkStorePluginContract } from "./check-contract.js";
export type { ContractFailure } from "./check-contract.js";
export type { ContractFixtures, FixturePage } from "./fixtures.js";
