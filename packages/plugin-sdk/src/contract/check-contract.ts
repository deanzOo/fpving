import { z } from "zod";
import type { PluginContext, TransportError } from "../context.js";
import { StoreErrorKind } from "../errors.js";
import type { StoreResult } from "../errors.js";
import { fetchedListingSchema, httpUrlSchema, searchCandidateSchema } from "../listing.js";
import type { FetchedListing } from "../listing.js";
import { manifestSchema, PluginCapability } from "../manifest.js";
import type { StorePlugin } from "../plugin.js";
import { err, ok } from "../result.js";
import type { Result } from "../result.js";
import type { ContractFixtures, FixturePage } from "./fixtures.js";

/** One contract check that failed: the check's name and why it failed. */
export interface ContractFailure {
  /** The check's name, a requirement sentence. */
  readonly check: string;
  /** Why the plugin failed it. */
  readonly message: string;
}

/** One contract check. `run` resolves to a failure message, or `undefined` when the plugin passes. */
export interface ContractCheck {
  /** The check's name, a requirement sentence. */
  readonly name: string;
  /** Runs the check against a fresh store. */
  readonly run: () => Promise<string | undefined>;
}

type Transport = (url: string) => Result<FixturePage, TransportError>;
type CheckRun = ContractCheck["run"];

const noop = (): void => undefined;

const normalize = (url: string): string => (URL.canParse(url) ? new URL(url).href : url);

const serve = (fixtures: ContractFixtures): Transport => {
  const pages = new Map(Object.entries(fixtures.pages).map(([url, page]) => [normalize(url), page]));
  return (url) => {
    const page = pages.get(normalize(url));
    return page === undefined ? err({ kind: StoreErrorKind.Network, detail: `no fixture page for ${url}` }) : ok(page);
  };
};

const timeOut: Transport = () =>
  err({ kind: StoreErrorKind.Timeout, detail: "the contract kit timed out the request" });

const fixtureContext = (fixtures: ContractFixtures, transport: Transport): PluginContext => ({
  http: {
    get: (url) => {
      const page = transport(url);
      return Promise.resolve(page.ok ? ok({ status: page.value.status, body: page.value.body, headers: {} }) : page);
    },
  },
  browser: {
    fetchPage: (url) => {
      const page = transport(url);
      return Promise.resolve(page.ok ? ok({ status: page.value.status, html: page.value.body, finalUrl: url }) : page);
    },
  },
  logger: { debug: noop, info: noop, warn: noop, error: noop },
  clock: { now: () => new Date(0) },
  shipTo: fixtures.shipTo,
  currencyPreference: fixtures.currencyPreference,
});

const outcome = (result: StoreResult<unknown>): string =>
  result.ok ? "a successful result" : `${result.error.kind}: ${result.error.detail}`;

const malformedFixtureUrls = (fixtures: ContractFixtures): string[] =>
  [
    ...Object.keys(fixtures.pages).map((url) => ({ where: "pages key", url })),
    ...Object.entries(fixtures.listings).map(([name, url]) => ({ where: `listings.${name}`, url })),
  ]
    .filter(({ url }) => !httpUrlSchema.safeParse(url).success)
    .map(({ where, url }) => `${where} ${JSON.stringify(url)}`);

