import { CURRENCY_MINOR_UNITS } from "@fpving/plugin-sdk";
import type { Amount } from "@fpving/plugin-sdk";
import { z } from "zod";

const decimalSchema = z.templateLiteral([z.number()]);

/**
 * Writes a whole number of minor units as an exact decimal string, such as 1999 with 2 decimals as `"19.99"`.
 *
 * @param minor - The non-negative whole number of minor units.
 * @param decimals - How many minor-unit digits one major unit has.
 * @returns The decimal string.
 */
export const toDecimal = (minor: number, decimals: number): string => {
  const digits = String(minor).padStart(decimals + 1, "0");
  const point = digits.length - decimals;
  return decimals === 0 ? digits : `${digits.slice(0, point)}.${digits.slice(point)}`;
};

/**
 * Reads a decimal string with at most `decimals` digits after the point as a whole number of minor units, without
 * a float: `"19.9"` with 2 decimals is 1990.
 *
 * @param text - What was typed.
 * @param decimals - How many minor-unit digits one major unit has.
 * @returns The minor units, or `NaN` when the text is not such a decimal.
 */
export const fromDecimal = (text: string, decimals: number): number => {
  const [, whole, fraction = ""] = /^(\d+)(?:\.(\d+))?$/u.exec(text) ?? [];
  return whole === undefined || fraction.length > decimals
    ? Number.NaN
    : Number(`${whole}${fraction.padEnd(decimals, "0")}`);
};

/**
 * Formats an amount for display. The minor units become an exact decimal string, so no float ever holds the amount.
 *
 * @param money - The amount in minor units.
 * @param locale - The display locale; the browser's when omitted.
 * @returns The formatted amount.
 */
export const formatMoney = ({ amountMinor, currency }: Amount, locale?: string): string => {
  const decimals = CURRENCY_MINOR_UNITS[currency];
  const decimal = toDecimal(amountMinor, decimals);
  const format = new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return format.format(decimalSchema.parse(decimal));
};
