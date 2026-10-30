import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import { apiRoutes } from "./api-routes.js";

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
    unrepresentable: "any",
    override: ({ zodSchema, jsonSchema }) => {
      if (zodSchema._zod.def.type === "date") {
        Object.assign(jsonSchema, { type: "string", format: "date-time" });
      }
    },
  }), null, JSON_INDENT);

const block = (title: string, json: string): string => `#### ${title}\n\n\`\`\`json\n${json}\n\`\`\`\n`;

const renderRoute = (method: string, url: string, summary: string, schema: RouteSchemas): string => {
  const request = REQUEST_PARTS.flatMap((part) => {
    const partSchema = schema[part];
    return partSchema === undefined ? [] : [block(`Request ${part}`, toJson(partSchema, "input"))];
  });
  const responses = Object.entries(schema.response).map(([status, response]) =>
    block(`Response ${status}`, toJson(response, "output")));
  return [`## ${method} ${url}\n\n${summary}\n`, ...request, ...responses].join("\n");
};

/**
 * Renders the HTTP API reference page from {@link apiRoutes}: one section per route with the JSON Schema of each
 * request part and of each answer. Dates are ISO 8601 strings on the wire.
 *
 * @returns The Markdown page with its Starlight frontmatter.
 */
export const renderApiReference = (): string =>
  `${FRONTMATTER}\n${Object.values(apiRoutes).map(({ method, url, summary, schema }) =>
    renderRoute(method, url, summary, schema)).join("\n")}`;

/**
 * Writes {@link renderApiReference} to `output`, creating its folder.
 *
 * @param output - The page path.
 */
export const writeApiReference = async (output: string): Promise<void> => {
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, renderApiReference());
};
