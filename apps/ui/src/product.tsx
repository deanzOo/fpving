import { ApiErrorKind } from "@fpving/app/errors";
import type { Product } from "@fpving/core";
import { ShippingKind } from "@fpving/plugin-sdk";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { toFailure, useClient } from "./client.ts";
import type { Client } from "./client.ts";
import { Confirm } from "./ui/confirm.tsx";
import { listingName } from "./listing-name.ts";
import { formatMoney } from "./money.ts";
import { PriceHistory } from "./price-history.tsx";
import { QueryKey } from "./queries.ts";
import { explain } from "./refusal.tsx";
import { UrlForm } from "./url-form.tsx";
import { unlessPending } from "./pending.ts";

type Detail = Awaited<ReturnType<Client["getProduct"]>>;
type ListingRow = Detail["listings"][number];

const cell = "border-b border-line px-3 py-2";
const button = "rounded-md border border-line px-3 py-1 font-medium aria-disabled:opacity-60";

const isNotFound = (error: unknown): boolean => toFailure(error).kind === ApiErrorKind.ProductNotFound;

const useChanged = (productId: string) => {
  const queryClient = useQueryClient();
  return async () => Promise.all([
    queryClient.invalidateQueries({ queryKey: [...QueryKey.Product, productId] }),
    queryClient.invalidateQueries({ queryKey: QueryKey.Watchlist }),
  ]);
};

const Header = ({ product }: { readonly product: Product }) => {
  const client = useClient();
  const changed = useChanged(product.id);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const renameButton = useRef<HTMLButtonElement>(null);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(product.name);
  const [returning, setReturning] = useState(false);
  useEffect(() => {
    if (returning) {
      renameButton.current?.focus();
      setReturning(false);
    }
  }, [returning]);
  const stopEditing = () => {
    setEditing(false);
    setReturning(true);
  };
  const rename = useMutation({
    mutationFn: async (next: string) => client.renameProduct({ productId: product.id }, { name: next }),
    onSuccess: async () => {
      await changed();
      stopEditing();
    },
  });
  const archive = useMutation({
    mutationFn: async () => client.archiveProduct({ productId: product.id }),
    onSuccess: async () => {
      await navigate({ to: "/" });
      queryClient.removeQueries({ queryKey: [...QueryKey.Product, product.id] });
      await queryClient.invalidateQueries({ queryKey: QueryKey.Watchlist });
    },
  });
  const failed = rename.error ?? archive.error;
  return (
    <header>
      {editing
        ? (
            <form
              className="flex flex-wrap items-end gap-3"
              onSubmit={unlessPending(rename.isPending, () => {
                rename.mutate(name);
              })}
            >
              <label className="flex min-w-72 flex-1 flex-col gap-1">
                <span className="font-medium">Product name</span>
                <input
                  autoFocus
                  value={name}
                  onChange={(event) => {
                    setName(event.target.value);
                  }}
                  className="rounded-md border border-line bg-surface px-3 py-2"
                />
              </label>
              <button type="submit" className={button} aria-disabled={rename.isPending}>
                Save name
              </button>
              <button type="button" className={button} onClick={stopEditing}>Cancel</button>
            </form>
          )
        : (
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-semibold">{product.name}</h1>
              <button
                ref={renameButton}
                type="button"
                className={button}
                onClick={() => {
                  setName(product.name);
                  rename.reset();
                  setEditing(true);
                }}
              >
                Rename
              </button>
              <Confirm
                action="Stop watching"
                question={`Stop watching ${product.name}? Its price history is kept.`}
                confirm="Stop watching"
                pending={archive.isPending}
                onConfirm={() => {
                  archive.mutate();
                }}
              />
            </div>
          )}
      {failed !== null && <p role="alert" className="mt-2 text-critical">{explain(toFailure(failed))}</p>}
    </header>
  );
};

