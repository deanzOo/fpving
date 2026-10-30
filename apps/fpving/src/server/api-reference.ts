import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import { apiRoutes } from "./api-routes.js";
import { apiErrorSchema } from "./errors.js";

const FRONTMATTER = [
  "---",
  "title: HTTP API",
  "description: Every route of the local JSON API, with its request and response schemas.",
  "---",
  "",
  "Generated from the Zod route schemas on every docs build. Do not edit by hand.",
  "",
  "Every route answers JSON on `http://127.0.0.1:<PORT>` and sits behind the localhost `Host` and `Origin` guards and",
  "the readiness gate (503 while starting). Every error answers `{ \"error\": { \"kind\", \"message\" } }`.",
  "",
  "A product is created only from a pasted store URL; there is no create by name or search query. Deleting a",
  "product archives it, keeping its history, and it then answers 404 on every product route. Removing a listing",
  "keeps its history too, but it is never scanned again and counts for no price or alert. While a settings change",
  "restarts the plugins or the scan schedule, the routes that need them answer 503 `restarting`.",
  "",
].join("\n");

const JSON_INDENT = 2;
const REQUEST_PARTS = ["params", "querystring", "body"] as const;

interface RouteSchemas {
  readonly params?: z.ZodType;
  readonly querystring?: z.ZodType;
  readonly body?: z.ZodType;
  readonly response: Readonly<Record<number, z.ZodType>>;
}

const toJson = (schema: z.ZodType, io: "input" | "output"): string =>
  JSON.stringify(z.toJSONSchema(schema, {
    io,
    reused: "ref",
    unrepresentable: "any",
    override: ({ zodSchema, jsonSchema }) => {
      if (zodSchema._zod.def.type === "date") {
        Object.assign(jsonSchema, { type: "string", format: "date-time" });
      }
    },
  }), null, JSON_INDENT);

const block = (title: string, json: string): string => `#### ${title}\n\n\`\`\`json\n${json}\n\`\`\`\n`;

const ENVELOPE = "The error envelope.";

const envelopeSection = `## Error envelope\n\nEvery error answer below.\n\n${
  block("Response", toJson(apiErrorSchema, "output"))
}`;

const renderRoute = (method: string, url: string, summary: string, schema: RouteSchemas): string => {
  const request = REQUEST_PARTS.flatMap((part) => {
    const partSchema = schema[part];
    return partSchema === undefined ? [] : [block(`Request ${part}`, toJson(partSchema, "input"))];
  });
  const responses = Object.entries(schema.response).map(([status, response]) => response === apiErrorSchema
    ? `#### Response ${status}\n\n${ENVELOPE}\n`
    : block(`Response ${status}`, toJson(response, "output")));
  return [`## ${method} ${url}\n\n${summary}\n`, ...request, ...responses].join("\n");
};

/**
 * Renders the HTTP API reference page from {@link apiRoutes}: the error envelope once, then one section per route
 * with the JSON Schema of each request part and of each answer, an error answer naming the envelope. A sub-schema
 * repeated within one schema is shown once under `$defs`. Dates are ISO 8601 strings on the wire.
 *
 * @returns The Markdown page with its Starlight frontmatter.
 */
export const renderApiReference = (): string =>
  `${FRONTMATTER}\n${[envelopeSection, ...Object.values(apiRoutes).map(({ method, url, summary, schema }) =>
    renderRoute(method, url, summary, schema))].join("\n")}`;

/**
 * Writes {@link renderApiReference} to `output`, creating its folder.
 *
 * @param output - The page path.
 */
export const writeApiReference = async (output: string): Promise<void> => {
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, renderApiReference());
};
