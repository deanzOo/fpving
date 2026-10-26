import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";
import starlightTypeDoc, { typeDocSidebarGroup } from "starlight-typedoc";

export default defineConfig({
  site: "https://deanzoo.github.io",
  base: "/fpving",
  integrations: [
    starlight({
      title: "fpving",
      description: "A local-first gear watcher for people entering the FPV drone hobby.",
      social: [{ icon: "github", label: "GitHub", href: "https://github.com/deanzoo/fpving" }],
      editLink: { baseUrl: "https://github.com/deanzoo/fpving/edit/main/apps/docs/" },
      plugins: [
        starlightTypeDoc({
          entryPoints: ["../../packages/plugin-sdk", "../../packages/core"],
          typeDoc: { entryPointStrategy: "packages", outputFileStrategy: "modules" },
          output: "api",
          sidebar: { label: "API reference", collapsed: true },
        }),
      ],
      sidebar: [
        { label: "Start here", items: ["getting-started", "configuration"] },
        { label: "Concepts", items: ["architecture", "writing-a-plugin"] },
        { label: "Project", items: ["contributing", { label: "Decisions (ADRs)", items: [{ autogenerate: { directory: "adr" } }] }] },
        { label: "Reference", items: ["reference/behaviour-spec", typeDocSidebarGroup] },
      ],
    }),
  ],
});
