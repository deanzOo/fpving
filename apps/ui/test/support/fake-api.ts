import { apiRoutes } from "@fpving/app/api-routes";
import { alreadyTrackedError, apiError, ApiErrorKind } from "@fpving/app/errors";
import type { PlainErrorKind } from "@fpving/app/errors";
import { HttpStatus } from "@fpving/app/http-status";
import { AlertKind, alertIdSchema, listingIdSchema, productIdSchema, snapshotIdSchema, TREND_DAYS } from "@fpving/core";
import type { Alert, Product } from "@fpving/core";
import { z } from "zod";
import { createClient } from "../../src/client.ts";
import type { Fetch } from "../../src/client.ts";

interface SentRequest {
  readonly method: string;
  readonly path: string;
  readonly body: unknown;
}

type Answer = () => Response | Promise<Response>;

/** An answer encoded the way the server's serializer encodes it, so dates travel as ISO strings. */
export const reply = <S extends z.ZodType>(schema: S, data: z.output<S>, status: number = HttpStatus.Ok): Answer =>
  () => Response.json(z.encode(schema, data), { status });

/** An error envelope answer. */
export const failWith = (status: number, kind: PlainErrorKind, message: string): Answer =>
  () => Response.json(apiError(kind, message), { status });

/** The 409 `already_tracked` answer naming the product that tracks the URL. */
export const alreadyTracked = (id: string, name: string): Answer => () => Response.json(
  alreadyTrackedError({ id: productIdSchema.parse(id), name }, `already tracked by product ${id} "${name}"`),
  { status: HttpStatus.Conflict },
);

/** A client over a scripted in-memory transport: no network. Unscripted requests answer the 404 envelope. */
export const fakeApi = () => {
  const answers = new Map<string, Answer>();
  const sent: SentRequest[] = [];
  const fetcher: Fetch = async (path, init) => {
    const method = init.method ?? "GET";
    sent.push({ method, path, body: typeof init.body === "string" ? JSON.parse(init.body) : undefined });
    const unscripted = failWith(HttpStatus.NotFound, ApiErrorKind.NotFound, "unscripted");
    return (answers.get(`${method} ${path}`) ?? unscripted)();
  };
  const on = (route: { readonly method: string; readonly url: string }, answer: Answer, query = "") => {
    answers.set(`${route.method} ${route.url}${query}`, answer);
  };
  return { client: createClient(fetcher), on, sent };
};

/** A watched product as the server holds it. */
export const product = (id: string, name: string): Product => ({
  id: productIdSchema.parse(id),
  name,
  createdAt: new Date("2026-10-01T08:00:00.000Z"),
  archivedAt: null,
  cheapestListingId: listingIdSchema.parse(`${id}-l1`),
});

/** An unread alert on a product. */
export const unreadAlert = (id: string, productId: string): Alert => ({
  id: alertIdSchema.parse(id),
  productId: productIdSchema.parse(productId),
  listingId: listingIdSchema.parse(`${productId}-l1`),
  kind: AlertKind.PriceDrop,
  beforeSnapshotId: null,
  afterSnapshotId: snapshotIdSchema.parse(`${id}-s`),
  createdAt: new Date("2026-10-30T08:00:00.000Z"),
  readAt: null,
});

/** A trend with no price on any day. */
export const emptyTrend = (): null[] => Array.from({ length: TREND_DAYS }, () => null);

/** The schemas of the answers the screens read. */
export const wire = {
  watchlist: apiRoutes.listProducts.schema.response[HttpStatus.Ok],
  added: apiRoutes.addProduct.schema.response[HttpStatus.Created],
  alerts: apiRoutes.listAlerts.schema.response[HttpStatus.Ok],
} as const;
