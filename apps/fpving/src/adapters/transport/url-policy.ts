const ALLOWED_PROTOCOLS: readonly string[] = ["http:", "https:"];
const LOCALHOST = "localhost";
const LOCALHOST_SUFFIX = ".localhost";
const IPV4_PATTERN = /^\d+\.\d+\.\d+\.\d+$/;
const HEX_RADIX = 16;
const OCTET_BITS = 8;
const IPV6_GROUPS = 8;
const MAPPED_PREFIX_GROUPS = 5;
const MAPPED_MARKER = 0xffff;
const UNIQUE_LOCAL_MASK = 0xfe00;
const UNIQUE_LOCAL_PREFIX = 0xfc00;
const LINK_LOCAL_MASK = 0xffc0;
const LINK_LOCAL_PREFIX = 0xfe80;
const OCTET_MASK = 0xff;
const IPV4 = { Any: 0, Loopback: 127, TenNet: 10, Private172: 172, Private192: 192, LinkLocal: 169 } as const;
const IPV4_SECOND = { Private172Min: 16, Private172Max: 31, Private192: 168, LinkLocal: 254 } as const;

const isPrivateIpv4 = (first: number, second: number): boolean =>
  first === IPV4.Any
  || first === IPV4.Loopback
  || first === IPV4.TenNet
  || (first === IPV4.Private172 && second >= IPV4_SECOND.Private172Min && second <= IPV4_SECOND.Private172Max)
  || (first === IPV4.Private192 && second === IPV4_SECOND.Private192)
  || (first === IPV4.LinkLocal && second === IPV4_SECOND.LinkLocal);

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
  const [first = 0] = groups;
  const lastIndex = IPV6_GROUPS - 1;
  if (allZero(groups.slice(0, MAPPED_PREFIX_GROUPS)) && groups[MAPPED_PREFIX_GROUPS] === MAPPED_MARKER) {
    const high = groups[MAPPED_PREFIX_GROUPS + 1] ?? 0;
    return isPrivateIpv4(high >> OCTET_BITS, high & OCTET_MASK);
  }
  return (
    (allZero(groups.slice(0, lastIndex)) && (groups[lastIndex] ?? 0) <= 1)
    || (first & UNIQUE_LOCAL_MASK) === UNIQUE_LOCAL_PREFIX
    || (first & LINK_LOCAL_MASK) === LINK_LOCAL_PREFIX
  );
};

const isPrivateHost = (hostname: string): boolean => {
  const host = hostname.endsWith(".") ? hostname.slice(0, -1) : hostname;
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
 * https URLs are allowed, and by default not those whose literal host is loopback, private or link-local, which would
 * reach files or services on the user's machine and network, including the host's own API.
 *
 * Not covered: a redirect to a private host, and a public name that resolves to a private address (DNS rebinding).
 *
 * @param url - The URL string from the plugin.
 * @param allowPrivateHosts - Lets loopback, private and link-local hosts through; for tests against a local server.
 * @returns A reason to log when the URL is refused, otherwise `undefined`.
 */
export const urlRefusal = (url: string, allowPrivateHosts: boolean): string | undefined => {
  if (!URL.canParse(url)) {
    return "refused: not an absolute url";
  }
  const parsed = new URL(url);
  if (!ALLOWED_PROTOCOLS.includes(parsed.protocol)) {
    return `refused: only http and https urls are allowed, got ${parsed.protocol}`;
  }
  if (!allowPrivateHosts && isPrivateHost(parsed.hostname)) {
    return "refused: private, loopback and link-local hosts are not allowed";
  }
  return undefined;
};
