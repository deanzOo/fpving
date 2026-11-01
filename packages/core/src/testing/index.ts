/**
 * The repository and store gateway contract suites for adapters, and fakes of the LLM judge, notifier and exchange
 * rates ports, imported from `@fpving/core/testing`. Vitest is an optional peer dependency needed only by this entry;
 * the main entry never loads it.
 *
 * @module testing
 */
export { describeRepositoryContract } from "./repository-contract.js";
export { describeStoreGatewayContract } from "./store-gateway-contract.js";
export type { StoreGatewayContractSubject } from "./store-gateway-contract.js";
export { fakeLlmJudge } from "./fake-llm.js";
export { fakeNotifier } from "./fake-notifier.js";
export { fakeCurrencyRates } from "./fake-rates.js";
