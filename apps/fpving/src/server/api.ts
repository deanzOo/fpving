import { inspect } from "node:util";
import {
  acceptCandidate,
  addGear,
  addListing,
  addProduct,
  AddErrorKind,
  findMatches,
  GearErrorKind,
  listGear,
  markAllAlertsRead,
  MatchErrorKind,
  pendingCandidates,
  productDetail,
  rejectCandidate,
  removeGear,
  removeListing,
  searchCatalog,
  updateGear,
  watchlist,
  LlmErrorKind,
} from "@fpving/core";
import type {
  AddProductError,
  FindMatchesError,
  GearDeps,
  MatchDeps,
  Result,
  SchedulerDeps,
  SchedulerHandle,
  Settings,
  SpecReader,
} from "@fpving/core";
import { StoreErrorKind } from "@fpving/plugin-sdk";
import { GatewayRefusal } from "../plugins/store-gateway.js";
import { apiRoutes } from "./api-routes.js";
import type { PluginRow, ScanStatus } from "./api-routes.js";
import type { PluginActivity } from "./plugin-rows.js";
import { alreadyTrackedError, apiError, ApiErrorKind } from "./errors.js";
import type { PlainErrorKind } from "./errors.js";
import { HttpStatus } from "./http-status.js";
import type { AppServer } from "./server.js";

/** Why a settings change was not applied: the app is shutting down, or a plugin host failed to start or a save. */
export interface SettingsChangeError {
  readonly kind: typeof ApiErrorKind.ShuttingDown | typeof ApiErrorKind.SettingsNotApplied;
}

/** What the domain routes read on each request, once startup completed. */
export interface ApiRuntime {
  /** The ports core's use cases take, as they are now. */
  deps(): MatchDeps & SchedulerDeps;
  /** The ports core's gear use cases take, as they are now. */
  gear(): GearDeps;
  /** Reads gear specs from pasted text. */
  specReader(): SpecReader;
  /** The running scan schedule. */
  scans(): SchedulerHandle;
  /** The plugins screen rows, given what the repository holds about the plugins now. */
  plugins(activity: PluginActivity): readonly PluginRow[];
  /** Saves the settings and restarts what depends on them. */
  applySettings(settings: Settings): Promise<Result<void, SettingsChangeError>>;
  /** Whether a settings change is restarting the schedule or the plugins right now. */
  restarting(): boolean;
  /** Whether the app started shutting down. */
  stopping(): boolean;
}

/** What a route answers when it is reached before the runtime is attached; the readiness gate prevents that. */
export const NOT_ATTACHED = "the API runtime is not attached";

const Message = {
  InvalidUrl: "not an absolute http or https URL",
  ProductNotFound: "no product has this id",
  NotPending: "no pending match candidate has this id",
  AlertNotFound: "no alert has this id",
  ListingNotFound: "the product has no listing with this id that is not removed",
  NoSourceListing: "the product has no manually added listing to match from",
  AlreadySuggested: "another search saved candidates for this product meanwhile; search again",
  PluginUnavailable: "the plugin for this store is not loaded; see the plugins screen",
  ScanRunning: "a scan is already running",
  Restarting: "the plugins and the scan schedule are restarting for a settings change; try again shortly",
  ShuttingDown: "fpving is shutting down",
  InvalidSpecs: "the name, quantity or specs do not fit the kind of gear",
  GearNotFound: "no gear has this id",
  ReaderUnavailable: "the AI that reads specs is not available; set ANTHROPIC_API_KEY or enter the specs by hand",
  ReaderMalformed: "the AI answered something that is not valid gear specs; try again or enter them by hand",
  SettingsNotApplied: "the settings were not applied and the old ones still hold; see the log, then try again",
} as const;

const failure = <S extends (typeof HttpStatus)[keyof typeof HttpStatus]>(
  status: S,
  kind: PlainErrorKind,
  message: string,
) => ({ status, body: apiError(kind, message) });

const addFailure = (error: AddProductError) => {
  switch (error.kind) {
    case AddErrorKind.InvalidUrl:
      return failure(HttpStatus.UnprocessableContent, error.kind, Message.InvalidUrl);
    case AddErrorKind.NoPluginForDomain:
      return failure(HttpStatus.UnprocessableContent, error.kind, `no plugin handles ${error.host}`);
    case AddErrorKind.AlreadyTracked: {
      const { id, name } = error.product;
      return {
        status: HttpStatus.Conflict,
        body: alreadyTrackedError({ id, name }, `already tracked by product ${id} "${name}"`),
      };
    }
    case AddErrorKind.FetchFailed: {
      const { kind, detail } = error.error;
      return kind === StoreErrorKind.Network && detail === GatewayRefusal.Unavailable
        ? failure(HttpStatus.UnprocessableContent, ApiErrorKind.PluginUnavailable, Message.PluginUnavailable)
        : failure(HttpStatus.BadGateway, error.kind, `the store could not fetch the page: ${kind}`);
    }
  }
};

