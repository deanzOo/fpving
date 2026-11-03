import { ApiErrorKind } from "@fpving/app/errors";
import { ListingStatus } from "@fpving/core";
import type { Product } from "@fpving/core";
import { ShippingKind } from "@fpving/plugin-sdk";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { toFailure, useClient } from "./client.ts";
import type { Client } from "./client.ts";
import { listingName } from "./listing-name.ts";
import { PriceHistory } from "./price-history.tsx";
import { QueryKey } from "./queries.ts";
import { Refused } from "./refusal.tsx";
import { Badge, BadgeTone } from "./ui/badge.tsx";
import { Button, ButtonSize, ButtonVariant } from "./ui/button.tsx";
import { Confirm } from "./ui/confirm.tsx";
import { DataTable } from "./ui/data-table.tsx";
import { LINK } from "./ui/link.ts";
import { Panel } from "./ui/panel.tsx";
import { Price } from "./ui/price.tsx";
import { TextField } from "./ui/text-field.tsx";
import { UrlForm } from "./url-form.tsx";

type Detail = Awaited<ReturnType<Client["getProduct"]>>;
type ListingRow = Detail["listings"][number];

const STATUS_BADGE = {
  [ListingStatus.Active]: { tone: BadgeTone.Live },
  [ListingStatus.Stale]: { tone: BadgeTone.Warning, glyph: "▲" },
  [ListingStatus.Gone]: { tone: BadgeTone.Neutral },
  [ListingStatus.Removed]: { tone: BadgeTone.Neutral },
} as const;

const latestOf = ({ history }: ListingRow) => history.reduce((_older, snapshot) => snapshot);

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
              onSubmit={(event) => {
                event.preventDefault();
                rename.mutate(name);
              }}
            >
              <div className="min-w-72 flex-1">
                <TextField
                  label="Product name"
                  autoFocus
                  value={name}
                  onChange={(event) => {
                    setName(event.target.value);
                  }}
                />
              </div>
              <Button type="submit" pending={rename.isPending} pendingLabel="Saving…">Save name</Button>
              <Button variant={ButtonVariant.Ghost} onClick={stopEditing}>Cancel</Button>
            </form>
          )
        : (
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="type-title">{product.name}</h1>
              <Button
                ref={renameButton}
                onClick={() => {
                  setName(product.name);
                  rename.reset();
                  setEditing(true);
                }}
              >
                Rename
              </Button>
              <Confirm
                action="Stop watching"
                question={`Stop watching ${product.name}? Its price history is kept.`}
                confirm="Stop watching"
                pending={archive.isPending}
                pendingLabel="Stopping…"
                onConfirm={() => {
                  archive.mutate();
                }}
              />
            </div>
          )}
      {failed !== null && (
        <div className="mt-2">
          <Refused error={failed} />
        </div>
      )}
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
      <h2 ref={heading} tabIndex={-1} className="type-heading">Listings</h2>
      {remove.isError && (
        <div className="mt-2">
          <Refused error={remove.error} />
        </div>
      )}
      <div className="mt-4">
        <DataTable
          caption="Listings, with each one's latest price and landed cost"
          rows={rows.map((row) => ({ ...row, latest: latestOf(row) }))}
          rowKey={({ listing }) => listing.id}
          rowHeader={{
            header: "Listing",
            cell: ({ listing }) => (
              <>
                {listing.pluginId}:{" "}
                <a href={listing.url} target="_blank" rel="noreferrer" className={LINK}>{listing.title}</a>
              </>
            ),
          }}
          columns={[
            { header: "Price", numeric: true, cell: ({ latest }) => <Price money={latest.itemPrice} /> },
            {
              header: "Shipping",
              numeric: true,
              cell: ({ latest: { shipping } }) => (
                <Price money={shipping.kind === ShippingKind.Known ? shipping : null} missing="Unknown" />
              ),
            },
            {
              header: "Landed cost",
              numeric: true,
              cell: ({ latest }) => <Price money={latest.landedCost} missing="Not priced" />,
            },
            { header: "Stock", cell: ({ latest }) => (latest.inStock ? "In stock" : "Out of stock") },
            {
              header: "Status",
              cell: ({ listing }) => <Badge {...STATUS_BADGE[listing.status]}>{listing.status}</Badge>,
            },
          ]}
          actions={({ listing }) => (
            <Confirm
              action="Remove"
              actionLabel={`Remove ${listingName(listing)}`}
              question={`Remove ${listingName(listing)}? It is never scanned again; its history is kept.`}
              confirm="Remove"
              size={ButtonSize.Small}
              pending={remove.isPending}
              pendingLabel={remove.variables === listing.id ? "Removing…" : undefined}
              onConfirm={() => {
                remove.mutate(listing.id);
              }}
            />
          )}
        />
      </div>
    </section>
  );
};

const Cheapest = ({ product, rows }: { readonly product: Product; readonly rows: readonly ListingRow[] }) => {
  const row = rows.find(({ listing }) => listing.id === product.cheapestListingId);
  const landed = row === undefined ? null : latestOf(row).landedCost;
  return row === undefined || landed === null
    ? null
    : (
        <div className="mt-6">
          <Panel title="Cheapest landed" featured>
            <div className="flex flex-wrap items-baseline gap-3">
              <Price money={landed} large />
              <span className="text-ink-muted type-body">{listingName(row.listing)}</span>
            </div>
          </Panel>
        </div>
      );
};

const NotWatched = () => (
  <section>
    <h1 className="type-title">Product not found</h1>
    <p className="mt-2 text-ink-muted type-body">No watched product has this address; it may have been stopped.</p>
    <p className="mt-4 type-body"><Link to="/" className={LINK}>Back to the watchlist</Link></p>
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
    return <p className="text-ink-muted type-body">Loading…</p>;
  }
  const { product, listings } = detail.data;
  return (
    <section>
      <Header product={product} />
      <Cheapest product={product} rows={listings} />
      <Listings productId={product.id} rows={listings} />
      <PriceHistory listings={listings} />
      <section className="mt-8">
        <h2 className="type-heading">Add a listing</h2>
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