const contractChecks = (plugin: StorePlugin, fixtures: ContractFixtures): ContractCheck[] => {
  const badUrls = malformedFixtureUrls(fixtures);
  const fixtureCheck: ContractCheck = {
    name: "uses well-formed contract fixtures",
    run: () => Promise.resolve(
      badUrls.length === 0 ? undefined : `fixture error: not an absolute http(s) url: ${badUrls.join(", ")}`,
    ),
  };
  if (badUrls.length > 0) return [fixtureCheck];
  const parsedManifest = manifestSchema.safeParse(plugin.manifest);

  const fetchListing = (url: string, transport = serve(fixtures)): Promise<StoreResult<FetchedListing>> =>
    plugin.createStore(fixtureContext(fixtures, transport)).fetchListing(url);

  const validListing = async (url: string): Promise<Result<FetchedListing, string>> => {
    const result = await fetchListing(url);
    if (!result.ok) return err(`expected a listing, got ${outcome(result)}`);
    const parsed = fetchedListingSchema.safeParse(result.value);
    return parsed.success ? ok(parsed.data) : err(`returned an invalid listing:\n${z.prettifyError(parsed.error)}`);
  };

  const inStock = (url: string, expected: boolean): CheckRun => async () => {
    const listing = await validListing(url);
    if (!listing.ok) return listing.error;
    const actual = listing.value.inStock;
    return actual === expected ? undefined : `expected inStock ${String(expected)}, got ${String(actual)}`;
  };

  const failsWith = (kind: StoreErrorKind, url: string, transport?: Transport): CheckRun => async () => {
    const result = await fetchListing(url, transport);
    return !result.ok && result.error.kind === kind ? undefined : `expected a ${kind} error, got ${outcome(result)}`;
  };

  const garbage: CheckRun = async () => {
    const result = await fetchListing(fixtures.listings.garbage);
    if (result.ok || result.error.kind !== StoreErrorKind.ParseFailed) {
      return `expected a parse_failed error, got ${outcome(result)}`;
    }
    const { rawPage } = result.error;
    return rawPage === undefined || rawPage === "" ? "parse_failed carried no rawPage" : undefined;
  };

  const search: CheckRun = async () => {
    const store = plugin.createStore(fixtureContext(fixtures, serve(fixtures)));
    if (store.search === undefined) return "the manifest declares search but the store has no search method";
    if (fixtures.searchQuery === undefined) return "the manifest declares search but the fixtures have no searchQuery";
    const result = await store.search(fixtures.searchQuery);
    if (!result.ok) return `expected candidates, got ${outcome(result)}`;
    const parsed = z.array(searchCandidateSchema).nonempty().safeParse(result.value);
    return parsed.success ? undefined : `returned invalid candidates:\n${z.prettifyError(parsed.error)}`;
  };

  const manifest: CheckRun = () => Promise.resolve(
    parsedManifest.success ? undefined : `invalid manifest:\n${z.prettifyError(parsedManifest.error)}`,
  );

  const { listings } = fixtures;
  const checks: ContractCheck[] = [
    fixtureCheck,
    { name: "declares a schema-valid manifest", run: manifest },
    {
      name: "parses the in-stock fixture into a schema-valid listing that is in stock",
      run: inStock(listings.inStock, true),
    },
    { name: "reports inStock false for the out-of-stock fixture", run: inStock(listings.outOfStock, false) },
    { name: "returns not_found for the 404 fixture", run: failsWith(StoreErrorKind.NotFound, listings.notFound) },
    { name: "returns blocked for the captcha fixture", run: failsWith(StoreErrorKind.Blocked, listings.captcha) },
    { name: "returns parse_failed with the raw page for the garbage fixture", run: garbage },
    {
      name: "returns timeout when the host http client and browser time out",
      run: failsWith(StoreErrorKind.Timeout, listings.inStock, timeOut),
    },
  ];
  return parsedManifest.success && parsedManifest.data.capabilities.includes(PluginCapability.Search)
    ? [...checks, { name: "returns schema-valid candidates for the search fixture", run: search }]
    : checks;
};

const attempt = async (run: CheckRun): Promise<string | undefined> => {
  try {
    return await run();
  } catch (error) {
    return `threw instead of returning a store result: ${String(error)}`;
  }
};

/**
 * The contract checks for `plugin`, in order. Each check builds a fresh store over a fake {@link PluginContext} whose
 * HTTP client and browser serve `fixtures.pages`, and a plugin that throws fails the check instead of crashing the run.
 */
export const storePluginContractChecks = (plugin: StorePlugin, fixtures: ContractFixtures): ContractCheck[] =>
  contractChecks(plugin, fixtures).map((check) => ({ name: check.name, run: () => attempt(check.run) }));

/**
 * Runs the store plugin contract and resolves to the failed checks, empty when the plugin passes. It needs no test
 * runner: import it from `@fpving/plugin-sdk/contract/check`, whose module graph never loads Vitest.
 * `runStorePluginContract` in `@fpving/plugin-sdk/contract` wraps the same checks as a Vitest suite.
 */
export const checkStorePluginContract = async (
  plugin: StorePlugin,
  fixtures: ContractFixtures,
): Promise<ContractFailure[]> => {
  const failures: ContractFailure[] = [];
  for (const check of storePluginContractChecks(plugin, fixtures)) {
    const message = await check.run();
    if (message !== undefined) failures.push({ check: check.name, message });
  }
  return failures;
};
