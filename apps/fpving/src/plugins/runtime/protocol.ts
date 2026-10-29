import {
  countryCodeSchema,
  currencyCodeSchema,
  err,
  manifestSchema,
  ok,
  StoreErrorKind,
  storeErrorSchema,
} from "@fpving/plugin-sdk";
import type { Result } from "@fpving/plugin-sdk";
import { z } from "zod";
import { PluginIssueKind } from "../status.js";

/** The `type` of every message between the host and a plugin worker. */
export const MessageType = {
  Call: "call",
  CapabilityResult: "capability-result",
  Ready: "ready",
  LoadFailed: "load-failed",
  CallResult: "call-result",
  CapabilityCall: "capability-call",
  Log: "log",
} as const;

/** The store methods the host calls in a worker. */
export const CallMethod = { FetchListing: "fetchListing", Search: "search" } as const;

/** The host capabilities a worker calls. */
export const Capability = { HttpGet: "http.get", BrowserFetchPage: "browser.fetchPage" } as const;

/** The logger methods a worker forwards. */
export const LogMethod = { Debug: "debug", Info: "info", Warn: "warn", Error: "error" } as const;

const idSchema = z.int().nonnegative();

const resultOf = <T extends z.ZodType, E extends z.ZodType>(value: T, error: E) =>
  z.discriminatedUnion("ok", [z.object({ ok: z.literal(true), value }), z.object({ ok: z.literal(false), error })]);

const transportErrorSchema = z.object({
  kind: z.enum([StoreErrorKind.Timeout, StoreErrorKind.Network]),
  detail: z.string(),
});

const httpResponseSchema = z.object({ status: z.int(), body: z.string(), headers: z.record(z.string(), z.string()) });

const browserPageSchema = z.object({ status: z.int(), html: z.string(), finalUrl: z.string() });

const callRequestSchema = z.discriminatedUnion("method", [
  z.object({ method: z.literal(CallMethod.FetchListing), url: z.string() }),
  z.object({
    method: z.literal(CallMethod.Search),
    query: z.object({ text: z.string(), brand: z.string().exactOptional(), model: z.string().exactOptional() }),
  }),
]);

const capabilityCallSchema = z.discriminatedUnion("capability", [
  z.object({
    capability: z.literal(Capability.HttpGet),
    url: z.string(),
    options: z.object({ headers: z.record(z.string(), z.string()).exactOptional() }).exactOptional(),
  }),
  z.object({ capability: z.literal(Capability.BrowserFetchPage), url: z.string() }),
]);

const capabilityResultSchema = z.discriminatedUnion("capability", [
  z.object({ capability: z.literal(Capability.HttpGet), value: resultOf(httpResponseSchema, transportErrorSchema) }),
  z.object({
    capability: z.literal(Capability.BrowserFetchPage),
    value: resultOf(browserPageSchema, transportErrorSchema),
  }),
]);

const hostMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal(MessageType.Call), id: idSchema, request: callRequestSchema }),
  z.object({ type: z.literal(MessageType.CapabilityResult), id: idSchema, result: capabilityResultSchema }),
]);

const workerMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal(MessageType.Ready), manifest: manifestSchema }),
  z.object({
    type: z.literal(MessageType.LoadFailed),
    issue: z.object({
      kind: z.enum([PluginIssueKind.LoadFailed, PluginIssueKind.ManifestInvalid]),
      detail: z.string(),
    }),
  }),
  z.object({ type: z.literal(MessageType.CallResult), id: idSchema, result: z.unknown() }),
  z.object({ type: z.literal(MessageType.CapabilityCall), id: idSchema, call: capabilityCallSchema }),
  z.object({
    type: z.literal(MessageType.Log),
    level: z.enum(LogMethod),
    message: z.string(),
    fields: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).exactOptional(),
  }),
]);

const workerDataSchema = z.object({
  entry: z.union([z.strictObject({ path: z.string() }), z.strictObject({ package: z.string() })]),
  shipTo: countryCodeSchema,
  currencyPreference: currencyCodeSchema,
});

/** A store call the host sends to a worker. */
export type CallRequest = z.infer<typeof callRequestSchema>;
/** A capability call a worker sends to the host. */
export type CapabilityCall = z.infer<typeof capabilityCallSchema>;
/** The host's answer to a {@link CapabilityCall}. */
export type CapabilityResult = z.infer<typeof capabilityResultSchema>;
/** A message from the host to a worker. */
export type HostMessage = z.infer<typeof hostMessageSchema>;
/** A message from a worker to the host. */
export type WorkerMessage = z.infer<typeof workerMessageSchema>;
/** What the host starts a worker with. */
export type WorkerData = z.infer<typeof workerDataSchema>;

const parseWith = <T extends z.ZodType>(schema: T, what: string) => (raw: unknown): Result<z.output<T>, string> => {
  const parsed = schema.safeParse(raw);
  return parsed.success ? ok(parsed.data) : err(`malformed ${what}: ${z.prettifyError(parsed.error)}`);
};

/** Validates a message received from a worker; never throws. */
export const parseWorkerMessage = parseWith(workerMessageSchema, "worker message");

/** Validates a message received from the host; never throws. */
export const parseHostMessage = parseWith(hostMessageSchema, "host message");

/** Validates the data a worker was started with; never throws. */
export const parseWorkerData = parseWith(workerDataSchema, "worker data");

/** Validates what a store method resolved to, given the schema of its success value. */
export const storeResultSchema = <T extends z.ZodType>(value: T) => resultOf(value, storeErrorSchema);
