import { fileURLToPath } from "node:url";
import { initWorktree } from "./worktree-init.ts";

const result = await initWorktree(fileURLToPath(new URL("..", import.meta.url)));
console.log(
  result.status === "exists"
    ? ".env already exists, left untouched."
    : `Wrote .env: PORT=${String(result.port)}, DATA_DIR=${result.dataDir}.`,
);