const Listings = ({ productId, rows }: { readonly productId: string; readonly rows: readonly ListingRow[] }) => {
  const client = useClient();
  const changed = useChanged(productId);
  const heading = useRef<HTMLHeadingElement>(null);
  const remove = useMutation({
    mutationFn: async (listingId: string) => client.removeListing({ productId, listingId }),
    onSuccess: async () => {
      await changed();
      heading.current?.focus();
    },
  });
  return (
    <section className="mt-8">
      <h2 ref={heading} tabIndex={-1} className="text-xl font-semibold">Listings</h2>
      {remove.isError && <p role="alert" className="mt-2 text-critical">{explain(toFailure(remove.error))}</p>}
      <div className="mt-4 overflow-x-auto">
        <table className="w-full border-collapse text-left">
          <caption className="sr-only">Listings, with each one's latest price and landed cost</caption>
          <thead>
            <tr className="text-sm text-ink-muted">
              <th scope="col" className={cell}>Listing</th>
              <th scope="col" className={cell}>Price</th>
              <th scope="col" className={cell}>Shipping</th>
              <th scope="col" className={cell}>Landed cost</th>
              <th scope="col" className={cell}>Stock</th>
              <th scope="col" className={cell}>Status</th>
              <th scope="col" className={cell}><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ listing, history }) => {
              const latest = history.reduce((_older, snapshot) => snapshot);
              return (
                <tr key={listing.id}>
                  <th scope="row" className={`${cell} font-medium`}>
                    {listing.pluginId}:{" "}
                    <a href={listing.url} target="_blank" rel="noreferrer" className="underline">{listing.title}</a>
                  </th>
                  <td className={`${cell} tabular-nums`}>{formatMoney(latest.itemPrice)}</td>
                  <td className={`${cell} tabular-nums`}>
                    {latest.shipping.kind === ShippingKind.Known ? formatMoney(latest.shipping) : "Unknown"}
                  </td>
                  <td className={`${cell} tabular-nums`}>
                    {latest.landedCost === null ? "Not priced" : formatMoney(latest.landedCost)}
                  </td>
                  <td className={cell}>{latest.inStock ? "In stock" : "Out of stock"}</td>
                  <td className={cell}>{listing.status}</td>
                  <td className={cell}>
                    <Confirm
                      action="Remove"
                      actionLabel={`Remove ${listingName(listing)}`}
                      question={`Remove ${listingName(listing)}? It is never scanned again; its history is kept.`}
                      confirm="Remove"
                      pending={remove.isPending}
                      onConfirm={() => {
                        remove.mutate(listing.id);
                      }}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
};

const NotWatched = () => (
  <section>
    <h1 className="text-2xl font-semibold">Product not found</h1>
    <p className="mt-2 text-ink-muted">No watched product has this address; it may have been stopped.</p>
    <Link to="/" className="mt-4 inline-block underline">Back to the watchlist</Link>
  </section>
);

/**
 * The product detail screen: the name, which can be edited, stopping watching it, its listings with each one's
 * latest price, shipping, stock and status, removing one, and adding one by URL. A product that is not watched
 * shows a not found state.
 *
 * @param props - The product's id.
 * @returns The screen.
 */
export const ProductDetail = ({ id }: { readonly id: string }) => {
  const client = useClient();
  const changed = useChanged(id);
  const detail = useQuery({
    queryKey: [...QueryKey.Product, id],
    queryFn: async () => client.getProduct({ productId: id }),
    throwOnError: (error) => !isNotFound(error),
  });
  if (detail.isError) {
    return <NotWatched />;
  }
  if (detail.data === undefined) {
    return <p className="text-ink-muted">Loading…</p>;
  }
  const { product, listings } = detail.data;
  return (
    <section>
      <Header product={product} />
      <Listings productId={product.id} rows={listings} />
      <PriceHistory listings={listings} />
      <section className="mt-8">
        <h2 className="text-xl font-semibold">Add a listing</h2>
        <UrlForm
          submitLabel="Add listing"
          pendingLabel="Adding…"
          send={async (url) => client.addListing({ productId: id }, { url })}
          done={async () => {
            await changed();
          }}
          said={({ listing }) => `Now also watching ${listing.title}`}
        />
      </section>
    </section>
  );
};
