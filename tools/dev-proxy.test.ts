import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { IncomingMessage } from "node:http";
import { Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HttpStatus } from "../apps/fpving/src/server/http-status.ts";
import { createServer } from "../apps/fpving/src/server/server.ts";
import { recordingLogger } from "../apps/fpving/test/support/recording-logger.ts";
import { API_PREFIX, devProxy } from "./dev-proxy.ts";

const PORT = 4555;
const TARGET = `http://127.0.0.1:${String(PORT)}`;
const DEV_HOST = "localhost:5173";
const KEY = "sk-ant-secret-value";
const ECHO = "/api/test/echo";

const incoming = (headers: Record<string, string>): IncomingMessage => {
  const request = new IncomingMessage(new Socket());
  request.headers = headers;
  return request;
};

describe("Dev server proxy", () => {
  let dir: string;
  let envFile: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "fpving-dev-proxy-"));
    envFile = join(dir, ".env");
    await writeFile(envFile, `PORT=${String(PORT)}\nDATA_DIR=${dir}\nANTHROPIC_API_KEY=${KEY}\n`);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const proxyFor = (shell: Record<string, string | undefined> = {}) => devProxy(envFile, shell)[API_PREFIX];

  it("sends /api to the worktree's PORT from .env and rewrites the Host header to it", () => {
    expect(proxyFor()).toMatchObject({ target: TARGET, changeOrigin: true });
  });

  it("lets a variable set in the shell win over .env, as the app does", () => {
    const other = 4556;
    expect(proxyFor({ PORT: String(other) }).target).toBe(`http://127.0.0.1:${String(other)}`);
  });

  it("refuses to start on an invalid environment without echoing any value", async () => {
    await writeFile(envFile, `PORT=nope\nDATA_DIR=${dir}\nANTHROPIC_API_KEY=${KEY}\n`);
    expect(() => devProxy(envFile, {})).toThrow(/PORT/u);
    expect(() => devProxy(envFile, {})).not.toThrow(new RegExp(KEY, "u"));
  });

  it("says PORT is missing when the worktree has no .env", () => {
    expect(() => devProxy(join(dir, "missing.env"), {})).toThrow(/PORT/u);
  });

  describe("Against the server's guards", () => {
    const server = createServer({ port: PORT, logger: recordingLogger(), isReady: () => true, openWhileStarting: [] });
    server.post(ECHO, () => ({ ok: true }));

    const forwarded = async (origin: string | undefined) => {
      const request = incoming(origin === undefined ? { host: DEV_HOST } : { host: DEV_HOST, origin });
      proxyFor().bypass(request);
      const headers: Record<string, string> = { host: `127.0.0.1:${String(PORT)}` };
      if (request.headers.origin !== undefined) {
        headers["origin"] = request.headers.origin;
      }
      return server.inject({ method: "POST", url: ECHO, headers });
    };

    it("passes a change the dev page itself sends, by naming the server as its origin", async () => {
      expect((await forwarded(`http://${DEV_HOST}`)).statusCode).toBe(HttpStatus.Ok);
    });

    it("leaves another site's origin untouched, so the server still refuses it", async () => {
      expect((await forwarded("https://evil.example")).statusCode).toBe(HttpStatus.Forbidden);
    });

    it("adds no origin to a request that had none", async () => {
      expect((await forwarded(undefined)).statusCode).toBe(HttpStatus.Ok);
    });
  });
});
