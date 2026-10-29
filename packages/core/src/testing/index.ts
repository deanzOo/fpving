/**
 * The repository and store gateway contract suites for adapters, imported from `@fpving/core/testing`. Vitest is an
 * optional peer dependency needed only by this entry; the main entry never loads it.
 *
 * @module testing
 */
export { describeRepositoryContract } from "./repository-contract.js";
export { describeStoreGatewayContract } from "./store-gateway-contract.js";
export type { StoreGatewayContractSubject } from "./store-gateway-contract.js";
