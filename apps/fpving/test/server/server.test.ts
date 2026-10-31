import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  createServer,
  GuardRefusal,
  CLIENT_ERROR,
  HttpStatus,
  INTERNAL_ERROR,
  MAX_REQUEST_BODY_BYTES,
  NO_ROUTE,
  STARTING,
} from "../../src/server/server.ts";
import type { AppServer } from "../../src/server/server.ts";
import { apiError, ApiErrorKind, apiErrorSchema } from "../../src/server/errors.ts";
import { recordingLogger } from "../support/recording-logger.ts";

const PORT = 4321;
const OK = 200;
const BAD_REQUEST = 400;
const NOT_FOUND = 404;
const TOO_LARGE = 413;
const ECHO = "/api/test/echo";
const BOOM = "/api/test/boom";
const TEAPOT = "/api/test/teapot";
const OPEN = "/api/test/open";
const UNAVAILABLE = 503;
const SECRET_DETAIL = "database file /secret/path is locked";
const LOCAL = `127.0.0.1:${String(PORT)}`;
const LOCALHOST = `localhost:${String(PORT)}`;

describe("HTTP server shell", () => {
  let logger: ReturnType<typeof recordingLogger>;
  let server: AppServer;
  let ready = true;

  beforeEach(async () => {
    logger = recordingLogger();
    ready = true;
    server = createServer({ port: PORT, logger, isReady: () => ready, openWhileStarting: [OPEN] });
    server.get(OPEN, () => ({ open: true }));
    server.post(ECHO, { schema: { body: z.object({ text: z.string() }) } }, () => ({ accepted: true }));
    server.get(ECHO, () => ({ echoed: true }));
    server.get(BOOM, () => {
      throw new Error(SECRET_DETAIL);
    });
    server.get(TEAPOT, () => {
      throw Object.assign(new Error(SECRET_DETAIL), { statusCode: BAD_REQUEST });
    });
    await server.ready();
  });

  afterEach(async () => {
    await server.close();
  });

  const post = async (headers: Record<string, string>, payload: unknown = { text: "hi" }) =>
    server.inject({ method: "POST", url: ECHO, headers, payload: JSON.stringify(payload) });

  const json = { "content-type": "application/json" };
  const loggedFailure = z.object({
    method: z.literal("GET"),
    url: z.literal(BOOM),
    detail: z.string().includes(SECRET_DETAIL),
  });

  describe("Host header guard", () => {
    it.each([LOCAL, LOCALHOST, LOCALHOST.toUpperCase()])("serves a request addressed to %s", async (host) => {
      const response = await server.inject({ method: "GET", url: ECHO, headers: { host } });
      expect(response.statusCode).toBe(OK);
      expect(response.json()).toEqual({ echoed: true });
    });

    it.each([
      ["another port", "127.0.0.1:9999"],
      ["no port", "localhost"],
      ["a rebinding name", `evil.example:${String(PORT)}`],
      ["the any address", `0.0.0.0:${String(PORT)}`],
      ["the IPv6 loopback", `[::1]:${String(PORT)}`],
    ])("refuses a request addressed to %s with 421 before routing", async (_label, host) => {
      const response = await server.inject({ method: "GET", url: ECHO, headers: { host } });
      expect(response.statusCode).toBe(HttpStatus.MisdirectedRequest);
      expect(response.json()).toEqual(apiError(ApiErrorKind.MisdirectedRequest, GuardRefusal.Host));
    });
  });

  it("ignores X-Forwarded-Host, so a proxy header cannot vouch for a foreign Host", async () => {
    const headers = { "host": `evil.example:${String(PORT)}`, "x-forwarded-host": LOCAL };
    const response = await server.inject({ method: "GET", url: ECHO, headers });
    expect(response.statusCode).toBe(HttpStatus.MisdirectedRequest);
  });

  describe("Origin guard", () => {
    it("accepts a state-changing request with no Origin, such as from curl", async () => {
      const response = await post({ ...json, host: LOCAL });
      expect(response.statusCode).toBe(OK);
      expect(response.json()).toEqual({ accepted: true });
    });

    it.each(["cross-site", "same-site"])(
      "refuses a state-changing request without Origin whose Sec-Fetch-Site is %s with 403",
      async (site) => {
        const response = await post({ ...json, "host": LOCAL, "sec-fetch-site": site });
        expect(response.statusCode).toBe(HttpStatus.Forbidden);
        expect(response.json()).toEqual(apiError(ApiErrorKind.CrossOrigin, GuardRefusal.Origin));
      },
    );

    it.each(["same-origin", "none"])("accepts a state-changing request whose Sec-Fetch-Site is %s", async (site) => {
      const response = await post({ ...json, "host": LOCAL, "sec-fetch-site": site });
      expect(response.statusCode).toBe(OK);
    });

    it("accepts a state-changing request from the same origin", async () => {
      const response = await post({ ...json, host: LOCALHOST, origin: `http://${LOCALHOST}` });
      expect(response.statusCode).toBe(OK);
    });

    it.each([
      ["another site", "https://evil.example"],
      ["the other local name", `http://${LOCALHOST}`],
      ["https on the same host", `https://${LOCAL}`],
      ["an opaque origin", "null"],
    ])("refuses a state-changing request from %s with 403", async (_label, origin) => {
      const response = await post({ ...json, host: LOCAL, origin });
      expect(response.statusCode).toBe(HttpStatus.Forbidden);
      expect(response.json()).toEqual(apiError(ApiErrorKind.CrossOrigin, GuardRefusal.Origin));
    });

    it("serves a cross-origin read with no CORS header, so the browser hides the answer from that page", async () => {
      const response = await server.inject({
        method: "GET",
        url: ECHO,
        headers: { host: LOCAL, origin: "https://evil.example" },
      });
      expect(response.statusCode).toBe(OK);
      expect(Object.keys(response.headers).filter((name) => name.startsWith("access-control-"))).toEqual([]);
    });
  });

  describe("Request bodies", () => {
    it("refuses a body over the size limit with 413", async () => {
      const response = await post({ ...json, host: LOCAL }, { text: "x".repeat(MAX_REQUEST_BODY_BYTES) });
      expect(response.statusCode).toBe(TOO_LARGE);
    });

    it("rejects a body that fails the route schema with 400", async () => {
      const response = await post({ ...json, host: LOCAL }, { text: 1 });
      expect(response.statusCode).toBe(BAD_REQUEST);
      const { error } = apiErrorSchema.parse(response.json());
      expect(error.kind).toBe(ApiErrorKind.InvalidRequest);
      expect(error.message).toMatch(/text/u);
    });
  });

  describe("Readiness gate", () => {
    it("answers 503 on every route but the open ones until the app is ready", async () => {
      ready = false;
      const get = async (url: string) => server.inject({ method: "GET", url, headers: { host: LOCAL } });
      expect((await get(ECHO)).statusCode).toBe(UNAVAILABLE);
      expect((await get(ECHO)).json()).toEqual(apiError(ApiErrorKind.Starting, STARTING));
      expect((await get("/api/nope")).statusCode).toBe(UNAVAILABLE);
      expect((await get(`${OPEN}?probe=1`)).statusCode).toBe(OK);
      ready = true;
      expect((await get(ECHO)).statusCode).toBe(OK);
    });

    it("still refuses a foreign Host before answering that it is starting", async () => {
      ready = false;
      const response = await server.inject({ method: "GET", url: ECHO, headers: { host: "evil.example" } });
      expect(response.statusCode).toBe(HttpStatus.MisdirectedRequest);
    });
  });

  describe("Errors", () => {
    it("keeps the status of a 4xx error the app did not classify but hides its message", async () => {
      const response = await server.inject({ method: "GET", url: TEAPOT, headers: { host: LOCAL } });
      expect(response.statusCode).toBe(BAD_REQUEST);
      expect(response.json()).toEqual(apiError(ApiErrorKind.RequestRefused, CLIENT_ERROR));
      expect(response.body).not.toContain(SECRET_DETAIL);
      expect(logger.events.map(({ level, message }) => ({ level, message }))).toEqual([
        { level: "warn", message: "request refused" },
      ]);
    });

    it("answers an unexpected error with a generic 500 and logs the detail", async () => {
      const response = await server.inject({ method: "GET", url: BOOM, headers: { host: LOCAL } });
      expect(response.statusCode).toBe(HttpStatus.InternalServerError);
      expect(response.json()).toEqual(apiError(ApiErrorKind.Internal, INTERNAL_ERROR));
      expect(response.body).not.toContain(SECRET_DETAIL);
      expect(logger.events.map(({ level, message }) => ({ level, message }))).toEqual([
        { level: "error", message: "request failed" },
      ]);
      expect(loggedFailure.safeParse(logger.events[0]?.fields).success).toBe(true);
    });

    it("answers an unknown route with 404 in the error envelope", async () => {
      const response = await server.inject({ method: "GET", url: "/api/nope", headers: { host: LOCAL } });
      expect(response.statusCode).toBe(NOT_FOUND);
      expect(response.json()).toEqual(apiError(ApiErrorKind.NotFound, NO_ROUTE));
    });

    it("refuses a too large body in the error envelope", async () => {
      const response = await post({ ...json, host: LOCAL }, { text: "x".repeat(MAX_REQUEST_BODY_BYTES) });
      expect(apiErrorSchema.parse(response.json()).error.kind).toBe(ApiErrorKind.InvalidRequest);
    });
  });
});
