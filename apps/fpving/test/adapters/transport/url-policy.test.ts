import { describe, expect, it } from "vitest";
import { urlRefusal } from "../../../src/adapters/transport/url-policy.ts";

const refused = (url: string): string | undefined => urlRefusal(url, false);

describe("Which URLs a plugin may ask the host to load", () => {
  it.each(["http://shop.example/a", "https://shop.example:8443/a?b=c", "https://8.8.8.8/", "https://172.32.0.1/"])(
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
  ])("refuses the private host of %s", (url) => {
    expect(refused(url)).toContain("private");
  });

  it.each(["http://[2606:4700::1]/", "http://[::ffff:8.8.8.8]/", "http://[fec0::1]/", "http://[fbff::1]/", "http://[2001:db8:1:2:3:4:5:6]/"])(
    "allows the public ipv6 host of %s",
    (url) => {
      expect(refused(url)).toBeUndefined();
    },
  );

  it("allows private hosts only when asked to", () => {
    expect(urlRefusal("http://127.0.0.1:8080/", true)).toBeUndefined();
    expect(urlRefusal("http://localhost/", true)).toBeUndefined();
  });

  it("refuses other schemes even when private hosts are allowed", () => {
    expect(urlRefusal("file:///etc/passwd", true)).toContain("only http and https");
  });
});
