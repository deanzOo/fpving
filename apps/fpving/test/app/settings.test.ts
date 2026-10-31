import { DEFAULT_SETTINGS, err, ok, pluginIdSchema, settingsSchema } from "@fpving/core";
import type { Settings } from "@fpving/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MockInstance } from "vitest";
import { keylessLlmJudge } from "../../src/adapters/anthropic/llm-judge.ts";
import { createSettingsApplier } from "../../src/app/settings.ts";
import type { AppDeps } from "../../src/app/settings.ts";
import { startPluginHost } from "../../src/plugins/runtime/host.ts";
import type { PluginHost } from "../../src/plugins/runtime/host.ts";
import { ApiErrorKind } from "../../src/server/errors.ts";
import { cleanUpTemp, openTempSqliteRepository } from "../adapters/sqlite/temp-db.ts";
import { fakeServices } from "../plugins/runtime/fake-worker.ts";
import { fakeGateway } from "../support/api-harness.ts";
import { FX } from "../support/app-fixtures.ts";
import { recordingLogger } from "../support/recording-logger.ts";

const US: Settings = { ...settingsSchema.parse(DEFAULT_SETTINGS), shipToCountry: "US" };

const notApplied = err({ kind: ApiErrorKind.SettingsNotApplied });

afterEach(cleanUpTemp);

const held = () => {
  let release = (): void => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { gate, release };
};

const applierHarness = async () => {
  const sqlite = await openTempSqliteRepository();
  const saving = vi.fn(async (settings: Settings) => sqlite.settings.save(settings));
  const repository = { ...sqlite, settings: { ...sqlite.settings, save: saving } };
  const logger = recordingLogger();
  const armed: number[] = [];
  const hosts: PluginHost[] = [];
  const spies: MockInstance<PluginHost["shutdown"]>[] = [];
  const events: string[] = [];
  const startHost = vi.fn(async (settings: Settings) => {
    const host = await startPluginHost({
      entries: [],
      services: fakeServices().services,
      shipTo: settings.shipToCountry,
      currencyPreference: settings.displayCurrency,
    });
    const index = hosts.push(host) - 1;
    const shutdown = host.shutdown.bind(host);
    spies.push(vi.spyOn(host, "shutdown").mockImplementation(async () => {
      events.push(`host ${String(index)} shut down`);
      return shutdown();
    }));
    return host;
  });
  const applied = await repository.settings.get();
  const host = await startHost(applied);
  const old = fakeGateway();
  const deps: AppDeps = {
    repository,
    stores: old.gateway,
    ids: { next: () => "id" },
    clock: { now: () => new Date(0) },
    notifier: { notify: async () => Promise.resolve(ok(undefined)) },
    logger,
    llm: keylessLlmJudge(logger),
    rates: { fetchLatest: async () => Promise.resolve(ok(FX)) },
    scheduler: {
      every: (intervalMs) => {
        armed.push(intervalMs);
        return () => undefined;
      },
    },
  };
  const stop = async (): Promise<void> => Promise.resolve();
  const scans = { scanNow: vi.fn(), stop, scanning: () => false, lastReport: () => null };
  const live = { host, deps, scans };
  const applier = createSettingsApplier({ live, applied, startHost, gatewayFor: () => fakeGateway().gateway });
  const shutdowns = () => spies.map((spy) => spy.mock.calls.length);
  return { applier, live, startHost, armed, repository, saving, hosts, spies, shutdowns, events, old, logger };
};

