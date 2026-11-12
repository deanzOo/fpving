import { apiRoutes } from "@fpving/app/api-routes";
import { ApiErrorKind } from "@fpving/app/errors";
import { HttpStatus } from "@fpving/app/http-status";
import { gearItemSchema, SpecSource } from "@fpving/core";
import type { GearItem } from "@fpving/core";
import { GearKind } from "@fpving/plugin-sdk";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useId, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { z } from "zod";
import { CatalogState, useCatalogs } from "./catalogs.ts";
import type { NameOf } from "./catalogs.ts";
import { toFailure, useClient } from "./client.ts";
import { GEAR_FIELDS, KIND_LABEL, specWords } from "./gear-labels.ts";
import type { GearField } from "./gear-labels.ts";
import { QueryKey } from "./queries.ts";
import { Refused } from "./refusal.tsx";
import { Badge } from "./ui/badge.tsx";
import { Button, ButtonSize, ButtonVariant } from "./ui/button.tsx";
import { Checkbox } from "./ui/checkbox.tsx";
import { EmptyState, EmptyTag } from "./ui/empty-state.tsx";
import { LINK } from "./ui/link.ts";
import { Done, Notice, NoticeTone } from "./ui/notice.tsx";
import { Panel } from "./ui/panel.tsx";
import { Select } from "./ui/select.tsx";
import { TextField } from "./ui/text-field.tsx";

type Json = z.core.util.JSONType;
type Draft = z.input<typeof apiRoutes.addGear.schema.body>;
type Found = z.output<(typeof apiRoutes.searchCatalog.schema.response)[typeof HttpStatus.Ok]>;
type Match = Found["matches"][number];
type Reading = z.output<(typeof apiRoutes.readSpecs.schema.response)[typeof HttpStatus.Ok]>;

const AI_READ = "Read by AI, check it";
const DISAGREE = "The catalogs disagree. Pick the right value, or keep Not sure.";
const COMMAS = "Separate values with commas.";
const HAND_ONLY = "The AI that reads specs is not available, so type the specs in by hand.";
const NO_CATALOG = "No catalog plugin installed. Paste the specs or type them in.";
const UNAVAILABLE = "The catalog plugin is not available right now. Paste the specs or type them in, or check";
const FAILED = "Failed";
const QUIET = { tone: NoticeTone.Status, tag: "", text: "" } as const;
const COUNT_ERROR = {
  single: "Enter a whole number, at least 1.",
  list: "Enter whole numbers of at least 1, each once.",
} as const;
const SEPARATOR = ",";

interface Entry {
  readonly raw: string;
  readonly pluginId: string | null;
  readonly ai: boolean;
  readonly origin: string;
  readonly choices: readonly { readonly raw: string; readonly words: string }[] | null;
}

/** What the gear form starts with. */
export interface Prefill {
  readonly kind: GearKind;
  readonly name: string;
  readonly nameByAi: boolean;
  readonly quantity: number;
  readonly catalogRef: GearItem["catalogRef"];
  readonly entries: Readonly<Record<string, Entry>>;
}

const EMPTY: Entry = { raw: "", pluginId: null, ai: false, origin: "", choices: null };

const isScalar = (value: Json): value is string | number => typeof value === "string" || typeof value === "number";

const scalars = (value: Json): (string | number)[] => [value].flat().filter(isScalar);

const encode = (value: Json): string => scalars(value).join(SEPARATOR);

const sameKey = (value: Json): string => scalars(value).map(String).sort().join(SEPARATOR);

const distinct = (values: readonly { readonly value: Json; readonly pluginId: string }[]) => {
  const byKey = new Map<string, { readonly value: Json; readonly pluginIds: readonly string[] }>();
  for (const { value, pluginId } of values) {
    const known = byKey.get(sameKey(value))?.pluginIds ?? [];
    byKey.set(sameKey(value), { value, pluginIds: [...known, pluginId] });
  }
  return [...byKey.values()];
};

