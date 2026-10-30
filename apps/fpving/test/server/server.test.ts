import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  createServer,
  GuardRefusal,
  HttpStatus,
  INTERNAL_ERROR,
  MAX_REQUEST_BODY_BYTES,
} from "../../src/server/server.ts";
import type { AppServer } from "../../src/server/server.ts";
import { recordingLogger } from "../support/recording-logger.ts";

const PORT = 4321;
const OK = 200;
const BAD_REQUEST = 400;
const NOT_FOUND = 404;
const TOO_LARGE = 413;
const ECHO = "/api/test/echo";
const BOOM = "/api/test/boom";
const SECRET_DETAIL = "database file /secret/path is locked";
const LOCAL = `127.0.0.1:${String(PORT)}`;
const LOCALHOST = `localhost:${String(PORT)}`;

describe("HTTP server shell", () => {
  let logger: ReturnType<typeof recordingLogger>;
  let server: AppServer;

  beforeEach(async () => {
    logger = recordingLogger();
    server = createServer({ port: PORT, logger });
    server.post(ECHO, { schema: { body: z.object({ text: z.string() }) } }, (request) => request.body);
    server.get(ECHO, () => ({ echoed: true }));
    server.get(BOOM, () => {
      throw new Error(SECRET_DETAIL);
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
      expect(response.json()).toEqual({ error: GuardRefusal.Host });
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
      expect(response.json()).toEqual({ text: "hi" });
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
      expect(response.json()).toEqual({ error: GuardRefusal.Origin });
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
      expect(z.object({ error: z.string() }).parse(response.json()).error).not.toBe("");
    });
  });

  describe("Errors", () => {
    it("answers an unexpected error with a generic 500 and logs the detail", async () => {
      const response = await server.inject({ method: "GET", url: BOOM, headers: { host: LOCAL } });
      expect(response.statusCode).toBe(HttpStatus.InternalServerError);
      expect(response.json()).toEqual({ error: INTERNAL_ERROR });
      expect(response.body).not.toContain(SECRET_DETAIL);
      expect(logger.events.map(({ level, message }) => ({ level, message }))).toEqual([
        { level: "error", message: "request failed" },
      ]);
      expect(loggedFailure.safeParse(logger.events[0]?.fields).success).toBe(true);
    });

    it("answers an unknown route with 404", async () => {
      const response = await server.inject({ method: "GET", url: "/api/nope", headers: { host: LOCAL } });
      expect(response.statusCode).toBe(NOT_FOUND);
    });
  });
});