describe("Settings applier", () => {
  it("refuses a change that arrives after it was closed, starting no plugin host and no schedule", async () => {
    const { applier, startHost, armed, repository } = await applierHarness();
    await applier.close();
    expect(await applier.apply(US)).toEqual(err({ kind: ApiErrorKind.ShuttingDown }));
    expect({ hosts: startHost.mock.calls.length, armed }).toEqual({ hosts: 1, armed: [] });
    expect(await repository.settings.get()).toMatchObject({ shipToCountry: "IL" });
  });

  it("says it is restarting while a change restarts the plugin host, and not before or after", async () => {
    const { applier, startHost } = await applierHarness();
    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const original = startHost.getMockImplementation();
    startHost.mockImplementationOnce(async (settings) => {
      await held;
      return original === undefined ? Promise.reject(new Error("no host")) : original(settings);
    });
    expect(applier.restarting()).toBe(false);
    const applying = applier.apply(US);
    await vi.waitFor(() => {
      expect(startHost.mock.calls.map(([settings]) => settings.shipToCountry)).toEqual(["IL", "US"]);
    });
    expect(applier.restarting()).toBe(true);
    release();
    await applying;
    expect(applier.restarting()).toBe(false);
  });

  it("stops saying it is restarting when the plugin host failed to start", async () => {
    const { applier, startHost } = await applierHarness();
    startHost.mockRejectedValueOnce(new Error("cannot spawn"));
    expect(await applier.apply(US)).toEqual(notApplied);
    expect(applier.restarting()).toBe(false);
  });

  it("keeps only the old host running and the old settings saved when saving fails, so a retry works", async () => {
    const { applier, live, hosts, shutdowns, saving, repository } = await applierHarness();
    saving.mockRejectedValueOnce(new Error("disk full"));
    expect(await applier.apply(US)).toEqual(notApplied);
    expect({ live: live.host === hosts[0], shutdowns: shutdowns() }).toEqual({ live: true, shutdowns: [0, 1] });
    expect(await repository.settings.get()).toMatchObject({ shipToCountry: "IL" });
    await applier.apply(US);
    expect({ live: live.host === hosts.at(-1), shutdowns: shutdowns() }).toEqual({ live: true, shutdowns: [1, 1, 0] });
    expect(await repository.settings.get()).toMatchObject({ shipToCountry: "US" });
  });

  it("keeps the old schedule and settings when saving a new scan interval fails", async () => {
    const { applier, armed, shutdowns, saving, repository } = await applierHarness();
    saving.mockRejectedValueOnce(new Error("disk full"));
    expect(await applier.apply({ ...US, shipToCountry: "IL", scanIntervalHours: 1 })).toEqual(notApplied);
    expect({ armed, shutdowns: shutdowns() }).toEqual({ armed: [armed[0]], shutdowns: [0] });
    expect(await repository.settings.get()).toEqual(settingsSchema.parse(DEFAULT_SETTINGS));
  });

  it("answers settings_not_applied to a change whose settings fail to save, and logs why", async () => {
    const { applier, saving, logger } = await applierHarness();
    saving.mockRejectedValueOnce(new Error("disk full"));
    expect(await applier.apply({ ...US, shipToCountry: "IL", priceDropMinBasisPoints: 1 })).toEqual(notApplied);
    const errors = logger.events.filter((event) => event.level === "error");
    expect(errors.map(({ message, fields }) => [message, String(fields?.["detail"]).includes("disk full")])).toEqual([
      ["settings change not applied", true],
    ]);
  });

  it("lets a call through the old gateway finish before it shuts the old host down", async () => {
    const { applier, live, hosts, events, old, repository } = await applierHarness();
    const { gate, release } = held();
    old.script.fetching = gate;
    old.gateway.search = async () => gate.then(() => ok([]));
    const shop = pluginIdSchema.parse("shop");
    const call = live.deps.stores.fetchListing(shop, "https://shop.example/p").then((result) => {
      events.push("call finished");
      return result;
    });
    const searching = live.deps.stores.search(shop, { text: "frame" }).then(() => {
      events.push("search finished");
    });
    const applying = applier.apply(US);
    await vi.waitFor(async () => {
      expect({ moved: live.host === hosts[1], saved: (await repository.settings.get()).shipToCountry })
        .toEqual({ moved: true, saved: "US" });
    });
    release();
    await applying;
    await searching;
    expect((await call).ok).toBe(true);
    expect(events).toEqual(["call finished", "search finished", "host 0 shut down"]);
  });

  it("applies the change and logs a warning when the old host fails to shut down", async () => {
    const { applier, live, hosts, spies, logger } = await applierHarness();
    spies[0]?.mockRejectedValueOnce(new Error("worker stuck"));
    expect(await applier.apply(US)).toEqual(ok(undefined));
    expect(live.host).toBe(hosts.at(-1));
    expect(logger.events.filter((event) => event.level === "warn").map((event) => event.message)).toEqual([
      "the old plugin host did not shut down",
    ]);
  });
});
