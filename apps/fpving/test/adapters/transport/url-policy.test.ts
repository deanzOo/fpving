import { describe, expect, it } from "vitest";
import { checkUrl, checkWebSocketUrl } from "../../../src/adapters/transport/url-policy.ts";

const refused = (url: string): string | undefined => {
  const checked = checkUrl(url, false);
  return checked.ok ? undefined : checked.error;
};

describe("Which URLs a plugin may ask the host to load", () => {
  it.each(["http://shop.example/a", "https://shop.example:8443/a?b=c", "https://8.8.8.8/", "https://172.32.0.1/", "https://100.63.255.255/", "https://100.128.0.1/"])(
    "allows the public url %s",
    (url) => {
      expect(refused(url)).toBeUndefined();
    },
  );

  it.each([
    "file:///etc/passwd",
    "ftp://shop.example/file",
    "data:text/html,hi",
    "javascript:alert(1)",
    "chrome://settings",
    "about:blank",
    "blob:https://shop.example/1",
    "ws://shop.example/",
  ])("refuses the scheme of %s", (url) => {
    expect(refused(url)).toContain("only http and https");
  });

  it.each(["not a url", "", "//shop.example/a", "/relative"])("refuses the malformed url %j", (url) => {
    expect(refused(url)).toContain("not an absolute url");
  });

  it.each([
    "http://localhost/",
    "http://LOCALHOST:3000/",
    "http://localhost./",
    "http://api.localhost/",
    "http://127.0.0.1/",
    "http://127.255.255.254/",
    "http://0.0.0.0/",
    "http://10.0.0.1/",
    "http://10.255.255.255/",
    "http://172.16.0.1/",
    "http://172.31.255.255/",
    "http://192.168.0.1/",
    "http://192.168.255.255/",
    "http://169.254.169.254/",
    "http://2130706433/",
    "http://0x7f.1/",
    "http://[::1]/",
    "http://[::]/",
    "http://[0:0:0:0:0:0:0:1]/",
    "http://[fc00::1]/",
    "http://[fd12:3456::1]/",
    "http://[fe80::1]/",
    "http://[febf::1]/",
    "http://[::ffff:127.0.0.1]/",
    "http://[::ffff:10.0.0.1]/",
    "http://[fc00:1:2:3:4:5:6:7]/",
    "http://localhost../",
    "http://api.localhost.../",
    "http://100.64.0.1/",
    "http://100.127.255.255/",
    "http://[::127.0.0.1]/",
    "http://[::10.0.0.1]/",
    "http://[::ffff:0:127.0.0.1]/",
    "http://[::ffff:0:192.168.1.1]/",
    "http://[64:ff9b::127.0.0.1]/",
    "http://[64:ff9b::169.254.169.254]/",
    "http://[fec0::1]/",
    "http://[feff::1]/",
    "http://224.0.0.1/",
    "http://239.255.255.255/",
    "http://255.255.255.255/",
    "http://240.0.0.1/",
    "http://254.255.255.255/",
    "http://255.255.254.255/",
    "http://198.18.0.1/",
    "http://198.19.255.255/",
    "http://192.0.0.1/",
    "http://192.0.0.255/",
    "http://[ff00::1]/",
    "http://[ff02::1]/",
    "http://[::ffff:224.0.0.1]/",
    "http://[::ffff:255.255.255.255]/",
    "http://[::ffff:192.0.0.8]/",
  ])("refuses the private host of %s", (url) => {
    expect(refused(url)).toContain("private");
  });

  it("names every kind of host it refuses", () => {
    expect(refused("http://224.0.0.1/")).toBe(
      "refused: private, loopback, link-local and other non-public hosts are not allowed",
    );
  });

  it.each(["https://223.255.255.255/", "https://198.17.255.255/", "https://198.20.0.1/", "https://192.0.1.1/"])(
    "allows the public ipv4 host next to a refused range, %s",
    (url) => {
      expect(refused(url)).toBeUndefined();
    },
  );

  it.each(["http://[2606:4700::1]/", "http://[::ffff:8.8.8.8]/", "http://[fbff::1]/", "http://[2001:db8:1:2:3:4:5:6]/", "http://[::ffff:0:8.8.8.8]/", "http://[64:ff9b::8.8.8.8]/", "http://[::8.8.8.8]/"])(
    "allows the public ipv6 host of %s",
    (url) => {
      expect(refused(url)).toBeUndefined();
    },
  );

  it("allows private hosts only when asked to", () => {
    expect(checkUrl("http://127.0.0.1:8080/", true)).toEqual({ ok: true, value: "http://127.0.0.1:8080/" });
    expect(checkUrl("http://localhost/", true).ok).toBe(true);
  });

  it("refuses other schemes even when private hosts are allowed", () => {
    expect(checkUrl("file:///etc/passwd", true).ok).toBe(false);
  });

  it("returns the url as the parser normalizes it", () => {
    expect(checkUrl("HTTPS://Shop.Example:443/a b?q=1#x", false)).toEqual({
      ok: true,
      value: "https://shop.example/a%20b?q=1#x",
    });
  });
});

const refusedSocket = (url: string, allowPrivateHosts: boolean): string | undefined => {
  const checked = checkWebSocketUrl(url, allowPrivateHosts);
  return checked.ok ? undefined : checked.error;
};

describe("Which WebSocket URLs a page may open", () => {
  it.each([["ws://shop.example/live", "ws://shop.example/live"], ["wss://shop.example:8443/live", "wss://shop.example:8443/live"]])(
    "allows the public url %s",
    (url, normalized) => {
      expect(checkWebSocketUrl(url, false)).toEqual({ ok: true, value: normalized });
    },
  );

  it.each(["ws://127.0.0.1:9/socket", "wss://localhost/socket", "ws://[::1]/", "ws://10.0.0.1/", "ws://240.0.0.1/"])(
    "refuses the private host of %s",
    (url) => {
      expect(refusedSocket(url, false)).toContain("private");
    },
  );

  it("allows a private host only when private hosts are allowed", () => {
    expect(checkWebSocketUrl("ws://127.0.0.1:9/socket", true)).toEqual({ ok: true, value: "ws://127.0.0.1:9/socket" });
  });

  it.each(["http://shop.example/", "https://shop.example/", "file:///etc/passwd"])(
    "refuses the non-websocket scheme of %s",
    (url) => {
      expect(refusedSocket(url, true)).toContain("only ws and wss");
    },
  );

  it("refuses a malformed url", () => {
    expect(checkWebSocketUrl("not a url", true)).toEqual({ ok: false, error: "refused: not an absolute url" });
  });
});
