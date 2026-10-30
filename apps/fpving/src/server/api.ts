import { inspect } from "node:util";
import {
  acceptCandidate,
  addListing,
  addProduct,
  AddErrorKind,
  findMatches,
  markAllAlertsRead,
  MatchErrorKind,
  pendingCandidates,
  rejectCandidate,
} from "@fpving/core";
import type {
  AddProductError,
  FindMatchesError,
  MatchDeps,
  SchedulerDeps,
  SchedulerHandle,
  Settings,
} from "@fpving/core";
import { StoreErrorKind } from "@fpving/plugin-sdk";
import { GatewayRefusal } from "../plugins/store-gateway.js";
import { apiRoutes, RouteStatus } from "./api-routes.js";
import type { PluginRow, ScanStatus } from "./api-routes.js";
import { apiError, ApiErrorKind } from "./errors.js";
import type { AppServer } from "./server.js";

/** What the domain routes read on each request, once startup completed. */
export interface ApiRuntime {
  /** The ports core's use cases take, as they are now. */
  deps(): MatchDeps & SchedulerDeps;
  /** The running scan schedule. */
  scans(): SchedulerHandle;
  /** The plugins screen rows. */
  plugins(): readonly PluginRow[];
  /** Saves the settings and restarts what depends on them. */
  applySettings(settings: Settings): Promise<void>;
  /** Whether a settings change is restarting the schedule or the plugins right now. */
  restarting(): boolean;
}

/** What a route answers when it is reached before the runtime is attached; the readiness gate prevents that. */
export const NOT_ATTACHED = "the API runtime is not attached";

const EPOCH = new Date(0);

const Message = {
  InvalidUrl: "not an absolute http or https URL",
  ProductNotFound: "no product has this id",
  NotPending: "no pending match candidate has this id",
  AlertNotFound: "no alert has this id",
  NoSourceListing: "the product has no manually added listing to match from",
  AlreadySuggested: "another search saved candidates for this product meanwhile; search again",
  PluginUnavailable: "the plugin for this store is not loaded; see the plugins screen",
  ScanRunning: "a scan is already running",
  Restarting: "the plugins and the scan schedule are restarting for a settings change; try again shortly",
} as const;

const failure = <S extends (typeof RouteStatus)[keyof typeof RouteStatus]>(
  status: S,
  kind: ApiErrorKind,
  message: string,
) => ({ status, body: apiError(kind, message) });

const addFailure = (error: AddProductError) => {
  switch (error.kind) {
    case AddErrorKind.InvalidUrl:
      return failure(RouteStatus.UnprocessableContent, error.kind, Message.InvalidUrl);
    case AddErrorKind.NoPluginForDomain:
      return failure(RouteStatus.UnprocessableContent, error.kind, `no plugin handles ${error.host}`);
    case AddErrorKind.AlreadyTracked:
      return failure(RouteStatus.Conflict, error.kind, `already tracked by product ${error.listing.productId}`);
    case AddErrorKind.FetchFailed: {
      const { kind, detail } = error.error;
      return kind === StoreErrorKind.Network && detail === GatewayRefusal.Unavailable
        ? failure(RouteStatus.UnprocessableContent, ApiErrorKind.PluginUnavailable, Message.PluginUnavailable)
        : failure(RouteStatus.BadGateway, error.kind, `the store could not fetch the page: ${kind}`);
    }
  }
};

const matchFailure = (error: FindMatchesError) => {
  switch (error.kind) {
    case AddErrorKind.ProductNotFound:
      return failure(RouteStatus.NotFound, error.kind, Message.ProductNotFound);
    case MatchErrorKind.NoSourceListing:
      return failure(RouteStatus.Conflict, error.kind, Message.NoSourceListing);
    case MatchErrorKind.AlreadySuggested:
      return failure(RouteStatus.Conflict, error.kind, Message.AlreadySuggested);
  }
};

const productNotFound = failure(RouteStatus.NotFound, AddErrorKind.ProductNotFound, Message.ProductNotFound);
const notPending = failure(RouteStatus.NotFound, MatchErrorKind.NotPending, Message.NotPending);
const restarting = failure(RouteStatus.ServiceUnavailable, ApiErrorKind.Restarting, Message.Restarting);

