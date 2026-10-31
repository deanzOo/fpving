import { existsSync } from "node:fs";
import { join } from "node:path";
import { inspect } from "node:util";
import type { Logger } from "@fpving/core";
import fastifyStatic from "@fastify/static";
import fastify from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { apiError, ApiErrorKind } from "./errors.js";
import { HttpStatus } from "./http-status.js";

/** The only address the server binds. */
export const LOOPBACK_HOST = "127.0.0.1";

/** The largest request body accepted, 64 KiB; JSON commands are far smaller. */
export const MAX_REQUEST_BODY_BYTES = 65_536;

/** The bodies of guard refusals. */
export const GuardRefusal = {
  Host: "the Host header must name this server on 127.0.0.1 or localhost",
  Origin: "cross-origin requests that change state are refused",
} as const;

/** What a route answers while the app is still starting. */
export const STARTING = "fpving is starting";

/** What a client error the app did not classify answers; its message goes to the log only. */
export const CLIENT_ERROR = "request refused";

/** What an unexpected error answers; the detail goes to the log only. */
export const INTERNAL_ERROR = "internal error";

/** What a path no route serves answers. */
export const NO_ROUTE = "no route serves this method and path";

/** What a UI path answers when the UI folder has no index page. */
export const UI_NOT_BUILT = "the UI is not built; run pnpm build";

/** The policy every answer carries: only this origin's own scripts, styles and requests, and no framing. */
export const CONTENT_SECURITY_POLICY
  = "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'";

const SECURITY_HEADERS = {
  "content-security-policy": CONTENT_SECURITY_POLICY,
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
} as const;

const INDEX_PAGE = "index.html";

const isApiPath = (url: string): boolean => /^\/api(?:[/?]|$)/u.test(url);

const LOCAL_HOSTNAMES = [LOOPBACK_HOST, "localhost"] as const;
const READ_METHODS: readonly string[] = ["GET", "HEAD", "OPTIONS"];
const HTTP_SCHEME = "http://";
const CROSS_SITE_FETCHES: readonly string[] = ["cross-site", "same-site"];
const FASTIFY_ERROR_CODE = "FST_";

/** What {@link createServer} needs. */
export interface ServerOptions {
  /** The port the server listens on, which a request's Host header must name. */
  readonly port: number;
  /** Where unexpected errors are logged. */
  readonly logger: Logger;
  /** Whether startup finished; until then only {@link ServerOptions.openWhileStarting} routes answer. */
  readonly isReady: () => boolean;
  /** Paths served while starting, such as the health route. */
  readonly openWhileStarting: readonly string[];
  /** The built UI's folder, served on every non-API GET; the index page answers paths no file matches. */
  readonly uiRoot?: string;
}

const FIRST_CLIENT_ERROR = 400;
const clientErrorSchema = z.object({
  statusCode: z.int().min(FIRST_CLIENT_ERROR).max(HttpStatus.InternalServerError - 1),
  message: z.string(),
  code: z.string().optional(),
});

/**
 * Creates the Fastify server with the Zod type provider, the localhost guards and a readiness gate, without routes.
 * Until `isReady()` is true every `/api` path but those in `openWhileStarting`, unknown ones included, answers 503 with
 * {@link STARTING}, after the guards; the UI is served meanwhile. With `uiRoot`, a GET outside `/api` serves the file
 * it names from that folder, or the index page when none matches, or {@link UI_NOT_BUILT} when the folder has no
 * index page. Every answer carries {@link CONTENT_SECURITY_POLICY}, `nosniff` and `no-referrer`. A request whose
 * Host header is not `127.0.0.1:<port>` or `localhost:<port>` is refused with 421, which defeats DNS rebinding. A
 * request with a method other than GET, HEAD or OPTIONS that carries an `Origin` other than its own is refused with
 * 403, and so is one without `Origin` whose `Sec-Fetch-Site` is `cross-site` or `same-site`; one with neither, such as
 * from curl, is served. No CORS header is ever sent. Bodies over {@link MAX_REQUEST_BODY_BYTES} get 413. A 4xx error
 * Fastify raised (validation, body limit, content type) answers its message; another 4xx keeps its status, answers
 * {@link CLIENT_ERROR} and logs its message; any other error answers 500 with {@link INTERNAL_ERROR} and logs it. An
 * unknown path answers 404. Every refusal is an {@link apiError} envelope.
 *
 * @param options - The port, the logger, the readiness check and the UI folder.
 * @returns The server, not yet listening.
 */
export const createServer = (options: ServerOptions) => {
  const { port, logger, isReady, openWhileStarting, uiRoot } = options;
  const allowedHosts: readonly string[] = LOCAL_HOSTNAMES.map((name) => `${name}:${String(port)}`);
  const server = fastify({ logger: false, bodyLimit: MAX_REQUEST_BODY_BYTES }).withTypeProvider<ZodTypeProvider>();
  server.setValidatorCompiler(validatorCompiler);
  server.setSerializerCompiler(serializerCompiler);
  server.addHook("onRequest", async (request, reply) => {
    reply.headers(SECURITY_HEADERS);
    const host = request.host.toLowerCase();
    if (!allowedHosts.includes(host)) {
      const refusal = apiError(ApiErrorKind.MisdirectedRequest, GuardRefusal.Host);
      return reply.status(HttpStatus.MisdirectedRequest).send(refusal);
    }
    const { origin } = request.headers;
    const site = request.headers["sec-fetch-site"] ?? "";
    const foreign = origin === undefined ? CROSS_SITE_FETCHES.includes(site) : origin !== `${HTTP_SCHEME}${host}`;
    if (!READ_METHODS.includes(request.method) && foreign) {
      return reply.status(HttpStatus.Forbidden).send(apiError(ApiErrorKind.CrossOrigin, GuardRefusal.Origin));
    }
    if (!isReady() && isApiPath(request.url) && !openWhileStarting.includes(request.routeOptions.url ?? "")) {
      return reply.status(HttpStatus.ServiceUnavailable).send(apiError(ApiErrorKind.Starting, STARTING));
    }
    return undefined;
  });
  server.setErrorHandler(async (error, request, reply) => {
    const client = clientErrorSchema.safeParse(error);
    if (client.success) {
      const { statusCode, message, code } = client.data;
      if (code?.startsWith(FASTIFY_ERROR_CODE) === true) {
        return reply.status(statusCode).send(apiError(ApiErrorKind.InvalidRequest, message));
      }
      logger.warn("request refused", { method: request.method, url: request.url, statusCode, detail: message });
      return reply.status(statusCode).send(apiError(ApiErrorKind.RequestRefused, CLIENT_ERROR));
    }
    logger.error("request failed", { method: request.method, url: request.url, detail: inspect(error) });
    return reply.status(HttpStatus.InternalServerError).send(apiError(ApiErrorKind.Internal, INTERNAL_ERROR));
  });
  if (uiRoot !== undefined) {
    void server.register(fastifyStatic, { root: uiRoot });
  }
  server.setNotFoundHandler(async (request, reply) => {
    if (uiRoot === undefined || request.method !== "GET" || isApiPath(request.url)) {
      return reply.status(HttpStatus.NotFound).send(apiError(ApiErrorKind.NotFound, NO_ROUTE));
    }
    if (!existsSync(join(uiRoot, INDEX_PAGE))) {
      return reply.status(HttpStatus.NotFound).send(apiError(ApiErrorKind.NotFound, UI_NOT_BUILT));
    }
    return reply.sendFile(INDEX_PAGE);
  });
  return server;
};

/** The server {@link createServer} returns. */
export type AppServer = ReturnType<typeof createServer>;
