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
  close(): Promise<void>;
}

const respond = (request: IncomingMessage, response: ServerResponse): void => {
  switch (request.url) {
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

/** Serves the fixture page, a redirect to it, a user agent echo, a 404 and a request that never answers. */
export const startLocalServer = async (): Promise<LocalServer> => {
  const server = createServer(respond);
  const origin = await listen(server);
  return {
    origin,
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
