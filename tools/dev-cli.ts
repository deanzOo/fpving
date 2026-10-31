import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { devProxy } from "./dev-proxy.ts";

const repo = new URL("..", import.meta.url);
const server = await createServer({
  configFile: fileURLToPath(new URL("apps/ui/vite.config.ts", repo)),
  root: fileURLToPath(new URL("apps/ui", repo)),
  server: { proxy: devProxy(fileURLToPath(new URL(".env", repo)), process.env) },
});
await server.listen();
server.printUrls();
server.bindCLIShortcuts({ print: true });
