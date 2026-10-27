import { parse, Range, validRange } from "semver";
import type { Comparator } from "semver";

/** True when `value` is a canonical semver version such as `1.2.3` or `1.2.3+build.1`, without a `v` or `=` prefix. */
export const isSemverVersion = (value: string): boolean => {
  const version = parse(value);
  if (version === null) return false;
  const canonical = version.build.length === 0 ? version.version : `${version.version}+${version.build.join(".")}`;
  return canonical === value;
};

const hasUpperBound = (comparators: readonly Comparator[]): boolean =>
  comparators.some(({ operator, value }) => operator === "<" || operator === "<=" || (operator === "" && value !== ""));

/**
 * True when `value` is a valid semver range in which every `||` alternative has an upper bound, such as
 * `>=0.0.0 <1.0.0`, `^0.1.0` or `1.2.3`. `*`, `>=0.0.0`, `>=1.0.0` and blank are not.
 */
export const isSemverRange = (value: string): boolean =>
  validRange(value) !== null && new Range(value).set.every(hasUpperBound);