const decode = (field: GearField, raw: string): Json | undefined => {
  const text = raw.trim();
  if (text === "") {
    return undefined;
  }
  const one = (part: string): Json => (field.words === null ? Number(part) : part);
  return field.list ? text.split(SEPARATOR).map((part) => one(part.trim())) : one(text);
};

const blank = (kind: GearKind): Prefill =>
  ({ kind, name: "", nameByAi: false, quantity: 1, catalogRef: null, entries: {} });

const fromMatch = (match: Match, nameOf: NameOf): Prefill => {
  const [ref = null] = match.refs;
  const fields = GEAR_FIELDS[match.kind].map((field): [string, Entry] => {
    const values = match.specs[field.name] ?? [];
    const found = distinct(values);
    const pluginId = values.find((value) => value.pluginId === ref?.pluginId)?.pluginId ?? null;
    const choices = found.map(({ value, pluginIds }) => ({
      raw: encode(value),
      words: `${specWords(field.name, value).join(" / ")} (${pluginIds.map(nameOf).join(", ")})`,
    }));
    const entry = found.length > 1
      ? { ...EMPTY, choices }
      : { ...EMPTY, raw: found.map(({ value }) => encode(value)).join(""), pluginId };
    return [field.name, entry];
  });
  return { ...blank(match.kind), name: match.name, catalogRef: ref, entries: Object.fromEntries(fields) };
};

const fromReading = (kind: GearKind, { name, specs }: Reading): Prefill => {
  const read: Readonly<Record<string, Json>> = specs;
  return {
    ...blank(kind),
    name: name ?? "",
    nameByAi: name !== null,
    entries: Object.fromEntries(Object.entries(read).map(([field, value]) => [
      field, { ...EMPTY, raw: encode(value), ai: true },
    ])),
  };
};

/**
 * What the gear form starts with to edit `item`: its values, each still from the catalog it came from and saying
 * where it came from.
 *
 * @param item - The item.
 * @param nameOf - A catalog's display name by its plugin id.
 * @returns The prefill.
 */
export const fromItem = (item: GearItem, nameOf: NameOf): Prefill => ({
  ...blank(item.kind),
  name: item.name,
  quantity: item.quantity,
  catalogRef: item.catalogRef,
  entries: Object.fromEntries(Object.entries(item.specs).map(([field, spec]) => [
    field,
    spec.source === SpecSource.Catalog
      ? { ...EMPTY, raw: encode(spec.value), pluginId: spec.pluginId, origin: `From ${nameOf(spec.pluginId)}` }
      : { ...EMPTY, raw: encode(spec.value), origin: "Confirmed by you" },
  ])),
});

const hintOf = (field: GearField, entry: Entry): string | undefined => {
  const hints = [
    entry.origin,
    entry.ai ? AI_READ : "",
    entry.choices === null ? "" : DISAGREE,
    field.list && field.words === null ? COMMAS : "",
  ].filter((hint) => hint !== "");
  return hints.length === 0 ? undefined : hints.join(" ");
};

interface ControlProps {
  readonly field: GearField;
  readonly entry: Entry;
  readonly error: string | undefined;
  readonly change: (raw: string) => void;
}

const Checklist = ({ field, entry, words, change }: Omit<ControlProps, "error"> & {
  readonly words: Readonly<Record<string, string>>;
}) => {
  const hintId = useId();
  const picked = new Set(entry.raw.split(SEPARATOR));
  const hint = hintOf(field, entry);
  return (
    <fieldset aria-describedby={hint === undefined ? undefined : hintId} className="m-0 grid gap-2 border-0 p-0">
      <legend className="mb-1 type-control text-ink">{field.label}</legend>
      {Object.entries(words).map(([value, word]) => (
        <Checkbox
          key={value}
          label={word}
          checked={picked.has(value)}
          onChange={(event) => {
            const next = event.target.checked ? [...picked, value] : [...picked].filter((key) => key !== value);
            change(Object.keys(words).filter((key) => next.includes(key)).join(SEPARATOR));
          }}
        />
      ))}
      {hint === undefined ? null : <p id={hintId} className="type-small text-ink-muted">{hint}</p>}
    </fieldset>
  );
};

