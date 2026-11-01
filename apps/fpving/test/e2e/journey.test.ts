import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LlmVerdict, ok } from "@fpving/core";
import { fakeCurrencyRates, fakeLlmJudge, fakeNotifier } from "@fpving/core/testing";
import { chromium } from "playwright";
import type { ConsoleMessage, Page } from "playwright";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { startApp } from "../../src/app/start.ts";
import { PLUGINS_FILE } from "../../src/plugins/config.ts";
import { freePort, FX } from "../support/app-fixtures.ts";
import { FIXTURE_PLUGIN_DIR, localHttpClient, ORIGIN_ENV } from "../support/fixture-gateway.ts";
import { startLocalServer } from "../support/local-server.ts";
import type { LocalServer } from "../support/local-server.ts";
import { fixturePlugin, spawnSourceWorker } from "../support/plugin-workers.ts";

const STEP_TIMEOUT_MS = 30_000;
const DROPPED_PRICE_MINOR = 1499;
const SHEKELS_PER_EURO = 4.4;
const RATES = { ...FX, ratesPerBase: { ...FX.ratesPerBase, ILS: SHEKELS_PER_EURO } };
const RM_RETRIES = 5;
const BOTH_LISTINGS = 2;

const Env = { Headed: "FPVING_E2E_HEADED", On: "1" } as const;
const Browser = { Locale: "en-US", TimezoneId: "Asia/Jerusalem", Profile: "profile" } as const;
const Problem = ["error", "warning"] as const;

const Store = {
  SourceUrl: "https://source.example/frame",
  SourcePlugin: "source-shop",
  NewShipTo: "US",
} as const;

const Text = {
  Source: "Acme Fixture Frame",
  Candidate: "Fixture Frame",
  Reason: "Same frame, sold the same way.",
  Landed: "₪120.00",
  CandidateRow: "fixture-shop: Fixture Frame",
  Found: "Saved 2 candidates.",
  Scanning: "Scanning every listing…",
  Saved: "Settings saved.",
  NoUnread: "No unread alerts.",
  PriceDrop: "Price drop",
  Unread: "Unread",
} as const;

const Label = {
  Nav: "Main",
  Watchlist: "Watchlist",
  Matches: "Matches",
  Alerts: "Alerts",
  OneUnread: "Alerts, 1 unread",
  Settings: "Settings",
  StoreUrl: "Store URL",
  AddProduct: "Add product",
  FindMatches: "Find matches",
  ScanNow: "Scan now",
  ShipTo: "Ship to",
  SaveSettings: "Save settings",
  UnreadOnly: "Unread only",
} as const;

const Path = { Alerts: "/alerts" } as const;

const scanned = (listings: number, alerts: number): string =>
  `: ${String(listings)} listings fetched, 0 failed, ${String(alerts)} alerts`;

const llm = fakeLlmJudge({
  identity: ok({ brand: "Acme", model: "Fixture Frame", variantAttributes: [] }),
  verdict: ok({ verdict: LlmVerdict.Same, reason: Text.Reason }),
});

interface Journey {
  readonly page: Page;
  readonly address: string;
  readonly server: LocalServer;
  readonly notifier: ReturnType<typeof fakeNotifier>;
}

let journey: Journey;
const problems: string[] = [];
const cleanups: (() => Promise<unknown>)[] = [];

const isProblem = (message: ConsoleMessage): boolean => Problem.some((type) => type === message.type());