const matchFailure = (error: FindMatchesError) => {
  switch (error.kind) {
    case AddErrorKind.ProductNotFound:
      return failure(HttpStatus.NotFound, error.kind, Message.ProductNotFound);
    case MatchErrorKind.NoSourceListing:
      return failure(HttpStatus.Conflict, error.kind, Message.NoSourceListing);
    case MatchErrorKind.AlreadySuggested:
      return failure(HttpStatus.Conflict, error.kind, Message.AlreadySuggested);
  }
};

const productNotFound = failure(HttpStatus.NotFound, AddErrorKind.ProductNotFound, Message.ProductNotFound);
const gearNotFound = failure(HttpStatus.NotFound, ApiErrorKind.GearNotFound, Message.GearNotFound);
const invalidSpecs = failure(HttpStatus.UnprocessableContent, ApiErrorKind.InvalidSpecs, Message.InvalidSpecs);
const listingNotFound = failure(HttpStatus.NotFound, ApiErrorKind.ListingNotFound, Message.ListingNotFound);
const notPending = failure(HttpStatus.NotFound, MatchErrorKind.NotPending, Message.NotPending);
const restarting = failure(HttpStatus.ServiceUnavailable, ApiErrorKind.Restarting, Message.Restarting);
const shuttingDown = failure(HttpStatus.ServiceUnavailable, ApiErrorKind.ShuttingDown, Message.ShuttingDown);

/**
 * Registers every route of {@link apiRoutes}. Fastify takes routes only before `listen`, while the runtime exists
 * only once startup completed, so the handlers read it through the returned `attach`; the readiness gate keeps
 * requests away until then. Handlers call core's use cases or the repository and map each `Result` to a typed reply.
 * Scan now answers 409 while any scan runs, scheduled or not, and 503 once shutdown started; the scan status covers
 * every scan.
 *
 * @param server - The server, before `listen`.
 * @returns `attach`, which hands the routes the runtime.
 */
