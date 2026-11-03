import { fileURLToPath } from "node:url";
import { build } from "vite";
import { describe, expect, it } from "vitest";

const UI = fileURLToPath(new URL("../../apps/ui/", import.meta.url));
const BUILD_TIMEOUT_MS = 60_000;
const BOOT = /<script\b[^>]*\bsrc="\/theme-boot\.js"[^>]*>/u;
const STYLESHEET = /<link\b[^>]*\brel="stylesheet"[^>]*>/u;

const builtIndex = async (): Promise<string> => {
  const result = await build({ root: UI, logLevel: "silent", build: { write: false } });
  const outputs = Array.isArray(result) ? result : [result];
  const page = outputs
    .flatMap((output) => ("output" in output ? output.output : []))
    .find(({ fileName }) => fileName === "index.html");
  if (page?.type !== "asset" || typeof page.source !== "string") {
    throw new Error("the build has no index.html");
  }
  return page.source;
};

describe("Built UI page head", () => {
  it("runs the theme boot script as a plain blocking script before the stylesheet", async () => {
    const html = await builtIndex();
    const head = html.slice(0, html.indexOf("</head>"));
    const boot = BOOT.exec(head);
    const stylesheet = STYLESHEET.exec(head);
    expect(boot, "the head links /theme-boot.js").not.toBeNull();
    expect(stylesheet, "the head links the stylesheet").not.toBeNull();
    expect(boot?.index).toBeLessThan(stylesheet?.index ?? 0);
    expect(boot?.[0]).not.toMatch(/\b(defer|async|type=)/u);
  }, BUILD_TIMEOUT_MS);
});
