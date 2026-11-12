import { apiRoutes } from "@fpving/app/api-routes";
import type { HttpStatus } from "@fpving/app/http-status";
import { SpecSource } from "@fpving/core";
import type { GearItem, SpecValue } from "@fpving/core";
import { GearKind } from "@fpving/plugin-sdk";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import type { z } from "zod";
import { AddGear, fromItem, GearForm } from "./add-gear.tsx";
import { useClient } from "./client.ts";
import { GEAR_FIELDS, KIND_HEADING, specWords } from "./gear-labels.ts";
import type { GearField } from "./gear-labels.ts";
import { QueryKey } from "./queries.ts";
import { Refused } from "./refusal.tsx";
import { Badge, BadgeTone } from "./ui/badge.tsx";
import { Button, ButtonSize, ButtonVariant } from "./ui/button.tsx";
import { Confirm } from "./ui/confirm.tsx";
import { EmptyState, EmptyTag } from "./ui/empty-state.tsx";
import { Panel } from "./ui/panel.tsx";

type Row = z.output<(typeof apiRoutes.listGear.schema.response)[typeof HttpStatus.Ok]>[number];
type Change = Row["changes"][number];
type CatalogRef = NonNullable<GearItem["catalogRef"]>;

const EMPTY = "Nothing in your gear yet. Search for something you own to add it.";

const useGearChanged = () => {
  const queryClient = useQueryClient();
  return async () => queryClient.invalidateQueries({ queryKey: QueryKey.Gear });
};

const withSpec = (item: GearItem, field: string, spec: SpecValue) => ({
  kind: item.kind,
  name: item.name,
  quantity: item.quantity,
  catalogRef: item.catalogRef,
  specs: { ...item.specs, [field]: spec },
});

const ChangeDetail = ({ item, catalogRef, field, change, close }: {
  readonly item: GearItem;
  readonly catalogRef: CatalogRef;
  readonly field: GearField;
  readonly change: Change;
  readonly close: () => void;
}) => {
  const client = useClient();
  const changed = useGearChanged();
  const resolving = useMutation({
    mutationFn: async (spec: SpecValue) => client.updateGear({ gearId: item.id }, withSpec(item, field.name, spec)),
    onSuccess: async () => {
      close();
      await changed();
    },
  });
  const words = (value: Change["saved"]) => specWords(field.name, value).join(" / ");
  return (
    <div className="mt-3 border-t border-line pt-3">
      <p className="type-body">
        {`You saved ${words(change.saved)}. The catalog now says ${words(change.catalog)}.`}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button
          size={ButtonSize.Small}
          pending={resolving.isPending}
          onClick={() => {
            resolving.mutate({ source: SpecSource.User, value: change.saved });
          }}
        >
          Keep mine
        </Button>
        <Button
          size={ButtonSize.Small}
          pending={resolving.isPending}
          onClick={() => {
            resolving.mutate({ source: SpecSource.Catalog, pluginId: catalogRef.pluginId, value: change.catalog });
          }}
        >
          Use catalog
        </Button>
      </div>
      <div className="has-[p]:mt-2">
        <Refused error={resolving.error} />
      </div>
    </div>
  );
};

