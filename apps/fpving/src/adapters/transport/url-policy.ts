import { err, ok } from "@fpving/plugin-sdk";
import type { Result, TransportError } from "@fpving/plugin-sdk";
import { transportFailure } from "./transport-failure.js";

const ALLOWED_PROTOCOLS: readonly string[] = ["http:", "https:"];
const LOCALHOST = "localhost";
const LOCALHOST_SUFFIX = ".localhost";
const IPV4_PATTERN = /^\d+\.\d+\.\d+\.\d+$/;
const TRAILING_DOTS = /\.+$/;
const HEX_RADIX = 16;
const OCTET_BITS = 8;
const IPV6_GROUPS = 8;
const EMBEDDED_IPV4_GROUP = 6;
const MAPPED_MARKER = 0xffff;
const NAT64_FIRST = 0x64;
const NAT64_SECOND = 0xff9b;
const SITE_LOCAL_PREFIX = 0xfec0;
const ZEROS_BEFORE_SIIT_MARKER = 4;
const ZEROS_BEFORE_MAPPED_MARKER = 5;
const NAT64_ZEROS_FROM = 2;
const UNIQUE_LOCAL_MASK = 0xfe00;
const UNIQUE_LOCAL_PREFIX = 0xfc00;
const LINK_LOCAL_MASK = 0xffc0;
const LINK_LOCAL_PREFIX = 0xfe80;
const OCTET_MASK = 0xff;
const IPV4 = {
  Any: 0,
  Loopback: 127,
  TenNet: 10,
  Private172: 172,
  Private192: 192,
  LinkLocal: 169,
  Cgnat: 100,
} as const;
const IPV4_SECOND = {
  Private172Min: 16,
  Private172Max: 31,
  Private192: 168,
  LinkLocal: 254,
  CgnatMin: 64,
  CgnatMax: 127,
} as const;

const isPrivateIpv4 = (first: number, second: number): boolean =>
  first === IPV4.Any
  || first === IPV4.Loopback
  || first === IPV4.TenNet
  || (first === IPV4.Private172 && second >= IPV4_SECOND.Private172Min && second <= IPV4_SECOND.Private172Max)
  || (first === IPV4.Private192 && second === IPV4_SECOND.Private192)
  || (first === IPV4.LinkLocal && second === IPV4_SECOND.LinkLocal)
  || (first === IPV4.Cgnat && second >= IPV4_SECOND.CgnatMin && second <= IPV4_SECOND.CgnatMax);

const parseGroups = (part: string): number[] =>
  part === "" ? [] : part.split(":").map((group) => Number.parseInt(group, HEX_RADIX));

const expandIpv6 = (host: string): number[] => {
  const [head = "", tail] = host.split("::");
  const left = parseGroups(head);
  if (tail === undefined) {
    return left;
  }
  const right = parseGroups(tail);
  return [...left, ...new Array<number>(IPV6_GROUPS - left.length - right.length).fill(0), ...right];
};

const allZero = (groups: readonly number[]): boolean => groups.every((group) => group === 0);

const isPrivateIpv6 = (host: string): boolean => {
  const groups = expandIpv6(host);
  const [first = 0, second = 0, , , group4 = 0, group5 = 0, embeddedHigh = 0] = groups;
  const head = groups.slice(0, EMBEDDED_IPV4_GROUP);
  const embedsIpv4
    = allZero(head)
      || (allZero(head.slice(0, ZEROS_BEFORE_MAPPED_MARKER)) && group5 === MAPPED_MARKER)
      || (allZero(head.slice(0, ZEROS_BEFORE_SIIT_MARKER)) && group4 === MAPPED_MARKER && group5 === 0)
      || (first === NAT64_FIRST && second === NAT64_SECOND && allZero(head.slice(NAT64_ZEROS_FROM)));
  if (embedsIpv4) {
    return isPrivateIpv4(embeddedHigh >> OCTET_BITS, embeddedHigh & OCTET_MASK);
  }
  return (
    (first & UNIQUE_LOCAL_MASK) === UNIQUE_LOCAL_PREFIX
    || (first & LINK_LOCAL_MASK) === LINK_LOCAL_PREFIX
    || (first & LINK_LOCAL_MASK) === SITE_LOCAL_PREFIX
  );
};

const isPrivateHost = (hostname: string): boolean => {
  const host = hostname.replace(TRAILING_DOTS, "");
  if (host.startsWith("[")) {
    return isPrivateIpv6(host.slice(1, -1));
  }
  if (IPV4_PATTERN.test(host)) {
    const [first = 0, second = 0] = host.split(".").map(Number);
    return isPrivateIpv4(first, second);
  }
  return host === LOCALHOST || host.endsWith(LOCALHOST_SUFFIX);
};

/**
 * Decides whether the host may load a URL a plugin asked for. Plugins are a trust boundary, so only absolute http and
 * https URLs are allowed, and by default not those whose literal host is loopback, private, link-local, carrier-grade
 * NAT or site-local, nor an IPv6 address embedding such an IPv4 address (IPv4-mapped, IPv4-compatible, SIIT, NAT64).
 * Those would reach files or services on the user's machine and network, including the host's own API.
 *
 * Not covered: a redirect to a private host, and a public name that resolves to a private address (DNS rebinding).
 *
 * @param url - The URL string from the plugin.
 * @param allowPrivateHosts - Lets private hosts through; for tests against a local server.
 * @returns The URL as the parser normalizes it, which callers must use instead of the raw string so the check and the
 * request see the same URL; or the reason to log when the URL is refused.
 */
export const checkUrl = (url: string, allowPrivateHosts: boolean): Result<string, string> => {
  if (!URL.canParse(url)) {
    return err("refused: not an absolute url");
  }
  const parsed = new URL(url);
  if (!ALLOWED_PROTOCOLS.includes(parsed.protocol)) {
    return err(`refused: only http and https urls are allowed, got ${parsed.protocol}`);
  }
  if (!allowPrivateHosts && isPrivateHost(parsed.hostname)) {
    return err("refused: private, loopback and link-local hosts are not allowed");
  }
  return ok(parsed.href);
};

/**
 * Runs a transport request only for an allowed URL, handing it the normalized URL; a refused URL is a `network` error.
 *
 * @param url - The URL string from the plugin.
 * @param allowPrivateHosts - Lets private hosts through; defaults to false.
 * @param run - The request, given the normalized URL.
 * @returns What `run` returns, or the refusal.
 */
export const guardUrl = async <T>(
  url: string,
  allowPrivateHosts: boolean | undefined,
  run: (target: string) => Promise<Result<T, TransportError>>,
): Promise<Result<T, TransportError>> => {
  const checked = checkUrl(url, allowPrivateHosts ?? false);
  return checked.ok ? run(checked.value) : transportFailure(false, checked.error);
};
