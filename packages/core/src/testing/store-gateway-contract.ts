import { fetchedListingSchema, searchCandidateSchema, storeErrorSchema } from "@fpving/plugin-sdk";
import type { SearchQuery } from "@fpving/plugin-sdk";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { pluginIdSchema } from "../index.js";
import type { PluginId, StoreGateway } from "../index.js";

const UNKNOWN_PLUGIN = pluginIdSchema.parse("contract-no-such-plugin");
const QUERY: SearchQuery = { text: "contract" };
const UNDECLARED_URL = "https://contract-undeclared.invalid/p";
const NAMED_HOST = /[a-z]$/u;

/** The gateway a contract run checks, and the plugins it was built with. */
export interface StoreGatewayContractSubject {
  /** The gateway under test. */
  readonly gateway: StoreGateway;
  /** A product page on a declared hostname that its plugin fetches successfully. */
  readonly listingUrl: string;
  /** A loaded plugin that declares `search` and answers any query successfully. */
  readonly searchablePlugin: PluginId;
  /** A loaded plugin that does not declare `search`. */
  readonly fetchOnlyPlugin: PluginId;
  /** A plugin that declares `search` but is disabled, for example after it crashed. */
  readonly disabledPlugin: PluginId;
  /** Releases whatever the subject holds, such as plugin workers or a server. */
  close(): Promise<void>;
}

const failed = z.object({ ok: z.literal(false), error: storeErrorSchema });
const succeeded = <T extends z.ZodType>(value: T) => z.object({ ok: z.literal(true), value });
const isPluginId = (id: PluginId | null): id is PluginId => id !== null;

/**
 * Registers the behaviour every {@link StoreGateway} implementation must have, as a Vitest suite named "Store gateway
 * contract". `makeSubject` is called once for the suite and its `close` once after it.
 *
 * @example
 * ```ts
 * import { describeStoreGatewayContract } from "@fpving/core/testing";
 *
 * describeStoreGatewayContract(async () => startGatewayWithFixturePlugins());
 * ```
 */
export const describeStoreGatewayContract = (makeSubject: () => Promise<StoreGatewayContractSubject>): void => {
  describe("Store gateway contract", () => {
    let subject: StoreGatewayContractSubject;
    const owners = (): (PluginId | null)[] =>
      subject.gateway.declaredDomains().map((domain) => subject.gateway.pluginFor(`https://${domain}/`));

    beforeAll(async () => {
      subject = await makeSubject();
    });

    afterAll(async () => {
      await subject.close();
    });

    it("lists each declared hostname once, and resolves each to the plugin that declares it", () => {
      const domains = subject.gateway.declaredDomains();
      expect(domains.length).toBeGreaterThan(0);
      expect(new Set(domains).size).toBe(domains.length);
      expect(owners()).not.toContain(null);
    });

    it("resolves a URL by its exact hostname, whatever its scheme, port, path, query or letter case", () => {
      const { gateway } = subject;
      const variants = gateway.declaredDomains().map((domain) =>
        gateway.pluginFor(`http://${domain.toUpperCase()}:8443/a/b?c=1#d`));
      expect(variants).toEqual(owners());
    });

    it("resolves a hostname no plugin declares, such as a subdomain of a declared one, to null", () => {
      const { gateway } = subject;
      const declared = gateway.declaredDomains();
      const subdomains = declared.filter((domain) => NAMED_HOST.test(domain)).map((domain) => `contract-sub.${domain}`)
        .filter((host) => !declared.includes(host));
      expect(subdomains.length).toBeGreaterThan(0);
      expect(subdomains.map((host) => gateway.pluginFor(`https://${host}/p`))).toEqual(subdomains.map(() => null));
      expect(gateway.pluginFor(UNDECLARED_URL)).toBeNull();
    });

    it("fetches a listing through the plugin that declares the URL's hostname", async () => {
      const { gateway, listingUrl } = subject;
      const owner = [gateway.pluginFor(listingUrl)].filter(isPluginId);
      const results = await Promise.all(owner.map(async (pluginId) => gateway.fetchListing(pluginId, listingUrl)));
      expect(results.map((result) => succeeded(fetchedListingSchema).safeParse(result).success)).toEqual([true]);
    });

    it("lists each searchable plugin once, only loaded plugins that declare search and own a hostname", () => {
      const searchable = subject.gateway.searchablePlugins();
      expect(new Set(searchable).size).toBe(searchable.length);
      expect(searchable).toContain(subject.searchablePlugin);
      expect(searchable).not.toContain(subject.fetchOnlyPlugin);
      expect(searchable).not.toContain(subject.disabledPlugin);
      expect(searchable).not.toContain(UNKNOWN_PLUGIN);
      expect(owners()).toEqual(expect.arrayContaining([...searchable]));
    });

    it("searches a searchable plugin and returns valid candidates", async () => {
      const result = await subject.gateway.search(subject.searchablePlugin, QUERY);
      expect(succeeded(searchCandidateSchema.array()).safeParse(result).success).toBe(true);
    });

    it("answers a fetch or search through an unknown plugin id with a typed error, not a rejection", async () => {
      const { gateway, listingUrl } = subject;
      expect(failed.safeParse(await gateway.fetchListing(UNKNOWN_PLUGIN, listingUrl)).success).toBe(true);
      expect(failed.safeParse(await gateway.search(UNKNOWN_PLUGIN, QUERY)).success).toBe(true);
    });

    it("answers a fetch or search through a disabled plugin with a typed error, not a rejection", async () => {
      const { gateway, listingUrl, disabledPlugin } = subject;
      expect(failed.safeParse(await gateway.fetchListing(disabledPlugin, listingUrl)).success).toBe(true);
      expect(failed.safeParse(await gateway.search(disabledPlugin, QUERY)).success).toBe(true);
    });

    it("answers a search through a plugin that cannot search with a typed error, not a rejection", async () => {
      expect(failed.safeParse(await subject.gateway.search(subject.fetchOnlyPlugin, QUERY)).success).toBe(true);
    });
  });
};
