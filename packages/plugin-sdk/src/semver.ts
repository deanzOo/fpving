import { parse, validRange } from "semver";

/** True when `value` is a canonical semver version such as `1.2.3` or `1.2.3+build.1`, without a `v` or `=` prefix. */
export const isSemverVersion = (value: string): boolean => {
  const version = parse(value);
  if (version === null) return false;
  const canonical = version.build.length === 0 ? version.version : `${version.version}+${version.build.join(".")}`;
  return canonical === value;
};

/** True when `value` is a semver range with a bound, such as `>=0.0.0 <1.0.0`; `*`, `>=0.0.0` and blank are not. */
export const isSemverRange = (value: string): boolean => {
  const range = validRange(value);
  return range !== null && range !== "*";
};
