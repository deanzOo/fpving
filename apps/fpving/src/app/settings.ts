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
  /** The settings the running parts were started with. */
  readonly applied: Settings;
  /** Starts a new plugin host for the settings. */
  readonly startHost: (settings: Settings) => Promise<PluginHost>;
  /** The store gateway over a host. */
  readonly gatewayFor: (host: PluginHost) => StoreGateway;
}

/**
 * A settings applier: `apply` saves and restarts; `close` refuses later changes and resolves once every change so
 * far has been applied.
 */
export interface SettingsApplier {
  apply(settings: Settings): Promise<void>;
  close(): Promise<void>;
  /** Whether a change is restarting the schedule or the plugin host right now. */
  restarting(): boolean;
}

const CLOSED = "the app is shutting down; settings are no longer applied";

const settledEither = (): void => undefined;

const pluginsChanged = (before: Settings, after: Settings): boolean =>
  before.shipToCountry !== after.shipToCountry || before.displayCurrency !== after.displayCurrency;

/**
 * Applies settings changes one at a time, each compared with the settings the running parts were started with. A new
 * ship-to country or display currency, which plugin workers receive when they start, starts a new plugin host; once
 * it is up the settings are saved, the gateway moves over to it, then the old host is shut down. A host that fails to
 * start, or settings that fail to save, which also shuts the new host down, leave the old host running and the old
 * settings saved, so the same change can be retried. That or a new scan interval,
 * which the schedule reads when it starts, restarts the schedule. The schedule is stopped first, which waits for a
 * running scan, so no scan loses its plugins halfway; it is started again whether or not the change succeeded. A
 * change that needs no restart is only saved. A failed change rejects for its caller; the next change still runs.
 *
 * @param options - The running parts and how to start a host and a gateway.
 * @returns The applier.
 */
export const createSettingsApplier = (options: SettingsApplierOptions): SettingsApplier => {
  const { live, startHost, gatewayFor } = options;
  let applied = options.applied;
  let queue = Promise.resolve();
  let closed = false;
  let restarting = false;
  const restart = async (next: Settings, restartPlugins: boolean): Promise<void> => {
    const { repository } = live.deps;
    await live.scans.stop();
    try {
      const old = live.host;
      const host = restartPlugins ? await startHost(next) : old;
      try {
        await repository.settings.save(next);
      } catch (error) {
        if (host !== old) {
          await host.shutdown();
        }
        throw error;
      }
      applied = next;
      if (host !== old) {
        live.host = host;
        live.deps = { ...live.deps, stores: gatewayFor(host) };
        await old.shutdown();
      }
    } finally {
      live.scans = await startScheduler(live.deps);
    }
  };
  const reconfigure = async (next: Settings): Promise<void> => {
    const restartPlugins = pluginsChanged(applied, next);
    if (!restartPlugins && applied.scanIntervalHours === next.scanIntervalHours) {
      await live.deps.repository.settings.save(next);
      applied = next;
      return;
    }
    restarting = true;
    try {
      await restart(next, restartPlugins);
    } finally {
      restarting = false;
    }
  };
  return {
    apply: async (next) => {
      if (closed) {
        return Promise.reject(new Error(CLOSED));
      }
      const run = queue.then(async () => reconfigure(next));
      // The caller gets the failure and the server logs it; the queue only waits for it.
      queue = run.then(settledEither, settledEither);
      return run;
    },
    restarting: () => restarting,
    close: async () => {
      closed = true;
      return queue;
    },
  };
};
