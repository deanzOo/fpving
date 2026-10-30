import { DEFAULT_SETTINGS, ok, settingsSchema } from "@fpving/core";
import type { Settings } from "@fpving/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { keylessLlmJudge } from "../../src/adapters/anthropic/llm-judge.ts";
import { createSettingsApplier } from "../../src/app/settings.ts";
import type { AppDeps } from "../../src/app/settings.ts";
import { startPluginHost } from "../../src/plugins/runtime/host.ts";
import { cleanUpTemp, openTempSqliteRepository } from "../adapters/sqlite/temp-db.ts";
import { fakeServices } from "../plugins/runtime/fake-worker.ts";
import { fakeGateway } from "../support/api-harness.ts";
import { FX } from "../support/app-fixtures.ts";
import { recordingLogger } from "../support/recording-logger.ts";

const US: Settings = { ...settingsSchema.parse(DEFAULT_SETTINGS), shipToCountry: "US" };

afterEach(cleanUpTemp);

const applierHarness = async () => {
  const repository = await openTempSqliteRepository();
  const logger = recordingLogger();
  const armed: number[] = [];
  const startHost = vi.fn(async (settings: Settings) => startPluginHost({
    entries: [],
    services: fakeServices().services,
    shipTo: settings.shipToCountry,
    currencyPreference: settings.displayCurrency,
  }));
  const applied = await repository.settings.get();
  const host = await startHost(applied);
  const deps: AppDeps = {
    repository,
    stores: fakeGateway().gateway,
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
  const live = { host, deps, scans: { scanNow: vi.fn(), stop: async () => Promise.resolve() } };
  const applier = createSettingsApplier({ live, applied, startHost, gatewayFor: () => fakeGateway().gateway });
  return { applier, live, startHost, armed, repository };
};

describe("Settings applier", () => {
  it("refuses a change that arrives after it was closed, starting no plugin host and no schedule", async () => {
    const { applier, startHost, armed, repository } = await applierHarness();
    await applier.close();
    await expect(applier.apply(US)).rejects.toThrow();
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
    await expect(applier.apply(US)).rejects.toThrow("cannot spawn");
    expect(applier.restarting()).toBe(false);
  });
});
