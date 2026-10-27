import { generateSpecPage } from "./spec-to-docs.ts";

await generateSpecPage("reports/spec.md", "apps/docs/src/content/docs/reference/behaviour-spec.md");
