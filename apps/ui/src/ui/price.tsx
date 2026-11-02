import type { Money } from "@fpving/plugin-sdk";
import { formatMoney } from "../money.ts";

const percent = new Intl.NumberFormat(undefined, { style: "percent", maximumFractionDigits: 1 });

const Delta = ({ money, previous }: { readonly money: Money; readonly previous: Money }) => {
  const change = money.amountMinor - previous.amountMinor;
  if (change === 0 || money.currency !== previous.currency) {
    return null;
  }
  const amount = formatMoney({ amountMinor: Math.abs(change), currency: money.currency });
  const share = previous.amountMinor === 0 ? "" : ` · ${percent.format(Math.abs(change) / previous.amountMinor)}`;
  const drop = change < 0;
  return (
    <span className={`whitespace-nowrap type-code ${drop ? "text-good" : "text-ink-muted"}`}>
      <span aria-hidden="true">{drop ? "▼" : "▲"}</span>
      {" "}
      <span className="sr-only">{drop ? "down" : "up"}</span>
      {` ${amount}${share}`}
    </span>
  );
};

/**
 * Money as a readout: always `formatMoney`, in the mono face, with the change since `previous` when given (▼ in the
 * good colour for a drop, ▲ in muted ink for a rise). A missing price is a muted sentence, never a dash or zero.
 *
 * @param props - The money or null, the previous money, whether it is the headline price, and the missing sentence.
 * @returns The price.
 */
export const Price = ({ money, previous, large = false, missing = "No price yet" }: {
  readonly money: Money | null;
  readonly previous?: Money;
  readonly large?: boolean;
  readonly missing?: string;
}) => {
  if (money === null) {
    return <span className="type-body text-ink-muted">{missing}</span>;
  }
  const face = large ? "type-readout-lg" : "type-readout";
  const price = <span className={`whitespace-nowrap ${face}`}>{formatMoney(money)}</span>;
  return previous === undefined
    ? price
    : (
        <span className="inline-flex items-baseline gap-3">
          {price}
          <Delta money={money} previous={previous} />
        </span>
      );
};
