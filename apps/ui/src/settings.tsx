import { settingsSchema, ThresholdBasis } from "@fpving/core";
import type { Settings } from "@fpving/core";
import { CURRENCY_MINOR_UNITS } from "@fpving/plugin-sdk";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { z } from "zod";
import { toFailure, useClient } from "./client.ts";
import { fromDecimal, toDecimal } from "./money.ts";
import { QueryKey } from "./queries.ts";
import { explain } from "./refusal.tsx";

const PERCENT_DECIMALS = 2;
const { shape } = settingsSchema;
const taxShape = shape.importTax.shape;
const PERCENT = "Enter a percentage with at most 2 decimals.";

const BASIS_LABEL = {
  [ThresholdBasis.Item]: "The item price",
  [ThresholdBasis.ItemAndShipping]: "The item price and shipping",
} as const;

const input = "rounded-md border border-line bg-surface px-3 py-2";

interface ControlProps {
  readonly "id": string;
  readonly "aria-invalid": boolean;
  readonly "aria-describedby": string | undefined;
}

interface FieldProps {
  readonly label: string;
  readonly error: string | null;
  readonly children: (props: ControlProps) => ReactNode;
}

const Field = ({ label, error, children }: FieldProps) => {
  const id = useId();
  const errorId = `${id}-error`;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="font-medium">{label}</label>
      {children({ id, "aria-invalid": error !== null, "aria-describedby": error === null ? undefined : errorId })}
      {error !== null && <span id={errorId} className="text-sm text-critical">{error}</span>}
    </div>
  );
};

