import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export const FIXTURE_HTML = [
  "<!doctype html><html><body><h1 id=\"title\">static</h1><script>",
  "document.getElementById(\"title\").textContent=\"rendered\";",
  "</script></body></html>",
].join("");

export const NOT_FOUND = 404;
export const FOUND = 302;
const OK = 200;

export interface LocalServer {
  readonly origin: string;
  /** The path of every request the server received, in order. */
  readonly requests: readonly string[];
  close(): Promise<void>;
}

const leakyPage = (target: string): string => [
  `<!doctype html><html><body><img src="${target}/pixel"><script src="${target}/script.js"></script>`,
  `<script>fetch("${target}/fetch").catch(() => undefined);</script></body></html>`,
].join("");

const respond = (request: IncomingMessage, response: ServerResponse): void => {
  const url = new URL(request.url ?? "/", "http://fixture");
  const target = url.searchParams.get("target") ?? "";
  switch (url.pathname) {
    case "/leaky":
      response.writeHead(OK, { "content-type": "text/html; charset=utf-8" });
      response.end(leakyPage(target));
      return;
    case "/redirect-to":
      response.writeHead(FOUND, { location: target });
      response.end();
      return;
    case "/page":
      response.writeHead(OK, { "content-type": "text/html; charset=utf-8", "x-fixture": "yes" });
      response.end(FIXTURE_HTML);
      return;
    case "/redirect":
      response.writeHead(FOUND, { location: "/page" });
      response.end();
      return;
    case "/echo-user-agent":
      response.writeHead(OK, { "content-type": "text/plain" });
      response.end(request.headers["user-agent"] ?? "");
      return;
    case "/hang":
      return;
    default:
      response.writeHead(NOT_FOUND, { "content-type": "text/plain" });
      response.end("nothing here");
  }
};

const listen = async (server: Server): Promise<string> =>
  new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address: AddressInfo | string | null = server.address();
      resolve(typeof address === "object" && address ? `http://127.0.0.1:${String(address.port)}` : "");
    });
  });

/**
 * Serves the fixture page, a redirect to it, a user agent echo, a 404, a request that never answers, a page whose
 * subresources load from `?target=` and a redirect to `?target=`.
 */
export const startLocalServer = async (): Promise<LocalServer> => {
  const requests: string[] = [];
  const server = createServer((request, response) => {
    requests.push(request.url ?? "");
    respond(request, response);
  });
  const origin = await listen(server);
  return {
    origin,
    requests,
    close: async () =>
      new Promise((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      }),
  };
};
