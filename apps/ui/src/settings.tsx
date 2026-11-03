import { settingsSchema, ThresholdBasis } from "@fpving/core";
import type { Settings } from "@fpving/core";
import { CURRENCY_MINOR_UNITS } from "@fpving/plugin-sdk";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import type { z } from "zod";
import { useClient } from "./client.ts";
import { fromDecimal, toDecimal } from "./money.ts";
import { QueryKey } from "./queries.ts";
import { Refused } from "./refusal.tsx";
import { Button, ButtonVariant } from "./ui/button.tsx";
import { Done } from "./ui/notice.tsx";
import { Panel } from "./ui/panel.tsx";
import { Select } from "./ui/select.tsx";
import { TextField } from "./ui/text-field.tsx";

const PERCENT_DECIMALS = 2;
const { shape } = settingsSchema;
const taxShape = shape.importTax.shape;
const PERCENT = "Enter a percentage with at most 2 decimals.";

const BASIS_LABEL = {
  [ThresholdBasis.Item]: "The item price",
  [ThresholdBasis.ItemAndShipping]: "The item price and shipping",
} as const;

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
  const invalid = (schema: z.ZodType, value: number, message: string): string | undefined =>
    checked && !schema.safeParse(value).success ? message : undefined;
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
      className="mt-6 max-w-[calc(var(--content-max)/2)]"
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
      <Panel>
        <div className="grid gap-4">
          <Select
            label="Display currency"
            value={displayCurrency}
            onChange={(event) => {
              setDisplayCurrency(shape.displayCurrency.parse(event.target.value));
            }}
          >
            {shape.displayCurrency.options.map((code) => <option key={code} value={code}>{code}</option>)}
          </Select>
          <Select
            label="Ship to"
            value={shipToCountry}
            onChange={(event) => {
              setShipToCountry(shape.shipToCountry.parse(event.target.value));
            }}
          >
            {shape.shipToCountry.options.map((code) => <option key={code} value={code}>{code}</option>)}
          </Select>
          <fieldset className="m-0 grid gap-4 border-0 border-t border-line p-0 pt-4">
            <legend className="pr-2 text-ink-muted type-label">Import tax</legend>
            <TextField
              label="Duty-free threshold"
              numeric
              inputMode="decimal"
              error={errors.threshold}
              value={threshold}
              onChange={(event) => {
                setThreshold(event.target.value);
              }}
            />
            <Select
              label="Threshold currency"
              value={thresholdCurrency}
              onChange={(event) => {
                setThresholdCurrency(taxShape.dutyFreeThreshold.shape.currency.parse(event.target.value));
              }}
            >
              {taxShape.dutyFreeThreshold.shape.currency.options.map((code) => (
                <option key={code} value={code}>{code}</option>
              ))}
            </Select>
            <Select
              label="Threshold applies to"
              value={thresholdBasis}
              onChange={(event) => {
                setThresholdBasis(taxShape.thresholdBasis.parse(event.target.value));
              }}
            >
              {taxShape.thresholdBasis.options.map((basis) => (
                <option key={basis} value={basis}>{BASIS_LABEL[basis]}</option>
              ))}
            </Select>
            <TextField
              label="VAT (%)"
              numeric
              inputMode="decimal"
              error={errors.vat}
              value={vat}
              onChange={(event) => {
                setVat(event.target.value);
              }}
            />
          </fieldset>
          <div className="grid gap-4 border-t border-line pt-4">
            <TextField
              label="Scan every (hours)"
              numeric
              inputMode="numeric"
              error={errors.hours}
              value={hours}
              onChange={(event) => {
                setHours(event.target.value);
              }}
            />
            <TextField
              label="Price drop alert from (%)"
              numeric
              inputMode="decimal"
              error={errors.drop}
              value={drop}
              onChange={(event) => {
                setDrop(event.target.value);
              }}
            />
          </div>
        </div>
      </Panel>
      <div className="mt-4">
        <Button type="submit" variant={ButtonVariant.Primary} pending={saving.isPending} pendingLabel="Saving…">
          Save settings
        </Button>
      </div>
      <div className="has-[p]:mt-4">
        <Done>{saving.isSuccess ? "Settings saved." : ""}</Done>
      </div>
      {saving.isError && (
        <div className="mt-4">
          <Refused error={saving.error} />
        </div>
      )}
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
      <h1 className="type-title">Settings</h1>
      {saved === undefined ? <p className="mt-6 text-ink-muted type-body">Loading…</p> : <SettingsForm saved={saved} />}
    </section>
  );
};