const SettingsForm = ({ saved }: { readonly saved: Settings }) => {
  const client = useClient();
  const queryClient = useQueryClient();
  const form = useRef<HTMLFormElement>(null);
  const { dutyFreeThreshold } = saved.importTax;
  const [displayCurrency, setDisplayCurrency] = useState(saved.displayCurrency);
  const [shipToCountry, setShipToCountry] = useState(saved.shipToCountry);
  const [thresholdCurrency, setThresholdCurrency] = useState(dutyFreeThreshold.currency);
  const [threshold, setThreshold] = useState(
    toDecimal(dutyFreeThreshold.amountMinor, CURRENCY_MINOR_UNITS[dutyFreeThreshold.currency]),
  );
  const [vat, setVat] = useState(toDecimal(saved.importTax.vatBasisPoints, PERCENT_DECIMALS));
  const [thresholdBasis, setThresholdBasis] = useState(saved.importTax.thresholdBasis);
  const [hours, setHours] = useState(String(saved.scanIntervalHours));
  const [drop, setDrop] = useState(toDecimal(saved.priceDropMinBasisPoints, PERCENT_DECIMALS));
  const [checked, setChecked] = useState(false);
  const decimals = CURRENCY_MINOR_UNITS[thresholdCurrency];
  const body = {
    displayCurrency,
    shipToCountry,
    importTax: {
      dutyFreeThreshold: { amountMinor: fromDecimal(threshold, decimals), currency: thresholdCurrency },
      vatBasisPoints: fromDecimal(vat, PERCENT_DECIMALS),
      thresholdBasis,
    },
    scanIntervalHours: fromDecimal(hours, 0),
    priceDropMinBasisPoints: fromDecimal(drop, PERCENT_DECIMALS),
  } satisfies z.input<typeof settingsSchema>;
  const invalid = (schema: z.ZodType, value: number, message: string): string | null =>
    checked && !schema.safeParse(value).success ? message : null;
  const errors = {
    threshold: invalid(
      taxShape.dutyFreeThreshold.shape.amountMinor,
      body.importTax.dutyFreeThreshold.amountMinor,
      `Enter an amount in ${thresholdCurrency}, with at most ${String(decimals)} decimals.`,
    ),
    vat: invalid(taxShape.vatBasisPoints, body.importTax.vatBasisPoints, PERCENT),
    hours: invalid(shape.scanIntervalHours, body.scanIntervalHours, "Enter a whole number of hours, at least 1."),
    drop: invalid(shape.priceDropMinBasisPoints, body.priceDropMinBasisPoints, PERCENT),
  };
  const saving = useMutation({
    mutationFn: client.putSettings,
    onSuccess: async (next) => {
      queryClient.setQueryData(QueryKey.Settings, next);
      await Promise.all([QueryKey.Watchlist, QueryKey.Product, QueryKey.Plugins].map(
        async (queryKey) => queryClient.invalidateQueries({ queryKey }),
      ));
    },
  });
  return (
    <form
      ref={form}
      noValidate
      className="mt-6 grid max-w-xl gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        setChecked(true);
        if (settingsSchema.safeParse(body).success) {
          saving.mutate(body);
          return;
        }
        form.current?.querySelector<HTMLElement>("[aria-invalid=true]")?.focus();
      }}
    >
      <Field label="Display currency" error={null}>
        {(aria) => (
          <select
            {...aria}
            className={input}
            value={displayCurrency}
            onChange={(event) => {
              setDisplayCurrency(shape.displayCurrency.parse(event.target.value));
            }}
          >
            {shape.displayCurrency.options.map((code) => <option key={code} value={code}>{code}</option>)}
          </select>
        )}
      </Field>
      <Field label="Ship to" error={null}>
        {(aria) => (
          <select
            {...aria}
            className={input}
            value={shipToCountry}
            onChange={(event) => {
              setShipToCountry(shape.shipToCountry.parse(event.target.value));
            }}
          >
            {shape.shipToCountry.options.map((code) => <option key={code} value={code}>{code}</option>)}
          </select>
        )}
      </Field>
      <fieldset className="grid gap-4 rounded-md border border-line p-4">
        <legend className="px-1 font-semibold">Import tax</legend>
        <Field label="Duty-free threshold" error={errors.threshold}>
          {(aria) => (
            <input
              {...aria}
              className={input}
              inputMode="decimal"
              value={threshold}
              onChange={(event) => {
                setThreshold(event.target.value);
              }}
            />
          )}
        </Field>
        <Field label="Threshold currency" error={null}>
          {(aria) => (
            <select
              {...aria}
              className={input}
              value={thresholdCurrency}
              onChange={(event) => {
                setThresholdCurrency(taxShape.dutyFreeThreshold.shape.currency.parse(event.target.value));
              }}
            >
              {taxShape.dutyFreeThreshold.shape.currency.options.map((code) => (
                <option key={code} value={code}>{code}</option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Threshold applies to" error={null}>
          {(aria) => (
            <select
              {...aria}
              className={input}
              value={thresholdBasis}
              onChange={(event) => {
                setThresholdBasis(taxShape.thresholdBasis.parse(event.target.value));
              }}
            >
              {taxShape.thresholdBasis.options.map((basis) => (
                <option key={basis} value={basis}>{BASIS_LABEL[basis]}</option>
              ))}
            </select>
          )}
        </Field>
        <Field label="VAT (%)" error={errors.vat}>
          {(aria) => (
            <input
              {...aria}
              className={input}
              inputMode="decimal"
              value={vat}
              onChange={(event) => {
                setVat(event.target.value);
              }}
            />
          )}
        </Field>
      </fieldset>
      <Field label="Scan every (hours)" error={errors.hours}>
        {(aria) => (
          <input
            {...aria}
            className={input}
            inputMode="numeric"
            value={hours}
            onChange={(event) => {
              setHours(event.target.value);
            }}
          />
        )}
      </Field>
      <Field label="Price drop alert from (%)" error={errors.drop}>
        {(aria) => (
          <input
            {...aria}
            className={input}
            inputMode="decimal"
            value={drop}
            onChange={(event) => {
              setDrop(event.target.value);
            }}
          />
        )}
      </Field>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={saving.isPending}
          className="rounded-md bg-action px-4 py-2 font-medium text-on-action disabled:opacity-60"
        >
          {saving.isPending ? "Saving…" : "Save settings"}
        </button>
        <p role="status" className="text-ink-muted">{saving.isSuccess ? "Settings saved." : ""}</p>
      </div>
      {saving.isError && <p role="alert" className="text-critical">{explain(toFailure(saving.error))}</p>}
    </form>
  );
};

/**
 * The settings screen: one labelled field per setting, checked with the settings schema before saving. Amounts are
 * typed in major units and percentages with two decimals; both are sent as whole minor units and basis points.
 *
 * @returns The screen.
 */
export const SettingsScreen = () => {
  const client = useClient();
  const saved = useQuery({
    queryKey: QueryKey.Settings,
    queryFn: async () => client.getSettings(),
    throwOnError: true,
  }).data;
  return (
    <section>
      <h1 className="text-2xl font-semibold">Settings</h1>
      {saved === undefined ? <p className="mt-6 text-ink-muted">Loading…</p> : <SettingsForm saved={saved} />}
    </section>
  );
};
