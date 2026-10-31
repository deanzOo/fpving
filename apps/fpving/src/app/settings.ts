import { inspect } from "node:util";
import { err, ok, startScheduler } from "@fpving/core";
import type { MatchDeps, Result, SchedulerDeps, SchedulerHandle, Settings, StoreGateway } from "@fpving/core";
import type { PluginHost } from "../plugins/runtime/host.js";
import type { SettingsChangeError } from "../server/api.js";
import { ApiErrorKind } from "../server/errors.js";
import { withinDeadline } from "./lifecycle.js";

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
  /** The running parts, replaced in place; the store gateway is wrapped at once so its running calls can be awaited. */
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
  apply(settings: Settings): Promise<Result<void, SettingsChangeError>>;
  close(): Promise<void>;
  /** Whether a change is restarting the schedule or the plugin host right now. */
  restarting(): boolean;
}

const OLD_HOST_STUCK = "the old plugin host did not shut down";

const DRAIN_DEADLINE_MS = 5000;

const settledEither = (): void => undefined;

const changed = ok(undefined);

type DrainableGateway = StoreGateway & { drained(): Promise<boolean> };

const drainable = (gateway: StoreGateway): DrainableGateway => {
  const open = new Set<Promise<unknown>>();
  const track = async <T>(call: Promise<T>): Promise<T> => {
    open.add(call);
    try {
      return await call;
    } finally {
      open.delete(call);
    }
  };
  return {
    ...gateway,
    fetchListing: async (pluginId, url) => track(gateway.fetchListing(pluginId, url)),
    search: async (pluginId, query) => track(gateway.search(pluginId, query)),
    drained: async () => Promise.allSettled(open).then(() => true),
  };
};

const pluginsChanged = (before: Settings, after: Settings): boolean =>
  before.shipToCountry !== after.shipToCountry || before.displayCurrency !== after.displayCurrency;

/**
 * Applies settings changes one at a time, each compared with the settings the running parts were started with. A new
 * ship-to country or display currency, which plugin workers receive when they start, starts a new plugin host; once
 * it is up the settings are saved, the gateway moves over to it, the calls still running through the old gateway get
 * up to five seconds to finish, then the old host is shut down. A host that fails to start, or settings that fail to
 * save, which also shuts the new host down, leave the old host running and the old settings saved, so the same change
 * can be retried. An old host that fails to shut down is logged as a warning; the change still succeeds. That or a new
 * scan interval, which the schedule reads when it starts, restarts the schedule. The schedule is stopped first, which
 * waits for a running scan, so no scan loses its plugins halfway; it is started again whether or not the change
 * succeeded. A change that needs no restart is only saved. A failed change rejects for its caller; the next change
 * still runs.
 *
 * @param options - The running parts and how to start a host and a gateway.
 * @returns The applier.
 */
export const createSettingsApplier = (options: SettingsApplierOptions): SettingsApplier => {
  const { live, startHost, gatewayFor } = options;
  let gateway = drainable(live.deps.stores);
  live.deps = { ...live.deps, stores: gateway };
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
        const draining = gateway;
        gateway = drainable(gatewayFor(host));
        live.host = host;
        live.deps = { ...live.deps, stores: gateway };
        await withinDeadline(draining.drained(), DRAIN_DEADLINE_MS, live.deps.logger);
        await old.shutdown().catch((error: unknown) => {
          live.deps.logger.warn(OLD_HOST_STUCK, { detail: inspect(error) });
        });
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
        return err({ kind: ApiErrorKind.ShuttingDown });
      }
      const run = queue.then(async () => reconfigure(next)).then(() => changed);
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
