import { fileURLToPath } from "node:url";
import { writeTokensCss } from "./design-tokens.ts";

await writeTokensCss(fileURLToPath(new URL("../apps/ui/src/tokens.css", import.meta.url)));
