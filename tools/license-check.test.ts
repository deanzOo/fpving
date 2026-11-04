import { describe, expect, it } from "vitest";
import { licenseFindings } from "./license-check.ts";

const pkg = (name: string, ...versions: string[]) => ({ name, versions, paths: [], license: "ignored" });

describe("License check", () => {
  it("accepts a listing that holds only allowed licenses", () => {
    expect(licenseFindings({ "MIT": [pkg("react", "19.0.0")], "OFL-1.1": [pkg("@fontsource/ibm-plex-sans", "5.0.0")] }))
      .toEqual([]);
  });

  it("accepts LGPL-3.0-or-later, the license of the docs build's image library", () => {
    expect(licenseFindings({ "LGPL-3.0-or-later": [pkg("@img/sharp-libvips-linux-x64", "1.0.0")] })).toEqual([]);
  });

  it("names every version of every package under a license that is not allowed", () => {
    expect(licenseFindings({
      "MIT": [pkg("react", "19.0.0")],
      "GPL-2.0-only": [pkg("copyleft", "1.0.0", "2.0.0"), pkg("other", "3.0.0")],
      "Unknown": [pkg("unlabelled", "4.0.0")],
    })).toEqual([
      "copyleft@1.0.0: GPL-2.0-only",
      "copyleft@2.0.0: GPL-2.0-only",
      "other@3.0.0: GPL-2.0-only",
      "unlabelled@4.0.0: Unknown",
    ]);
  });

  it("fails on an empty listing, so a scan that found nothing cannot pass", () => {
    expect(() => licenseFindings({})).toThrow("no packages");
  });

  it("fails on a listing it cannot read, so a changed output format cannot pass", () => {
    expect(() => licenseFindings({ MIT: "react" })).toThrow();
  });
});
