import { apiRoutes } from "@fpving/app/api-routes";
import { apiErrorSchema } from "@fpving/app/errors";
import type { ApiErrorKind } from "@fpving/app/errors";
import { HttpStatus } from "@fpving/app/http-status";
import { createContext, useContext } from "react";
import { z } from "zod";

/**
 * Failures the UI itself detects: the server could not be reached, it answered outside its schemas, or something
 * else went wrong on the page.
 */
export const ClientErrorKind = {
  Unreachable: "unreachable",
  BadResponse: "bad_response",
  Unexpected: "unexpected",
} as const;

/** What a failed call reports: one of the server's error kinds or a {@link ClientErrorKind}. */
export type FailureKind = ApiErrorKind | (typeof ClientErrorKind)[keyof typeof ClientErrorKind];

const Message = {
  Unreachable: "fpving is not reachable; is it running?",
  BadResponse: "fpving answered something this page does not understand; reload it",
} as const;

/** A failed call: the server's error kind and message, or a {@link ClientErrorKind}. */
export class ApiFailure extends Error {
  readonly kind: FailureKind;

  constructor(kind: FailureKind, message: string) {
    super(message);
    this.kind = kind;
  }
}

const UNEXPECTED = "something unexpected went wrong on this page";

/**
 * The failure behind a thrown value: itself when it is an {@link ApiFailure}, otherwise an `unexpected` one.
 *
 * @param error - What was thrown.
 * @returns The failure to show.
 */
export const toFailure = (error: unknown): ApiFailure =>
  error instanceof ApiFailure ? error : new ApiFailure(ClientErrorKind.Unexpected, UNEXPECTED);

/** The transport: `fetch`, or a fake in tests. */
export type Fetch = (path: string, init: RequestInit) => Promise<Response>;

interface Route {
  readonly method: string;
  readonly url: string;
}

interface Request {
  readonly query?: Readonly<Record<string, string | undefined>>;
  readonly body?: unknown;
}

const badResponse = (): ApiFailure => new ApiFailure(ClientErrorKind.BadResponse, Message.BadResponse);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Turns the ISO strings JSON carries back into the dates `schema` expects, walking the value along the schema. A
 * shape it does not know is left as it is, so the parse that follows still rejects anything wrong.
 *
 * @param schema - The schema the value is parsed with next.
 * @param value - The parsed JSON.
 * @returns The value with its dates revived.
 */
export const reviveDates = (schema: z.core.$ZodType, value: unknown): unknown => {
  if (schema instanceof z.ZodDate) {
    return typeof value === "string" ? new Date(value) : value;
  }
  if (schema instanceof z.ZodNullable) {
    return value === null ? value : reviveDates(schema.unwrap(), value);
  }
  if (schema instanceof z.ZodArray) {
    return Array.isArray(value) ? value.map((item: unknown) => reviveDates(schema.element, item)) : value;
  }
  if (schema instanceof z.ZodObject && isRecord(value)) {
    const shape: Readonly<Record<string, z.core.$ZodType | undefined>> = schema.shape;
    return Object.fromEntries(Object.entries(value).map(([key, field]) => {
      const fieldSchema = shape[key];
      return [key, fieldSchema === undefined ? field : reviveDates(fieldSchema, field)];
    }));
  }
  return value;
};

const readJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    throw badResponse();
  }
};

const send = async <S extends z.ZodType>(
  fetcher: Fetch,
  route: Route,
  success: S,
  request: Request = {},
): Promise<z.output<S>> => {
  const query = Object.entries(request.query ?? {})
    .flatMap(([key, value]) => (value === undefined ? [] : [[key, value]]));
  const path = query.length === 0 ? route.url : `${route.url}?${new URLSearchParams(query).toString()}`;
  const init: RequestInit = request.body === undefined
    ? { method: route.method }
    : { method: route.method, headers: { "content-type": "application/json" }, body: JSON.stringify(request.body) };
  const response = await fetcher(path, init).catch(() => {
    throw new ApiFailure(ClientErrorKind.Unreachable, Message.Unreachable);
  });
  const json = readJson(await response.text());
  if (response.ok) {
    const parsed = success.safeParse(reviveDates(success, json));
    if (parsed.success) {
      return parsed.data;
    }
    throw badResponse();
  }
  const failure = apiErrorSchema.safeParse(json);
  if (failure.success) {
    throw new ApiFailure(failure.data.error.kind, failure.data.error.message);
  }
  throw badResponse();
};

/**
 * The typed API client. Request types come from the route table's schemas, and every answer is parsed with the
 * route's schema for its status: the server is a trust boundary for the browser too. A failed call throws an
 * {@link ApiFailure}.
 *
 * @param fetcher - The transport.
 * @returns One function per route the UI calls.
 */
export const createClient = (fetcher: Fetch) => ({
  listProducts: async () =>
    send(fetcher, apiRoutes.listProducts, apiRoutes.listProducts.schema.response[HttpStatus.Ok]),
  addProduct: async (body: z.input<typeof apiRoutes.addProduct.schema.body>) =>
    send(fetcher, apiRoutes.addProduct, apiRoutes.addProduct.schema.response[HttpStatus.Created], { body }),
  listAlerts: async (query: z.input<typeof apiRoutes.listAlerts.schema.querystring>) =>
    send(fetcher, apiRoutes.listAlerts, apiRoutes.listAlerts.schema.response[HttpStatus.Ok], { query }),
});

/** The client the screens call. */
export type Client = ReturnType<typeof createClient>;

/** The client over the browser's `fetch`. */
export const browserClient = createClient(globalThis.fetch.bind(globalThis));

/** The client in use; tests provide one over a fake transport. */
export const ClientContext = createContext<Client>(browserClient);

/**
 * The client in use.
 *
 * @returns The client from {@link ClientContext}.
 */
export const useClient = (): Client => useContext(ClientContext);