/**
 * Registers every route of {@link apiRoutes}. Fastify takes routes only before `listen`, while the runtime exists
 * only once startup completed, so the handlers read it through the returned `attach`; the readiness gate keeps
 * requests away until then. Handlers call core's use cases or the repository and map each `Result` to a typed reply.
 * Only one scan the API started runs at a time; a second request while it runs answers 409.
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
  let scanning: Promise<void> | null = null;
  let lastResult: ScanStatus["lastResult"] = null;
  const scanStatus = async (): Promise<ScanStatus> => ({
    running: scanning !== null,
    latestRun: await deps().repository.scanRuns.latest(),
    lastResult,
  });
  const runScan = async (): Promise<void> => {
    const { logger, clock } = deps();
    try {
      const report = await runtime().scans().scanNow();
      if (!report.ok) {
        logger.warn("scan not started", { kind: report.error.kind });
        return;
      }
      const { plugins, alerts, transitions } = report.value;
      lastResult = { finishedAt: clock.now(), plugins, alerts: alerts.length, transitions: transitions.length };
    } catch (error) {
      logger.error("scan failed", { detail: inspect(error) });
    } finally {
      scanning = null;
    }
  };

  server.route({
    ...apiRoutes.getProduct,
    handler: async ({ params: { productId } }, reply) => {
      const { repository } = deps();
      const product = await repository.products.get(productId);
      if (product === null) {
        return reply.code(productNotFound.status).send(productNotFound.body);
      }
      const listings = await Promise.all((await repository.listings.listByProduct(productId)).map(async (listing) => ({
        listing,
        history: await repository.snapshots.listSince(listing.id, EPOCH),
      })));
      return reply.code(RouteStatus.Ok).send({ product, listings });
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
      return reply.code(RouteStatus.Created).send(added.value);
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
        return reply.code(RouteStatus.Created).send(added.value);
      }
      if (added.error.kind === AddErrorKind.ProductNotFound) {
        return reply.code(productNotFound.status).send(productNotFound.body);
      }
      const { status, body: refusal } = addFailure(added.error);
      return reply.code(status).send(refusal);
    },
  });

  server.route({
    ...apiRoutes.listCandidates,
    handler: async ({ params: { productId } }, reply) => {
      const pending = await pendingCandidates(deps(), productId);
      return pending.ok
        ? reply.code(RouteStatus.Ok).send(pending.value)
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
      return reply.code(RouteStatus.Ok).send(found.value);
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
        const { status, body } = accepted.error.kind === MatchErrorKind.NotPending
          ? notPending
          : addFailure(accepted.error);
        return reply.code(status).send(body);
      }
      return reply.code(RouteStatus.Created).send(accepted.value);
    },
  });

  server.route({
    ...apiRoutes.rejectCandidate,
    handler: async ({ params: { candidateId } }, reply) => {
      const rejected = await rejectCandidate(deps(), candidateId);
      if (!rejected.ok) {
        return reply.code(notPending.status).send(notPending.body);
      }
      return reply.code(RouteStatus.NoContent).send(null);
    },
  });

  server.route({
    ...apiRoutes.listAlerts,
    handler: async ({ query }, reply) => {
      const alerts = await deps().repository.alerts.list({ unreadOnly: query.unread === true });
      return reply.code(RouteStatus.Ok).send(alerts);
    },
  });

  server.route({
    ...apiRoutes.markAlertRead,
    handler: async ({ params: { alertId } }, reply) => {
      const { repository, clock } = deps();
      const marked = await repository.alerts.markRead(alertId, clock.now());
      if (!marked.ok) {
        const { status, body } = failure(RouteStatus.NotFound, ApiErrorKind.AlertNotFound, Message.AlertNotFound);
        return reply.code(status).send(body);
      }
      return reply.code(RouteStatus.NoContent).send(null);
    },
  });

  server.route({
    ...apiRoutes.markAllAlertsRead,
    handler: async (_request, reply) => reply.code(RouteStatus.Ok).send({ marked: await markAllAlertsRead(deps()) }),
  });

  server.route({
    ...apiRoutes.getSettings,
    handler: async (_request, reply) => reply.code(RouteStatus.Ok).send(await deps().repository.settings.get()),
  });

  server.route({
    ...apiRoutes.putSettings,
    handler: async ({ body }, reply) => {
      await runtime().applySettings(body);
      return reply.code(RouteStatus.Ok).send(body);
    },
  });

  server.route({
    ...apiRoutes.listPlugins,
    handler: async (_request, reply) => reply.code(RouteStatus.Ok).send([...runtime().plugins()]),
  });

  server.route({
    ...apiRoutes.startScan,
    handler: async (_request, reply) => {
      if (runtime().restarting()) {
        return reply.code(restarting.status).send(restarting.body);
      }
      if (scanning !== null) {
        const { status, body } = failure(RouteStatus.Conflict, ApiErrorKind.ScanRunning, Message.ScanRunning);
        return reply.code(status).send(body);
      }
      scanning = runScan();
      return reply.code(RouteStatus.Accepted).send(await scanStatus());
    },
  });

  server.route({
    ...apiRoutes.getScan,
    handler: async (_request, reply) => reply.code(RouteStatus.Ok).send(await scanStatus()),
  });

  return {
    attach: (next) => {
      attached = next;
    },
  };
};
