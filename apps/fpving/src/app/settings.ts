import { inspect } from "node:util";
import { startScheduler } from "@fpving/core";
import type { MatchDeps, SchedulerDeps, SchedulerHandle, Settings, StoreGateway } from "@fpving/core";
import type { PluginHost } from "../plugins/runtime/host.js";

/** Every port core's use cases take. */
export type AppDeps = MatchDeps & SchedulerDeps;

/** The parts of the running app a settings change replaces. */
export interface LiveParts {
  host: PluginHost;
  deps: AppDeps;
  scans: SchedulerHandle;
}

/** What {@link createSettingsApplier} needs. */
export interface SettingsApplierOptions {
  /** The running parts, replaced in place. */
  readonly live: LiveParts;
  /** Starts a new plugin host for the settings. */
  readonly startHost: (settings: Settings) => Promise<PluginHost>;
  /** The store gateway over a host. */
  readonly gatewayFor: (host: PluginHost) => StoreGateway;
}

/** A settings applier: `apply` saves and restarts, `settled` resolves once every change so far has been applied. */
export interface SettingsApplier {
  apply(settings: Settings): Promise<void>;
  settled(): Promise<void>;
}

const pluginsChanged = (before: Settings, after: Settings): boolean =>
  before.shipToCountry !== after.shipToCountry || before.displayCurrency !== after.displayCurrency;

/**
 * Applies settings changes one at a time. Each saves the settings; a new ship-to country or display currency, which
 * plugin workers receive when they start, restarts the plugin host and the gateway over it, and that or a new scan
 * interval, which the schedule reads when it starts, restarts the schedule. The schedule is stopped first, which waits
 * for a running scan, so no scan loses its plugins halfway; it is started again even when the host failed to restart.
 * A failed change rejects for its caller and is logged; the next change still runs.
 *
 * @param options - The running parts and how to start a host and a gateway.
 * @returns The applier.
 */
export const createSettingsApplier = (options: SettingsApplierOptions): SettingsApplier => {
  const { live, startHost, gatewayFor } = options;
  let queue = Promise.resolve();
  const reconfigure = async (next: Settings): Promise<void> => {
    const { repository } = live.deps;
    const before = await repository.settings.get();
    await repository.settings.save(next);
    const restartPlugins = pluginsChanged(before, next);
    if (!restartPlugins && before.scanIntervalHours === next.scanIntervalHours) {
      return;
    }
    await live.scans.stop();
    try {
      if (restartPlugins) {
        await live.host.shutdown();
        live.host = await startHost(next);
        live.deps = { ...live.deps, stores: gatewayFor(live.host) };
      }
    } finally {
      live.scans = await startScheduler(live.deps);
    }
  };
  return {
    apply: async (next) => {
      const run = queue.then(async () => reconfigure(next));
      queue = run.catch((error: unknown) => {
        live.deps.logger.error("settings change failed", { detail: inspect(error) });
      });
      return run;
    },
    settled: async () => queue,
  };
};
