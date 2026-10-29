import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { Duplex } from "node:stream";

export const FIXTURE_HTML = [
  "<!doctype html><html><body><h1 id=\"title\">static</h1><script>",
  "document.getElementById(\"title\").textContent=\"rendered\";",
  "</script></body></html>",
].join("");

/** A product page the fixture plugin reads: title, price in minor units and stock. */
export const FIXTURE_PRODUCT_HTML = [
  "<!doctype html><html><body><h1 class=\"title\">Fixture Frame</h1>",
  "<p class=\"price\" data-amount-minor=\"1999\" data-currency=\"USD\">$19.99</p><p>In stock</p></body></html>",
].join("");

/** A product page without a price, which the fixture plugin cannot parse. */
export const FIXTURE_BROKEN_HTML = [
  "<!doctype html><html><body>",
  "<h1 class=\"title\">Fixture Frame</h1></body></html>",
].join("");

const FIXTURE_SEARCH_HTML = [
  "<!doctype html><html><body><a class=\"result\" href=\"/fixture/product\">Fixture Frame</a>",
  "<a class=\"result\" href=\"/fixture/broken\">Fixture Frame v2</a></body></html>",
].join("");

/** The static pages the fixture plugin reads, by path. They never echo anything from the request. */
export const FixturePath = {
  Product: "/fixture/product",
  Broken: "/fixture/broken",
  Search: "/fixture/search",
} as const;

const FIXTURE_PAGES: Readonly<Record<string, string>> = {
  [FixturePath.Product]: FIXTURE_PRODUCT_HTML,
  [FixturePath.Broken]: FIXTURE_BROKEN_HTML,
  [FixturePath.Search]: FIXTURE_SEARCH_HTML,
};

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

const socketPage = (target: string): string => [
  `<!doctype html><html><body><script>const socket = new WebSocket("${target.replace(/^http/, "ws")}/socket");`,
  `socket.onclose = () => fetch("/socket-done").catch(() => undefined);</script></body></html>`,
].join("");

const POPUP_OPENER_HTML = "<!doctype html><html><body><script>window.open(\"/popup-target\");</script></body></html>";
const POPUP_TARGET_HTML = "<!doctype html><html><body>popup</body></html>";

const respond = (request: IncomingMessage, response: ServerResponse, target: string): void => {
  const url = new URL(request.url ?? "/", "http://fixture");
  const fixturePage = FIXTURE_PAGES[url.pathname];
  if (fixturePage !== undefined) {
    response.writeHead(OK, { "content-type": "text/html; charset=utf-8" });
    response.end(fixturePage);
    return;
  }
  switch (url.pathname) {
    case "/leaky":
      response.writeHead(OK, { "content-type": "text/html; charset=utf-8" });
      response.end(leakyPage(target));
      return;
    case "/popup-opener":
      response.writeHead(OK, { "content-type": "text/html; charset=utf-8" });
      response.end(POPUP_OPENER_HTML);
      return;
    case "/popup-target":
      response.writeHead(OK, { "content-type": "text/html; charset=utf-8" });
      response.end(POPUP_TARGET_HTML);
      return;
    case "/socket-page":
      response.writeHead(OK, { "content-type": "text/html; charset=utf-8" });
      response.end(socketPage(target));
      return;
    case "/redirect-to":
      response.writeHead(FOUND, { location: `${target}/page` });
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

export interface LocalServerOptions {
  /** The origin that `/leaky`, `/socket-page` and `/redirect-to` point at. */
  readonly target?: string;
}

/**
 * Serves the fixture page, the fixture plugin's product, unparseable product and search pages, a page that opens a
 * popup with `window.open`, a redirect to it, a user agent echo, a 404, a request that never answers, a page whose
 * subresources load from `options.target`, a page that opens a WebSocket to `options.target` and reports
 * `/socket-done` once it closes, and a redirect to `options.target`. WebSocket upgrades are logged as
 * `upgrade <path>` and refused.
 */
export const startLocalServer = async (options: LocalServerOptions = {}): Promise<LocalServer> => {
  const requests: string[] = [];
  const server = createServer((request, response) => {
    requests.push(request.url ?? "");
    respond(request, response, options.target ?? "");
  });
  server.on("upgrade", (request: IncomingMessage, socket: Duplex) => {
    requests.push(`upgrade ${request.url ?? ""}`);
    socket.destroy();
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