const watchProblems = (page: Page): void => {
  page.on("console", (message) => {
    if (isProblem(message)) {
      problems.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => {
    problems.push(`page error: ${error.message}`);
  });
};

beforeAll(async () => {
  const root = await mkdtemp(join(tmpdir(), "fpving-e2e-"));
  cleanups.push(async () => rm(root, { recursive: true, force: true, maxRetries: RM_RETRIES }));
  const server = await startLocalServer();
  cleanups.push(async () => server.close());
  vi.stubEnv(ORIGIN_ENV, server.origin);
  cleanups.push(async () => Promise.resolve(vi.unstubAllEnvs()));
  const dataDir = join(root, "data");
  await mkdir(dataDir);
  const plugins = [fixturePlugin(Store.SourcePlugin), { path: FIXTURE_PLUGIN_DIR }];
  await writeFile(join(dataDir, PLUGINS_FILE), JSON.stringify(plugins));
  const notifier = fakeNotifier();
  const started = await startApp(
    { PORT: String(await freePort()), DATA_DIR: dataDir },
    { llm, rates: fakeCurrencyRates(ok(RATES)), notifier, http: localHttpClient(), spawn: spawnSourceWorker },
  );
  if (!started.ok) {
    throw new Error(started.error.message);
  }
  const app = started.value;
  cleanups.push(async () => {
    expect(await app.shutdown()).toBe(true);
  });
  const context = await chromium.launchPersistentContext(join(root, Browser.Profile), {
    headless: process.env[Env.Headed] !== Env.On,
    locale: Browser.Locale,
    timezoneId: Browser.TimezoneId,
  });
  cleanups.push(async () => context.close());
  context.setDefaultTimeout(STEP_TIMEOUT_MS);
  context.pages().forEach(watchProblems);
  context.on("page", watchProblems);
  const page = context.pages()[0] ?? await context.newPage();
  await page.goto(app.address);
  journey = { page, address: app.address, server, notifier };
});

beforeEach(({ task, skip }) => {
  const steps = task.suite?.tasks ?? [];
  const unfinished = steps.slice(0, steps.indexOf(task)).find(({ result }) => result?.state !== "pass");
  if (unfinished !== undefined) {
    skip(`the journey's steps run in order, and "${unfinished.name}" did not pass`);
  }
});

afterEach(() => {
  expect(problems.splice(0), "the page logged an error or warning, or broke its CSP").toEqual([]);
});

afterAll(async () => {
  const failures: unknown[] = [];
  for (const cleanup of cleanups.splice(0).reverse()) {
    try {
      await cleanup();
    } catch (error) {
      failures.push(error);
    }
  }
  expect(failures, "a teardown step failed").toEqual([]);
  expect(problems, "the page logged an error or warning during teardown").toEqual([]);
});

const status = (page: Page, text: string) => page.getByRole("status").filter({ hasText: text });
const nav = (page: Page) => page.getByRole("navigation", { name: Label.Nav });

const scanNow = async (page: Page, listings: number, alerts: number): Promise<void> => {
  await nav(page).getByRole("link", { name: Label.Watchlist }).click();
  await page.getByRole("button", { name: Label.ScanNow }).click();
  await status(page, Text.Scanning).waitFor();
  await status(page, scanned(listings, alerts)).waitFor();
};

const expectNoAlerts = async ({ page, address, notifier }: Journey): Promise<void> => {
  await page.goto(`${address}${Path.Alerts}`);
  await page.getByLabel(Label.UnreadOnly).check();
  await page.getByRole("main").getByText(Text.NoUnread).waitFor();
  await nav(page).getByRole("link", { name: Label.Alerts, exact: true }).waitFor();
  expect(await nav(page).getByRole("link", { name: Label.OneUnread }).count()).toBe(0);
  expect(notifier.sent).toEqual([]);
};

describe("End-to-end journey", () => {
  it("shows a product added by URL on the watchlist with its landed cost", async () => {
    const { page } = journey;
    await status(page, scanned(0, 0)).waitFor();
    await page.getByLabel(Label.StoreUrl).fill(Store.SourceUrl);
    await page.getByRole("button", { name: Label.AddProduct }).click();
    await status(page, `Now watching ${Text.Source}`).waitFor();
    await page.getByRole("row", { name: Text.Source }).filter({ hasText: Text.Landed }).waitFor();
  });

  it("scans the new product's listing, which becomes its cheapest, without an alert", async () => {
    await scanNow(journey.page, 1, 0);
    await expectNoAlerts(journey);
  });

  it("lists a match the judge found the same product on Match review, with its verdict", async () => {
    const { page } = journey;
    await nav(page).getByRole("link", { name: Label.Matches }).click();
    await page.getByRole("button", { name: Label.FindMatches }).click();
    await status(page, Text.Found).waitFor();
    await page.getByRole("listitem")
      .filter({ has: page.getByRole("link", { name: Text.Candidate, exact: true }) })
      .filter({ hasText: `Same product: ${Text.Reason}` })
      .waitFor();
  });

  it("adds an accepted match to the product's listings", async () => {
    const { page } = journey;
    await page.getByRole("button", { name: `Accept ${Text.Candidate}`, exact: true }).click();
    await status(page, `Added ${Text.Candidate} to ${Text.Source}.`).waitFor();
    await nav(page).getByRole("link", { name: Label.Watchlist }).click();
    await page.getByRole("link", { name: Text.Source }).click();
    await page.getByRole("row", { name: Text.CandidateRow }).waitFor();
  });

  it("raises no new cheapest alert for a cheaper match whose shipping is unknown", async () => {
    await scanNow(journey.page, BOTH_LISTINGS, 0);
    await expectNoAlerts(journey);
  });

  it("raises no price drop for the first snapshot after the ship-to country changes", async () => {
    const { page } = journey;
    await nav(page).getByRole("link", { name: Label.Settings }).click();
    await page.getByLabel(Label.ShipTo).selectOption(Store.NewShipTo);
    await page.getByRole("button", { name: Label.SaveSettings }).click();
    await status(page, Text.Saved).waitFor();
    await scanNow(page, BOTH_LISTINGS, 0);
    await expectNoAlerts(journey);
  });

  it("alerts on the Alerts screen, in the nav badge and as a notification when a match's price drops", async () => {
    const { page, server, notifier } = journey;
    server.setProductPrice(DROPPED_PRICE_MINOR);
    await scanNow(page, BOTH_LISTINGS, 1);
    await nav(page).getByRole("link", { name: Label.OneUnread }).click();
    const alerts = page.getByRole("main").getByRole("listitem");
    await alerts.filter({ hasText: Text.PriceDrop }).filter({ hasText: Text.Source }).filter({ hasText: Text.Unread })
      .waitFor();
    expect(await alerts.count()).toBe(1);
    expect(notifier.sent).toEqual([expect.objectContaining({ title: Text.Source })]);
  });
});
