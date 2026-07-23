import { defineManifest, toolFactory } from "@absolutejs/manifest";
import { Type } from "@sinclair/typebox";
import { discoverContacts } from "./discover";
import type { DiscoverDeps } from "./types";

const tool = toolFactory<DiscoverDeps>();

const MAX_CONTACTS = 25;

/* Serializable subset of DiscoverDeps: `alwaysExtract` only. `search` and
 * `extract` are function-valued → wiring concerns; `sources` is filled by
 * dataset adapters (`discover/dataset-source`). Like logs' sinks, `sources`
 * is an array while a v1 slot resolves to ONE adapter — fan-out across
 * several datasets is wired by hand today. */
export const manifest = defineManifest<DiscoverDeps, DiscoverDeps>()({
  contract: 2,
  identity: {
    accent: "#3b82f6",
    category: "growth",
    description:
      "In-house B2B decision-maker discovery — find the right person at a company without paying PDL/Apollo per search. Consults importable open-data adapters first (GLEIF, SEC EDGAR, GitHub — free), then falls to your own LLM + web search only when it needs more. The LLM may only rank people who appear in the results, never invent names; results are deduped and ranked by confidence, and failures contribute nothing rather than throwing.",
    docsUrl: "https://github.com/absolutejs/discover",
    name: "@absolutejs/discover",
    tagline: "Find the right person to contact at any company.",
  },
  settings: Type.Object({
    alwaysExtract: Type.Optional(
      Type.Boolean({
        description:
          "Always run the LLM + web step and merge it with dataset results, even when the free datasets already returned enough people. Use when you need role-specific contacts rather than generic executives.",
        title: "Always search the web",
      }),
    ),
  }),
  slots: {
    sources: {
      configPath: "sources",
      contract: "discover/dataset-source",
      description:
        "Free open-data sources consulted before the paid LLM/web path",
      known: [
        "@absolutejs/dataset-gleif",
        "@absolutejs/dataset-sec-edgar",
        "@absolutejs/dataset-github",
      ],
    },
  },
  tools: {
    find_contacts: tool.runtime({
      annotations: { idempotentHint: true, openWorldHint: true },
      authorization: {
        approval: "never",
        audience: "authenticated",
        destinations: ["configured-contact-research-provider"],
        effects: ["read", "external-network"],
        idempotency: { mode: "host" },
        requiredScopes: ["contacts:discover"],
        reversible: false,
      },
      description:
        "Find likely decision-makers at a company for a role intent (e.g. 'head of partnerships'). Returns people with title, confidence (0–100), source, and a reason — from open datasets first, then LLM + web when wired.",
      handler: async (input, deps) =>
        JSON.stringify(await discoverContacts(input, deps)),
      input: Type.Object({
        company: Type.String({ minLength: 1 }),
        context: Type.Optional(
          Type.String({
            description:
              "Extra context for ranking (the partnership angle, your offer…).",
          }),
        ),
        domain: Type.Optional(Type.String({ examples: ["acme.com"] })),
        limit: Type.Optional(
          Type.Integer({ maximum: MAX_CONTACTS, minimum: 1 }),
        ),
        roleIntent: Type.Optional(
          Type.String({ examples: ["head of partnerships"] }),
        ),
      }),
    }),
  },
  wiring: [
    {
      description:
        "Assemble the discovery dependencies: free dataset adapters plus your own web search and LLM completion for the fallback path.",
      id: "default",
      server: {
        code: [
          "const discoverDeps: DiscoverDeps = {",
          "\talwaysExtract: ${settings.alwaysExtract},",
          "\t// TODO: wire any LLM completion that returns text — enables the",
          "\t// web-extraction fallback (e.g. @absolutejs/ai).",
          "\t// extract: (prompt) => askYourModel(prompt),",
          "\t// TODO: wire a web search (Brave, SerpAPI, @absolutejs/rag).",
          "\t// search: (query) => webSearch(query),",
          "\tsources: [${slot.sources}]",
          "};",
          "",
          "// const contacts = await discoverContacts(",
          "// \t{ company: 'Acme', roleIntent: 'head of partnerships' },",
          "// \tdiscoverDeps",
          "// );",
        ].join("\n"),
        imports: [
          {
            from: "@absolutejs/discover",
            names: ["DiscoverDeps"],
            typeOnly: true,
          },
        ],
        placement: "module-scope",
      },
      title: "Assemble the discovery pipeline",
    },
  ],
});