const GearCard = ({ row: { item, changes }, edit }: { readonly row: Row; readonly edit: () => void }) => {
  const client = useClient();
  const changed = useGearChanged();
  const [opened, setOpened] = useState<string | null>(null);
  const removing = useMutation({ mutationFn: client.removeGear, onSuccess: changed });
  const { catalogRef } = item;
  const resolvable = catalogRef === null ? [] : changes.map((change) => ({ change, catalogRef }));
  const changeOf = (field: GearField) => resolvable.find(({ change }) => change.field === field.name);
  const shown = GEAR_FIELDS[item.kind].flatMap((field) => {
    const spec = item.specs[field.name];
    return spec === undefined ? [] : [{ field, words: specWords(field.name, spec.value), change: changeOf(field) }];
  });
  const open = shown.find(({ field }) => field.name === opened);
  return (
    <Panel>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h3 className="type-control">
          {item.name}{" "}
          {item.quantity > 1 && <span className="text-ink-muted type-readout">{`×${String(item.quantity)}`}</span>}
        </h3>
        <div className="flex gap-2">
          <Button size={ButtonSize.Small} aria-label={`Edit ${item.name}`} onClick={edit}>Edit</Button>
          <Confirm
            action="Remove"
            actionLabel={`Remove ${item.name}`}
            question={`Remove ${item.name} from your gear?`}
            confirm="Remove"
            size={ButtonSize.Small}
            pending={removing.isPending}
            pendingLabel="Removing…"
            onConfirm={() => {
              removing.mutate({ gearId: item.id });
            }}
          />
        </div>
      </div>
      <ul className="mt-2 flex flex-wrap items-center gap-1">
        {shown.map(({ field, words, change }) => (
          <li key={field.name} className="flex items-center gap-1">
            <span className="sr-only">{`${field.label}: `}</span>
            {words.map((word) => <Badge key={word}>{word}</Badge>)}
            {change === undefined
              ? null
              : (
                  <Button
                    variant={ButtonVariant.Ghost}
                    size={ButtonSize.Small}
                    aria-expanded={opened === field.name}
                    aria-label={`Changed: ${field.label}`}
                    onClick={() => {
                      setOpened(opened === field.name ? null : field.name);
                    }}
                  >
                    <Badge tone={BadgeTone.Warning} glyph="▲">Changed</Badge>
                  </Button>
                )}
          </li>
        ))}
      </ul>
      {open?.change === undefined
        ? null
        : (
            <ChangeDetail
              item={item}
              catalogRef={open.change.catalogRef}
              field={open.field}
              change={open.change.change}
              close={() => {
                setOpened(null);
              }}
            />
          )}
      <div className="has-[p]:mt-2">
        <Refused error={removing.error} />
      </div>
    </Panel>
  );
};

const GearEntry = ({ row }: { readonly row: Row }) => {
  const client = useClient();
  const changed = useGearChanged();
  const [editing, setEditing] = useState(false);
  return (
    <li>
      {editing
        ? (
            <GearForm
              prefill={fromItem(row.item)}
              send={async (draft) => client.updateGear({ gearId: row.item.id }, draft)}
              onSaved={async () => {
                setEditing(false);
                await changed();
              }}
              onCancel={() => {
                setEditing(false);
              }}
            />
          )
        : (
            <GearCard
              row={row}
              edit={() => {
                setEditing(true);
              }}
            />
          )}
    </li>
  );
};

const KindSection = ({ kind, rows }: { readonly kind: GearKind; readonly rows: readonly Row[] }) => {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId} className="type-heading">{KIND_HEADING[kind]}</h2>
      <ul className="mt-3 grid gap-3">
        {rows.map((row) => <GearEntry key={row.item.id} row={row} />)}
      </ul>
    </section>
  );
};

/**
 * The my gear screen: adding gear, then everything the user owns grouped by kind, each item with its spec tags, a
 * warning on a value its catalog now gives differently, and Edit and Remove.
 *
 * @returns The screen.
 */
export const Gear = () => {
  const client = useClient();
  const rows = useQuery({ queryKey: QueryKey.Gear, queryFn: async () => client.listGear(), throwOnError: true }).data;
  return (
    <section>
      <h1 className="type-title">My gear</h1>
      <AddGear />
      <div className="mt-8 grid gap-8">
        {rows === undefined && <p className="text-ink-muted type-body">Loading…</p>}
        {rows?.length === 0 && <EmptyState tag={EmptyTag.NoSignal}>{EMPTY}</EmptyState>}
        {Object.values(GearKind).map((kind) => {
          const owned = rows?.filter(({ item }) => item.kind === kind) ?? [];
          return owned.length === 0 ? null : <KindSection key={kind} kind={kind} rows={owned} />;
        })}
      </div>
    </section>
  );
};
