import { valid, validRange } from "semver";

/** True when `value` is a canonical semver version such as `1.2.3`, without a `v` prefix. */
export const isSemverVersion = (value: string): boolean => valid(value) === value;

/** True when `value` is a non-blank semver range such as `^0.1.0`. */
export const isSemverRange = (value: string): boolean => value.trim() !== "" && validRange(value) !== null;
