import { apiRoutes } from "@fpving/app/api-routes";
import type { HttpStatus } from "@fpving/app/http-status";
import { SpecSource } from "@fpving/core";
import type { GearItem, SpecValue } from "@fpving/core";
import { GearKind } from "@fpving/plugin-sdk";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";
import type { RefObject } from "react";
import type { z } from "zod";
import { AddGear, fromItem, GearForm } from "./add-gear.tsx";
import { CatalogState, useCatalogs } from "./catalogs.ts";
import type { NameOf } from "./catalogs.ts";
import { useClient } from "./client.ts";
import { useFocusAfterRemoval } from "./focus.ts";
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

const EMPTY = {
  search: "Nothing in your gear yet. Search for something you own above to add it.",
  paste: "Nothing in your gear yet. Paste the specs or type them in above to add it.",
} as const;

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

const ChangeDetail = ({ item, catalogRef, field, change, resolved }: {
  readonly item: GearItem;
  readonly catalogRef: CatalogRef;
  readonly field: GearField;
  readonly change: Change;
  readonly resolved: () => void;
}) => {
  const client = useClient();
  const changed = useGearChanged();
  const resolving = useMutation({
    mutationFn: async (spec: SpecValue) => client.updateGear({ gearId: item.id }, withSpec(item, field.name, spec)),
    onSuccess: async () => {
      resolved();
      await changed();
    },
  });
  const sending = resolving.isPending ? resolving.variables.source : null;
  const words = (value: Change["saved"]) => specWords(field.name, value).join(" / ");
  return (
    <div className="mt-3 border-t border-line pt-3">
      <p className="type-body">
        {`You saved ${words(change.saved)}. The catalog now says ${words(change.catalog)}.`}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button
          size={ButtonSize.Small}
          pending={sending === SpecSource.User}
          pendingLabel="Keeping…"
          onClick={() => {
            resolving.mutate({ source: SpecSource.User, value: change.saved });
          }}
        >
          Keep mine
        </Button>
        <Button
          size={ButtonSize.Small}
          pending={sending === SpecSource.Catalog}
          pendingLabel="Updating…"
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

interface Removal {
  readonly start: () => void;
  readonly fail: () => void;
}

const GearCard = ({ row: { item, changes }, edit, editButton, removal }: {
  readonly row: Row;
  readonly edit: () => void;
  readonly editButton: RefObject<HTMLButtonElement | null>;
  readonly removal: Removal;
}) => {
  const client = useClient();
  const changed = useGearChanged();
  const heading = useRef<HTMLHeadingElement>(null);
  const [opened, setOpened] = useState<string | null>(null);
  const removing = useMutation({
    mutationFn: client.removeGear,
    onMutate: removal.start,
    onError: removal.fail,
    onSuccess: changed,
  });
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
        <h3 ref={heading} tabIndex={-1} className="type-control">
          {item.name}{" "}
          {item.quantity > 1 && <span className="text-ink-muted type-readout">{`×${String(item.quantity)}`}</span>}
        </h3>
        <div className="flex gap-2">
          <Button ref={editButton} size={ButtonSize.Small} aria-label={`Edit ${item.name}`} onClick={edit}>Edit</Button>
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
              resolved={() => {
                setOpened(null);
                heading.current?.focus();
              }}
            />
          )}
      <div className="has-[p]:mt-2">
        <Refused error={removing.error} />
      </div>
    </Panel>
  );
};

const GearEntry = ({ row, nameOf, removal }: {
  readonly row: Row;
  readonly nameOf: NameOf;
  readonly removal: Removal;
}) => {
  const client = useClient();
  const changed = useGearChanged();
  const editButton = useRef<HTMLButtonElement>(null);
  const [editing, setEditing] = useState(false);
  const [returning, setReturning] = useState(false);
  useEffect(() => {
    if (returning) {
      editButton.current?.focus();
      setReturning(false);
    }
  }, [returning]);
  const stopEditing = () => {
    setEditing(false);
    setReturning(true);
  };
  return (
    <li tabIndex={-1}>
      {editing
        ? (
            <GearForm
              prefill={fromItem(row.item, nameOf)}
              send={async (draft) => client.updateGear({ gearId: row.item.id }, draft)}
              onSaved={async () => {
                stopEditing();
                await changed();
              }}
              onCancel={stopEditing}
            />
          )
        : (
            <GearCard
              row={row}
              editButton={editButton}
              removal={removal}
              edit={() => {
                setEditing(true);
              }}
            />
          )}
    </li>
  );
};

const KindSection = ({ kind, rows, list, nameOf, removal }: {
  readonly kind: GearKind;
  readonly rows: readonly Row[];
  readonly list: RefObject<HTMLUListElement | null> | undefined;
  readonly nameOf: NameOf;
  readonly removal: (id: string, index: number) => Removal;
}) => {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId} className="type-heading">{KIND_HEADING[kind]}</h2>
      <ul ref={list} className="mt-3 grid gap-3">
        {rows.map((row, index) => (
          <GearEntry key={row.item.id} row={row} nameOf={nameOf} removal={removal(row.item.id, index)} />
        ))}
      </ul>
    </section>
  );
};

/**
 * The my gear screen: adding gear, then everything the user owns grouped by kind, each item with its spec tags, a
 * warning on a value its catalog now gives differently, and Edit and Remove. Focus follows each change: into an
 * opened form, back to Edit when it closes, to the card once a change is resolved, and to the next item after a
 * removal.
 *
 * @returns The screen.
 */
export const Gear = () => {
  const client = useClient();
  const { state, nameOf } = useCatalogs();
  const rows = useQuery({ queryKey: QueryKey.Gear, queryFn: async () => client.listGear(), throwOnError: true }).data;
  const [removingKind, setRemovingKind] = useState<GearKind | null>(null);
  const { list, heading, track } = useFocusAfterRemoval(
    (gearId) => rows?.some(({ item }) => item.id === gearId) === true,
  );
  const removal = (kind: GearKind) => (id: string, index: number): Removal => ({
    start: () => {
      setRemovingKind(kind);
      track({ id, index });
    },
    fail: () => {
      track(null);
    },
  });
  return (
    <section>
      <h1 ref={heading} tabIndex={-1} className="type-title">My gear</h1>
      <AddGear />
      <div className="mt-8 grid gap-8">
        {rows === undefined && <p className="text-ink-muted type-body">Loading…</p>}
        {rows?.length === 0 && (
          <EmptyState tag={EmptyTag.NoSignal}>{state === CatalogState.Ready ? EMPTY.search : EMPTY.paste}</EmptyState>
        )}
        {Object.values(GearKind).map((kind) => {
          const owned = rows?.filter(({ item }) => item.kind === kind) ?? [];
          return owned.length === 0
            ? null
            : (
                <KindSection
                  key={kind}
                  kind={kind}
                  rows={owned}
                  list={kind === removingKind ? list : undefined}
                  nameOf={nameOf}
                  removal={removal(kind)}
                />
              );
        })}
      </div>
    </section>
  );
};
