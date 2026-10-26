import { describe, expect, it } from "vitest";
import type { StorePlugin } from "../plugin.js";
import { storePluginContractChecks } from "./check-contract.js";
import type { ContractFixtures } from "./fixtures.js";

/**
 * Registers the store plugin contract as a Vitest suite named for the plugin id, one `it` per check: well-formed
 * fixture URLs (when one is malformed only this check runs, so the plugin is not blamed for it), a valid manifest,
 * the in-stock and out-of-stock fixtures parse to schema-valid listings, the 404 fixture gives `not_found`, the
 * captcha fixture gives `blocked`, the garbage fixture gives `parse_failed` with `rawPage`, a host timeout gives
 * `timeout`, and, when the manifest declares `search`, the search fixture gives schema-valid candidates.
 *
 * @example
 * ```ts
 * import { runStorePluginContract } from "@fpving/plugin-sdk/contract";
 * import plugin from "../src/index.js";
 * import { fixtures } from "./fixtures.js";
 *
 * runStorePluginContract(plugin, fixtures);
 * ```
 */
export const runStorePluginContract = (plugin: StorePlugin, fixtures: ContractFixtures): void => {
  describe(`Store plugin contract for ${plugin.manifest.id}`, () => {
    for (const check of storePluginContractChecks(plugin, fixtures)) {
      it(check.name, async () => {
        expect(await check.run()).toBeUndefined();
      });
    }
  });
};
