import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LlmVerdict, ok } from "@fpving/core";
import { fakeCurrencyRates, fakeLlmJudge, fakeNotifier } from "@fpving/core/testing";
import { chromium } from "playwright";
import type { Page } from "playwright";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startApp } from "../../src/app/start.ts";
import { PLUGINS_FILE } from "../../src/plugins/config.ts";
import { freePort, FX } from "../support/app-fixtures.ts";
import { FIXTURE_PLUGIN_DIR, localHttpClient, ORIGIN_ENV } from "../support/fixture-gateway.ts";
import { startLocalServer } from "../support/local-server.ts";
import type { LocalServer } from "../support/local-server.ts";
import { fixturePlugin, spawnSourceWorker } from "../support/plugin-workers.ts";

const STEP_TIMEOUT_MS = 30_000;
const DROPPED_PRICE_MINOR = 1499;
const WATCHED_LISTINGS = 2;
const SOURCE_URL = "https://source.example/frame";
const SHEKELS_PER_EURO = 4.4;
const RATES = { ...FX, ratesPerBase: { ...FX.ratesPerBase, ILS: SHEKELS_PER_EURO } };

const Text = {
  Source: "Acme Fixture Frame",
  Candidate: "Fixture Frame",
  Reason: "Same frame, sold the same way.",
  Landed: "₪120.00",
  CandidateRow: "fixture-shop: Fixture Frame",
} as const;

const scanned = (listings: number, alerts: number): string =>
  `: ${String(listings)} listings fetched, 0 failed, ${String(alerts)} alerts`;

const llm = fakeLlmJudge({
  identity: ok({ brand: "Acme", model: "Fixture Frame", variantAttributes: [] }),
  verdict: ok({ verdict: LlmVerdict.Same, reason: Text.Reason }),
});

interface Journey {
  readonly page: Page;
  readonly server: LocalServer;
  readonly notifier: ReturnType<typeof fakeNotifier>;
}

let journey: Journey;
const problems: string[] = [];
const cleanups: (() => Promise<unknown>)[] = [];

const watchProblems = (page: Page): void => {
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") {
      problems.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => {
    problems.push(`page error: ${error.message}`);
  });
};

beforeEach(async () => {
  problems.length = 0;
  const root = await mkdtemp(join(tmpdir(), "fpving-e2e-"));
  cleanups.push(async () => rm(root, { recursive: true, force: true, maxRetries: 5 }));
  const server = await startLocalServer();
  cleanups.push(async () => server.close());
  vi.stubEnv(ORIGIN_ENV, server.origin);
  cleanups.push(async () => Promise.resolve(vi.unstubAllEnvs()));
  const dataDir = join(root, "data");
  await mkdir(dataDir);
  const plugins = [fixturePlugin("source-shop"), { path: FIXTURE_PLUGIN_DIR }];
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
  const context = await chromium.launchPersistentContext(join(root, "profile"), {
    headless: process.env["FPVING_E2E_HEADED"] !== "1",
    locale: "en-US",
    timezoneId: "Asia/Jerusalem",
  });
  cleanups.push(async () => context.close());
  context.setDefaultTimeout(STEP_TIMEOUT_MS);
  const page = context.pages()[0] ?? await context.newPage();
  watchProblems(page);
  await page.goto(app.address);
  journey = { page, server, notifier };
});

afterEach(async () => {
  const failures: unknown[] = [];
  for (const cleanup of cleanups.splice(0).reverse()) {
    try {
      await cleanup();
    } catch (error) {
      failures.push(error);
    }
  }
  expect(failures, "a teardown step failed").toEqual([]);
  expect(problems, "the page logged an error or warning, or broke its CSP").toEqual([]);
});

const status = (page: Page, text: string) => page.getByRole("status").filter({ hasText: text });

const scanNow = async (page: Page, listings: number, alerts: number): Promise<void> => {
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Watchlist" }).click();
  await page.getByRole("button", { name: "Scan now" }).click();
  await status(page, scanned(listings, alerts)).waitFor();
};

describe("End-to-end journey", () => {
  it("watches a product, accepts a judged match, and alerts once the match's price drops", async () => {
    const { page, server, notifier } = journey;
    const nav = page.getByRole("navigation", { name: "Main" });
    await status(page, scanned(0, 0)).waitFor();

    await page.getByLabel("Store URL").fill(SOURCE_URL);
    await page.getByRole("button", { name: "Add product" }).click();
    await status(page, `Now watching ${Text.Source}`).waitFor();
    await page.getByRole("row", { name: Text.Source }).filter({ hasText: Text.Landed }).waitFor();

    await nav.getByRole("link", { name: "Matches" }).click();
    await page.getByRole("button", { name: "Find matches" }).click();
    await status(page, "Saved 2 candidates.").waitFor();
    const candidate = page.getByRole("listitem").filter({
      has: page.getByRole("link", { name: Text.Candidate, exact: true }),
    });
    await candidate.filter({ hasText: `Same product: ${Text.Reason}` }).waitFor();
    await page.getByRole("button", { name: `Accept ${Text.Candidate}`, exact: true }).click();
    await status(page, `Added ${Text.Candidate} to ${Text.Source}.`).waitFor();

    await nav.getByRole("link", { name: "Watchlist" }).click();
    await page.getByRole("link", { name: Text.Source }).click();
    await page.getByRole("row", { name: Text.CandidateRow }).waitFor();

    await scanNow(page, WATCHED_LISTINGS, 0);
    await nav.getByRole("link", { name: "Alerts", exact: true }).waitFor();
    expect(notifier.sent).toEqual([]);

    server.setProductPrice(DROPPED_PRICE_MINOR);
    await scanNow(page, WATCHED_LISTINGS, 1);
    await nav.getByRole("link", { name: "Alerts, 1 unread" }).click();
    const alerts = page.getByRole("main").getByRole("listitem");
    await alerts.filter({ hasText: "Price drop" }).filter({ hasText: Text.Source }).filter({ hasText: "Unread" })
      .waitFor();
    expect(await alerts.count()).toBe(1);
    expect(notifier.sent).toEqual([expect.objectContaining({ title: Text.Source })]);
  });
});