const Control = ({ field, entry, error, change }: ControlProps) => {
  const hint = hintOf(field, entry);
  const onChange = (event: { readonly target: { readonly value: string } }) => {
    change(event.target.value);
  };
  if (entry.choices !== null) {
    return (
      <Select label={field.label} hint={hint} value={entry.raw} onChange={onChange}>
        <option value="">Not sure</option>
        {entry.choices.map(({ raw, words }) => <option key={raw} value={raw}>{words}</option>)}
      </Select>
    );
  }
  if (field.words === null) {
    return (
      <TextField
        label={field.label}
        hint={hint}
        error={error}
        numeric
        inputMode="numeric"
        value={entry.raw}
        onChange={onChange}
      />
    );
  }
  if (field.list) {
    return <Checklist field={field} entry={entry} change={change} words={field.words} />;
  }
  return (
    <Select label={field.label} hint={hint} value={entry.raw} onChange={onChange}>
      <option value="">Unknown</option>
      {Object.entries(field.words).map(([value, word]) => <option key={value} value={value}>{word}</option>)}
    </Select>
  );
};

const { name: nameSchema, quantity: quantitySchema } = gearItemSchema.shape;

/**
 * The form for one piece of gear: its name, how many, and a field per spec of its kind. Fields left empty stay
 * unknown. A value is sent as from its catalog only while it is the catalog's untouched value; anything picked, typed
 * or read by the AI is sent as confirmed by the user, and only on Save.
 *
 * @param props - What the form starts with, what Save sends, and what to do once it was saved or cancelled.
 * @returns The form.
 */
export const GearForm = ({ prefill, send, onSaved, onCancel }: {
  readonly prefill: Prefill;
  readonly send: (draft: Draft) => Promise<GearItem>;
  readonly onSaved: (item: GearItem) => Promise<void>;
  readonly onCancel: () => void;
}) => {
  const form = useRef<HTMLFormElement>(null);
  const [name, setName] = useState(prefill.name);
  const [nameByAi, setNameByAi] = useState(prefill.nameByAi);
  const [quantity, setQuantity] = useState(String(prefill.quantity));
  const [entries, setEntries] = useState(prefill.entries);
  const [checked, setChecked] = useState(false);
  const fields = GEAR_FIELDS[prefill.kind];
  const values = fields.map((field) => {
    const entry = entries[field.name] ?? EMPTY;
    const value = decode(field, entry.raw);
    const valid = value === undefined || z.safeParse(field.schema, value).success;
    const error = checked && !valid ? COUNT_ERROR[field.list ? "list" : "single"] : undefined;
    return { field, entry, value, valid, error };
  });
  const nameValid = nameSchema.safeParse(name).success;
  const quantityValid = quantitySchema.safeParse(Number(quantity)).success;
  const errors = {
    name: checked && !nameValid ? "Enter a name." : undefined,
    quantity: checked && !quantityValid ? COUNT_ERROR.single : undefined,
  };
  const draft: Draft = {
    kind: prefill.kind,
    name: name.trim(),
    quantity: Number(quantity),
    catalogRef: prefill.catalogRef,
    specs: Object.fromEntries(values.flatMap(({ field, entry, value }) => (value === undefined
      ? []
      : [[field.name, entry.pluginId === null
          ? { source: SpecSource.User, value }
          : { source: SpecSource.Catalog, pluginId: entry.pluginId, value }]]))),
  };
  const saving = useMutation({ mutationFn: send, onSuccess: onSaved });
  return (
    <form
      ref={form}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        flushSync(() => {
          setChecked(true);
        });
        if (nameValid && quantityValid && values.every(({ valid }) => valid)) {
          saving.mutate(draft);
          return;
        }
        form.current?.querySelector<HTMLElement>("[aria-invalid=true]")?.focus();
      }}
    >
      <Panel title={KIND_LABEL[prefill.kind]}>
        <div className="grid gap-4">
          <TextField
            label="Name"
            autoFocus
            hint={nameByAi ? AI_READ : undefined}
            error={errors.name}
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              setNameByAi(false);
            }}
          />
          <TextField
            label="Quantity"
            numeric
            inputMode="numeric"
            error={errors.quantity}
            value={quantity}
            onChange={(event) => {
              setQuantity(event.target.value);
            }}
          />
          {values.map(({ field, entry, error }) => (
            <Control
              key={field.name}
              field={field}
              entry={entry}
              error={error}
              change={(raw) => {
                setEntries({ ...entries, [field.name]: { ...entry, raw, pluginId: null, ai: false, origin: "" } });
              }}
            />
          ))}
        </div>
      </Panel>
      <div className="mt-4 flex gap-2">
        <Button type="submit" variant={ButtonVariant.Primary} pending={saving.isPending} pendingLabel="Saving…">
          Save
        </Button>
        <Button variant={ButtonVariant.Ghost} onClick={onCancel}>Cancel</Button>
      </div>
      <div className="has-[p]:mt-4">
        <Refused error={saving.error} />
      </div>
    </form>
  );
};