export const registerApiRoutes = (server: AppServer): { attach(runtime: ApiRuntime): void } => {
  let attached: ApiRuntime | null = null;
  const runtime = (): ApiRuntime => {
    if (attached === null) {
      throw new Error(NOT_ATTACHED);
    }
    return attached;
  };
  const deps = () => runtime().deps();
  const scanStatus = async (): Promise<ScanStatus> => {
    const scans = runtime().scans();
    const last = scans.lastReport();
    const { plugins, alerts, transitions } = last?.report ?? { plugins: [], alerts: [], transitions: [] };
    return {
      running: scans.scanning(),
      latestRun: await deps().repository.scanRuns.latest(),
      lastResult: last === null
        ? null
        : { finishedAt: last.finishedAt, plugins, alerts: alerts.length, transitions: transitions.length },
    };
  };
  const runScan = async (): Promise<void> => {
    const { logger } = deps();
    try {
      const report = await runtime().scans().scanNow();
      if (!report.ok) {
        logger.warn("scan not started", { kind: report.error.kind });
      }
    } catch (error) {
      logger.error("scan failed", { detail: inspect(error) });
    }
  };

  server.route({
    ...apiRoutes.listProducts,
    handler: async (_request, reply) => reply.code(HttpStatus.Ok).send(await watchlist(deps())),
  });

  server.route({
    ...apiRoutes.getProduct,
    handler: async ({ params: { productId } }, reply) => {
      const detail = await productDetail(deps(), productId);
      return detail.ok
        ? reply.code(HttpStatus.Ok).send(detail.value)
        : reply.code(productNotFound.status).send(productNotFound.body);
    },
  });

  server.route({
    ...apiRoutes.renameProduct,
    handler: async ({ params: { productId }, body: { name } }, reply) => {
      const renamed = await deps().repository.products.rename(productId, name);
      return renamed.ok
        ? reply.code(HttpStatus.NoContent).send(null)
        : reply.code(productNotFound.status).send(productNotFound.body);
    },
  });

  server.route({
    ...apiRoutes.archiveProduct,
    handler: async ({ params: { productId } }, reply) => {
      const { repository, clock } = deps();
      const archived = await repository.products.archive(productId, clock.now());
      return archived.ok
        ? reply.code(HttpStatus.NoContent).send(null)
        : reply.code(productNotFound.status).send(productNotFound.body);
    },
  });

  server.route({
    ...apiRoutes.addProduct,
    handler: async ({ body }, reply) => {
      if (runtime().restarting()) {
        return reply.code(restarting.status).send(restarting.body);
      }
      const added = await addProduct(deps(), body.url);
      if (!added.ok) {
        const { status, body: refusal } = addFailure(added.error);
        return reply.code(status).send(refusal);
      }
      return reply.code(HttpStatus.Created).send(added.value);
    },
  });

  server.route({
    ...apiRoutes.addListing,
    handler: async ({ params, body }, reply) => {
      if (runtime().restarting()) {
        return reply.code(restarting.status).send(restarting.body);
      }
      const added = await addListing(deps(), params.productId, body.url);
      if (added.ok) {
        return reply.code(HttpStatus.Created).send(added.value);
      }
      if (added.error.kind === AddErrorKind.ProductNotFound) {
        return reply.code(productNotFound.status).send(productNotFound.body);
      }
      const { status, body: refusal } = addFailure(added.error);
      return reply.code(status).send(refusal);
    },
  });

  server.route({
    ...apiRoutes.removeListing,
    handler: async ({ params: { productId, listingId } }, reply) => {
      const removed = await removeListing(deps(), productId, listingId);
      if (removed.ok) {
        return reply.code(HttpStatus.NoContent).send(null);
      }
      const { status, body } = removed.error.kind === AddErrorKind.ProductNotFound ? productNotFound : listingNotFound;
      return reply.code(status).send(body);
    },
  });

  server.route({
    ...apiRoutes.listCandidates,
    handler: async ({ params: { productId } }, reply) => {
      const pending = await pendingCandidates(deps(), productId);
      return pending.ok
        ? reply.code(HttpStatus.Ok).send(pending.value)
        : reply.code(productNotFound.status).send(productNotFound.body);
    },
  });

  server.route({
    ...apiRoutes.findMatches,
    handler: async ({ params: { productId } }, reply) => {
      if (runtime().restarting()) {
        return reply.code(restarting.status).send(restarting.body);
      }
      const found = await findMatches(deps(), productId);
      if (!found.ok) {
        const { status, body } = matchFailure(found.error);
        return reply.code(status).send(body);
      }
      return reply.code(HttpStatus.Ok).send(found.value);
    },
  });

  server.route({
    ...apiRoutes.acceptCandidate,
    handler: async ({ params: { candidateId } }, reply) => {
      if (runtime().restarting()) {
        return reply.code(restarting.status).send(restarting.body);
      }
      const accepted = await acceptCandidate(deps(), candidateId);
      if (!accepted.ok) {
        const { error } = accepted;
        const refusal = error.kind === MatchErrorKind.NotPending
          ? notPending
          : error.kind === AddErrorKind.ProductNotFound ? productNotFound : addFailure(error);
        return reply.code(refusal.status).send(refusal.body);
      }
      return reply.code(HttpStatus.Created).send(accepted.value);
    },
  });

  server.route({
    ...apiRoutes.rejectCandidate,
    handler: async ({ params: { candidateId } }, reply) => {
      const rejected = await rejectCandidate(deps(), candidateId);
      if (!rejected.ok) {
        return reply.code(notPending.status).send(notPending.body);
      }
      return reply.code(HttpStatus.NoContent).send(null);
    },
  });

  server.route({
    ...apiRoutes.listAlerts,
    handler: async ({ query }, reply) => {
      const alerts = await deps().repository.alerts.list({ unreadOnly: query.unread === true });
      return reply.code(HttpStatus.Ok).send(alerts);
    },
  });

  server.route({
    ...apiRoutes.markAlertRead,
    handler: async ({ params: { alertId } }, reply) => {
      const { repository, clock } = deps();
      const marked = await repository.alerts.markRead(alertId, clock.now());
      if (!marked.ok) {
        const { status, body } = failure(HttpStatus.NotFound, ApiErrorKind.AlertNotFound, Message.AlertNotFound);
        return reply.code(status).send(body);
      }
      return reply.code(HttpStatus.NoContent).send(null);
    },
  });

  server.route({
    ...apiRoutes.markAllAlertsRead,
    handler: async (_request, reply) => reply.code(HttpStatus.Ok).send({ marked: await markAllAlertsRead(deps()) }),
  });

  server.route({
    ...apiRoutes.getSettings,
    handler: async (_request, reply) => reply.code(HttpStatus.Ok).send(await deps().repository.settings.get()),
  });

  server.route({
    ...apiRoutes.putSettings,
    handler: async ({ body }, reply) => {
      const applied = await runtime().applySettings(body);
      if (applied.ok) {
        return reply.code(HttpStatus.Ok).send(body);
      }
      const { kind } = applied.error;
      const { status, body: refusal } = kind === ApiErrorKind.ShuttingDown
        ? shuttingDown
        : failure(HttpStatus.ServiceUnavailable, kind, Message.SettingsNotApplied);
      return reply.code(status).send(refusal);
    },
  });

  server.route({
    ...apiRoutes.listPlugins,
    handler: async (_request, reply) => {
      const { repository, clock } = deps();
      const [health, scanned] = await Promise.all([repository.pluginHealth.list(), repository.listings.listToScan()]);
      return reply.code(HttpStatus.Ok).send([...runtime().plugins({ health, scanned, now: clock.now() })]);
    },
  });

  server.route({
    ...apiRoutes.startScan,
    handler: async (_request, reply) => {
      if (runtime().stopping()) {
        return reply.code(shuttingDown.status).send(shuttingDown.body);
      }
      if (runtime().restarting()) {
        return reply.code(restarting.status).send(restarting.body);
      }
      if (runtime().scans().scanning()) {
        const { status, body } = failure(HttpStatus.Conflict, ApiErrorKind.ScanRunning, Message.ScanRunning);
        return reply.code(status).send(body);
      }
      void runScan();
      return reply.code(HttpStatus.Accepted).send(await scanStatus());
    },
  });

  server.route({
    ...apiRoutes.getScan,
    handler: async (_request, reply) => reply.code(HttpStatus.Ok).send(await scanStatus()),
  });

  server.route({
    ...apiRoutes.listGear,
    handler: async (_request, reply) => reply.code(HttpStatus.Ok).send(await listGear(runtime().gear())),
  });

  server.route({
    ...apiRoutes.addGear,
    handler: async ({ body }, reply) => {
      if (runtime().restarting()) {
        return reply.code(restarting.status).send(restarting.body);
      }
      const added = await addGear(runtime().gear(), body);
      return added.ok
        ? reply.code(HttpStatus.Created).send(added.value)
        : reply.code(invalidSpecs.status).send(invalidSpecs.body);
    },
  });

  server.route({
    ...apiRoutes.updateGear,
    handler: async ({ params: { gearId }, body }, reply) => {
      if (runtime().restarting()) {
        return reply.code(restarting.status).send(restarting.body);
      }
      const updated = await updateGear(runtime().gear(), gearId, body);
      if (updated.ok) {
        return reply.code(HttpStatus.Ok).send(updated.value);
      }
      const { status, body: refusal } = updated.error.kind === GearErrorKind.InvalidSpecs ? invalidSpecs : gearNotFound;
      return reply.code(status).send(refusal);
    },
  });

  server.route({
    ...apiRoutes.removeGear,
    handler: async ({ params: { gearId } }, reply) => {
      const removed = await removeGear(runtime().gear(), gearId);
      return removed.ok
        ? reply.code(HttpStatus.NoContent).send(null)
        : reply.code(gearNotFound.status).send(gearNotFound.body);
    },
  });

  server.route({
    ...apiRoutes.searchCatalog,
    handler: async ({ query: { q } }, reply) => {
      if (runtime().restarting()) {
        return reply.code(restarting.status).send(restarting.body);
      }
      const gear = runtime().gear();
      const { matches, failedPlugins } = await searchCatalog(gear, q);
      return reply.code(HttpStatus.Ok).send({ matches, failedPlugins, catalogs: gear.catalogs.plugins().length });
    },
  });

  server.route({
    ...apiRoutes.readSpecs,
    handler: async ({ body: { kind, text } }, reply) => {
      const read = await runtime().specReader().read(kind, text);
      if (read.ok) {
        return reply.code(HttpStatus.Ok).send(read.value);
      }
      const { status, body } = read.error.kind === LlmErrorKind.Unavailable
        ? failure(HttpStatus.ServiceUnavailable, read.error.kind, Message.ReaderUnavailable)
        : failure(HttpStatus.BadGateway, read.error.kind, Message.ReaderMalformed);
      return reply.code(status).send(body);
    },
  });

  return {
    attach: (next) => {
      attached = next;
    },
  };
};
