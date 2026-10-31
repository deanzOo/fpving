import { CURRENCY_MINOR_UNITS } from "@fpving/plugin-sdk";
import type { Amount } from "@fpving/plugin-sdk";
import { z } from "zod";

const decimalSchema = z.templateLiteral([z.number()]);

/**
 * Formats an amount for display. The minor units become an exact decimal string, so no float ever holds the amount.
 *
 * @param money - The amount in minor units.
 * @param locale - The display locale; the browser's when omitted.
 * @returns The formatted amount.
 */
export const formatMoney = ({ amountMinor, currency }: Amount, locale?: string): string => {
  const decimals = CURRENCY_MINOR_UNITS[currency];
  const digits = String(amountMinor).padStart(decimals + 1, "0");
  const point = digits.length - decimals;
  const decimal = decimals === 0 ? digits : `${digits.slice(0, point)}.${digits.slice(point)}`;
  const format = new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return format.format(decimalSchema.parse(decimal));
};
