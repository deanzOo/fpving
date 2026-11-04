import { text } from "node:stream/consumers";
import { licenseFindings } from "./license-check.ts";

const findings = licenseFindings(JSON.parse(await text(process.stdin)));
for (const finding of findings) {
  console.error(finding);
}
process.exitCode = findings.length > 0 ? 1 : 0;