const MatchSpecs = ({ match, nameOf }: { readonly match: Match; readonly nameOf: NameOf }) => (
  <ul className="mt-2 flex flex-wrap items-center gap-1">
    {GEAR_FIELDS[match.kind].flatMap((field) => {
      const found = distinct(match.specs[field.name] ?? []);
      return found.map(({ value, pluginIds }, index) => (
        <li key={`${field.name}-${encode(value)}`} className="flex items-center gap-1">
          {index === 0 ? null : <span className="type-small text-ink-muted">or</span>}
          {specWords(field.name, value).map((word) => <Badge key={word}>{word}</Badge>)}
          {found.length > 1 && <span className="type-small text-ink-muted">{pluginIds.map(nameOf).join(", ")}</span>}
        </li>
      ));
    })}
  </ul>
);

const outcomeOf = ({ matches, failedPlugins, catalogs }: Found, nameOf: NameOf) => {
  if (failedPlugins.length === 0) {
    return QUIET;
  }
  const names = failedPlugins.map(nameOf).join(", ");
  return matches.length === 0 && failedPlugins.length >= catalogs
    ? { tone: NoticeTone.Critical, tag: FAILED, text: `The search failed on ${names}. Try again in a moment.` }
    : { tone: NoticeTone.Warning, tag: "Partial", text: `${names} did not answer, so some matches may be missing.` };
};

const Search = ({ pick, nameOf }: { readonly pick: (prefill: Prefill) => void; readonly nameOf: NameOf }) => {
  const client = useClient();
  const [query, setQuery] = useState("");
  const search = useMutation({ mutationFn: client.searchCatalog });
  const { text, ...look } = search.data === undefined ? QUIET : outcomeOf(search.data, nameOf);
  return (
    <Panel title="Find your gear">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          search.mutate({ q: query });
        }}
      >
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-60 flex-1">
            <TextField
              label="Search the catalog"
              required
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
              }}
            />
          </div>
          <Button type="submit" variant={ButtonVariant.Primary} pending={search.isPending} pendingLabel="Searching…">
            Search
          </Button>
        </div>
      </form>
      <div className="has-[p]:mt-4">
        <Notice {...look}>{text}</Notice>
      </div>
      {search.data?.matches.length === 0 && look.tag !== FAILED && (
        <p className="mt-4 type-body">No match in the catalog.</p>
      )}
      <ul className="mt-4 grid gap-3">
        {search.data?.matches.map((match) => (
          <li key={`${match.kind}-${match.name}`} className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="type-body">
                {match.name} <span className="text-ink-muted">{KIND_LABEL[match.kind]}</span>
              </p>
              <MatchSpecs match={match} nameOf={nameOf} />
            </div>
            <Button
              size={ButtonSize.Small}
              aria-label={`Use ${match.name}`}
              onClick={() => {
                pick(fromMatch(match, nameOf));
              }}
            >
              Use this
            </Button>
          </li>
        ))}
      </ul>
      <div className="has-[p]:mt-4">
        <Refused error={search.error} />
      </div>
    </Panel>
  );
};

