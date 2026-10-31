import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { apiError, ApiErrorKind } from "../../src/server/errors.ts";
import { HttpStatus } from "../../src/server/http-status.ts";
import { CONTENT_SECURITY_POLICY, createServer, NO_ROUTE, UI_NOT_BUILT } from "../../src/server/server.ts";
import type { AppServer } from "../../src/server/server.ts";
import { recordingLogger } from "../support/recording-logger.ts";

const PORT = 4321;
const HOST = { host: `127.0.0.1:${String(PORT)}` };
const INDEX = "<!doctype html><title>fpving</title><script type=\"module\" src=\"/assets/app.js\"></script>";
const SCRIPT = "export {};";
const API_ROUTE = "/api/test/data";

describe("Serving the UI", () => {
  let root: string;
  let ready = true;
  let server: AppServer;

  const start = async (uiRoot: string) => {
    const logger = recordingLogger();
    server = createServer({ port: PORT, logger, isReady: () => ready, openWhileStarting: [], uiRoot });
    server.get(API_ROUTE, () => ({ data: true }));
    await server.ready();
  };

  const get = async (url: string, headers: Record<string, string> = HOST) =>
    server.inject({ method: "GET", url, headers });

  beforeEach(async () => {
    ready = true;
    root = mkdtempSync(join(tmpdir(), "fpving-ui-"));
    mkdirSync(join(root, "assets"));
    writeFileSync(join(root, "index.html"), INDEX);
    writeFileSync(join(root, "assets", "app.js"), SCRIPT);
    await start(root);
  });

  afterEach(async () => {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  });

  it("serves the built index page at the root", async () => {
    const response = await get("/");
    expect(response.statusCode).toBe(HttpStatus.Ok);
    expect(response.headers["content-type"]).toMatch(/^text\/html/u);
    expect(response.body).toBe(INDEX);
  });

  it("serves a built asset with its content type", async () => {
    const response = await get("/assets/app.js");
    expect(response.statusCode).toBe(HttpStatus.Ok);
    expect(response.headers["content-type"]).toMatch(/javascript/u);
    expect(response.body).toBe(SCRIPT);
  });

  it("answers a client route with the index page so the router can render it", async () => {
    const response = await get("/products/abc");
    expect(response.statusCode).toBe(HttpStatus.Ok);
    expect(response.body).toBe(INDEX);
  });

  it("answers an unknown API path with the 404 envelope, not the index page", async () => {
    const response = await get("/api/nope");
    expect(response.statusCode).toBe(HttpStatus.NotFound);
    expect(response.json()).toEqual(apiError(ApiErrorKind.NotFound, NO_ROUTE));
  });

  it("answers a non-GET request to a client route with the 404 envelope", async () => {
    const response = await server.inject({ method: "POST", url: "/products/abc", headers: HOST });
    expect(response.statusCode).toBe(HttpStatus.NotFound);
    expect(response.json()).toEqual(apiError(ApiErrorKind.NotFound, NO_ROUTE));
  });

  it("refuses a request for the UI addressed to another host with 421", async () => {
    for (const url of ["/", "/assets/app.js", "/products/abc"]) {
      const response = await get(url, { host: `evil.example:${String(PORT)}` });
      expect(response.statusCode).toBe(HttpStatus.MisdirectedRequest);
      expect(response.body).not.toContain(SCRIPT);
    }
  });

  it("serves the UI while the app is starting, while the API still answers 503", async () => {
    ready = false;
    expect((await get("/")).statusCode).toBe(HttpStatus.Ok);
    expect((await get("/assets/app.js")).statusCode).toBe(HttpStatus.Ok);
    expect((await get("/products/abc")).statusCode).toBe(HttpStatus.Ok);
    expect((await get(API_ROUTE)).statusCode).toBe(HttpStatus.ServiceUnavailable);
    expect((await get("/api/nope")).statusCode).toBe(HttpStatus.ServiceUnavailable);
  });

  it("keeps the readiness gate on an API path whose letters are percent-encoded", async () => {
    ready = false;
    expect((await get("/%61pi/test/data")).statusCode).toBe(HttpStatus.ServiceUnavailable);
    expect((await get("/%61pi/nope")).statusCode).toBe(HttpStatus.ServiceUnavailable);
  });

  it("answers an unknown percent-encoded API path with the 404 envelope, not the index page", async () => {
    const response = await get("/%61pi/nope");
    expect(response.statusCode).toBe(HttpStatus.NotFound);
    expect(response.json()).toEqual(apiError(ApiErrorKind.NotFound, NO_ROUTE));
  });

  it("sends a strict content security policy and no-sniff and no-referrer headers on every answer", async () => {
    for (const response of [await get("/"), await get("/assets/app.js"), await get(API_ROUTE), await get("/api/x")]) {
      expect(response.headers["content-security-policy"]).toBe(CONTENT_SECURITY_POLICY);
      expect(response.headers["x-content-type-options"]).toBe("nosniff");
      expect(response.headers["referrer-policy"]).toBe("no-referrer");
    }
    expect(CONTENT_SECURITY_POLICY).toContain("default-src 'self'");
    expect(CONTENT_SECURITY_POLICY).not.toContain("unsafe-inline");
  });

  it("says the UI is not built when its folder has no index page", async () => {
    await server.close();
    rmSync(join(root, "index.html"));
    await start(root);
    for (const url of ["/", "/products/abc"]) {
      const response = await get(url);
      expect(response.statusCode).toBe(HttpStatus.NotFound);
      expect(response.json()).toEqual(apiError(ApiErrorKind.NotFound, UI_NOT_BUILT));
    }
  });
});
