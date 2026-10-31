const MS_PER_SECOND = 1000;
const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;
const SECOND = ["second", MS_PER_SECOND] as const;
const UNITS = [["day", MS_PER_DAY], ["hour", MS_PER_HOUR], ["minute", MS_PER_MINUTE], SECOND] as const;

/**
 * How far `at` is from `now`, in the largest unit that fits, such as "5 minutes ago" or "in 3 hours".
 *
 * @param at - The instant to describe.
 * @param now - The current instant.
 * @param locale - The display locale; the browser's when omitted.
 * @returns The relative time.
 */
export const fromNow = (at: Date, now: Date = new Date(), locale?: string): string => {
  const offset = at.getTime() - now.getTime();
  const [unit, size] = UNITS.find(([, length]) => Math.abs(offset) >= length) ?? SECOND;
  return new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(Math.round(offset / size), unit);
};
