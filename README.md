# @absolutejs/discover

Find the right **person** to contact at a company — the decision-maker PDL/Apollo
charge per person-search for. Provider-agnostic orchestration: it consults
importable **dataset adapters** first (free), then falls to **LLM + web** only
when it needs more.

> Licensed under **BSL 1.1** (converts to Apache 2.0 on 2030-06-06). Use it to
> build your product; you may not host it as a competing prospecting/sales-
> intelligence SaaS. See `LICENSE`.

```ts
import { discoverContacts } from "@absolutejs/discover";

await discoverContacts(
  { company: "Acme", domain: "acme.com", roleIntent: "head of partnerships" },
  { sources: [secEdgar, gleif], search: braveSearch, extract: askClaude },
);
// → [{ fullName: "Jane Doe", title: "Head of Partnerships", confidence: 90,
//      linkedinUrl: "...", source: "...", reason: "listed as partnerships lead" }]
```

## The dataset adapter contract

Open-data sources are importable adapters implementing one interface, so seeded
public data is free and the paid LLM/web path is the fallback:

```ts
type DatasetSource = {
  name: string;
  findPeople?: (q: DatasetQuery) => Promise<NormalizedPerson[]>;
  findCompany?: (q: { name?; domain? }) => Promise<NormalizedCompany | null>;
};
```

`@absolutejs/dataset-gleif`, `-sec-edgar`, `-github`, … each implement this over
a public dataset and normalize to one shape. **Adapters are pure importers of
public data.** The self-collected, self-healing dataset (learned email patterns,
the cross-member graph, outcomes) is deliberately **not** an adapter — it stays
private; it's the product.

## Bring your own LLM + web

`discover` stays provider-agnostic — you inject the capabilities:

```ts
type DiscoverDeps = {
  search?: (query: string) => Promise<WebSearchResult[]>; // Brave, SerpAPI, RAG…
  extract?: (prompt: string) => Promise<string>;          // any LLM completion
  sources?: DatasetSource[];                               // importable adapters
};
```

With no deps it returns only what the adapters provide. With `search` + `extract`
it discovers from the open web (the LLM is told to use *only* people who appear
in the results — never to invent names). Results are deduped and ranked by
confidence. Never throws — a failing source / search / LLM just contributes
nothing.