const kindSchema = z.enum(GearKind);

const Paste = ({ pick }: { readonly pick: (prefill: Prefill, handOnly?: boolean) => void }) => {
  const client = useClient();
  const [kind, setKind] = useState<GearKind>(GearKind.Radio);
  const [text, setText] = useState("");
  const reading = useMutation({
    mutationFn: client.readSpecs,
    onSuccess: (read, sent) => {
      pick(fromReading(sent.kind, read));
    },
    onError: (error, sent) => {
      if (toFailure(error).kind === ApiErrorKind.Unavailable) {
        pick(blank(sent.kind), true);
      }
    },
  });
  return (
    <Panel title="Not in the catalog">
      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          reading.mutate({ kind, text });
        }}
      >
        <Select
          label="Kind"
          value={kind}
          onChange={(event) => {
            setKind(kindSchema.parse(event.target.value));
          }}
        >
          {Object.values(GearKind).map((value) => <option key={value} value={value}>{KIND_LABEL[value]}</option>)}
        </Select>
        <TextField
          label="Specs text"
          multiline
          hint="Paste the specs from the store page; the AI reads them and you check them before saving."
          required
          value={text}
          onChange={(event) => {
            setText(event.target.value);
          }}
        />
        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant={ButtonVariant.Primary} pending={reading.isPending} pendingLabel="Reading…">
            Read specs
          </Button>
          <Button
            onClick={() => {
              pick(blank(kind));
            }}
          >
            Type them in
          </Button>
        </div>
      </form>
      <div className="has-[p]:mt-4">
        <Refused error={reading.error} />
      </div>
    </Panel>
  );
};

/**
 * Adding gear: search the catalogs and pick a match, or paste the specs for the AI to read, or type them in. Each way
 * opens the gear form; nothing is saved before its Save.
 *
 * @returns The search, the paste form, or the gear form.
 */
export const AddGear = () => {
  const client = useClient();
  const queryClient = useQueryClient();
  const [prefill, setPrefill] = useState<Prefill | null>(null);
  const [handOnly, setHandOnly] = useState(false);
  const [said, setSaid] = useState("");
  const { state, nameOf } = useCatalogs();
  const pick = (next: Prefill, hand = false) => {
    setPrefill(next);
    setHandOnly(hand);
    setSaid("");
  };
  return (
    <div className="mt-6">
      {prefill === null
        ? (
            <>
              {state === CatalogState.None && (
                <EmptyState tag={EmptyTag.NoSignal}>
                  {NO_CATALOG} <Link to="/plugins" className={LINK}>Plugins</Link>
                </EmptyState>
              )}
              {state === CatalogState.Unavailable && (
                <EmptyState tag={EmptyTag.NoSignal}>
                  {UNAVAILABLE} <Link to="/plugins" className={LINK}>Plugins</Link>.
                </EmptyState>
              )}
              {state === CatalogState.Ready && <Search pick={pick} nameOf={nameOf} />}
              <div className="mt-4">
                <Paste pick={pick} />
              </div>
            </>
          )
        : (
            <>
              <div className="has-[p]:mb-4">
                <Notice tone={NoticeTone.Status} tag="">{handOnly ? HAND_ONLY : ""}</Notice>
              </div>
              <GearForm
                prefill={prefill}
                send={client.addGear}
                onSaved={async (item) => {
                  setPrefill(null);
                  setSaid(`Added ${item.name} to your gear.`);
                  await queryClient.invalidateQueries({ queryKey: QueryKey.Gear });
                }}
                onCancel={() => {
                  setPrefill(null);
                }}
              />
            </>
          )}
      <div className="has-[p]:mt-4">
        <Done>{said}</Done>
      </div>
    </div>
  );
};
