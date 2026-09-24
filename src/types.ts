import type { SearchResult } from "@absolutejs/search";
// The normalized shapes every dataset adapter emits and discover returns. Keep
// these stable: open-data adapters (@absolutejs/dataset-gleif, -sec-edgar, …)
// and the LLM/web path both produce them, so callers see one consistent type.

export type NormalizedCompany = {
  name: string;
  domain?: string;
  industry?: string;
  size?: string;
  country?: string;
  /** The source's own identifier — LEI (GLEIF), CIK (SEC), company number, … —
   *  the key to follow up for relationships/filings in that registry. */
  registryId?: string;
  /** Which adapter / source produced this (e.g. "gleif", "sec-edgar", "web"). */
  source: string;
};

export type NormalizedPerson = {
  fullName: string;
  title?: string;
  company?: string;
  domain?: string;
  linkedinUrl?: string;
  /** A public email when the source carries one (e.g. a GitHub profile email) —
   *  lets the caller skip pattern-guessing for this contact. Usually absent. */
  email?: string;
  /** Notable track record — past companies founded/led, exits, prior senior
   *  roles. High signal for business outreach (a proven operator is worth
   *  reaching even if currently an IC); distinct from `title` (current role). */
  background?: string;
  /** Which adapter / source produced this. */
  source: string;
  /** 0–100 — how sure we are this is a real person in this role here. */
  confidence: number;
};

export type DatasetQuery = {
  company?: string;
  domain?: string;
  /** e.g. "head of partnerships", "VP of BD", "founder". */
  roleIntent?: string;
  limit?: number;
};

// A DATASET ADAPTER — an importable source of people/companies. This is the
// contract every `@absolutejs/dataset-*` adapter implements (GLEIF, SEC EDGAR,
// GitHub, OpenCorporates, …). discover consults these BEFORE spending an LLM/web
// call, so seeded open data is free and the paid path is the fallback. Adapters
// are pure importers of public data; the self-collected, self-healing dataset
// stays private (it's the product), it is not an adapter.
export type DatasetSource = {
  name: string;
  findPeople?: (query: DatasetQuery) => Promise<NormalizedPerson[]>;
  findCompany?: (query: {
    name?: string;
    domain?: string;
  }) => Promise<NormalizedCompany | null>;
};

export type WebSearchResult = {
  title: string;
  url: string;
  snippet?: string;
};

// Bring-your-own capabilities — discover stays provider-agnostic. `search` is any
// web search (Brave, SerpAPI, @absolutejs/rag web research…); `extract` is any
// LLM completion that returns text (we parse the JSON out of it). Both optional:
// with neither, discover returns only what the dataset `sources` provide.
export type DiscoverDeps = {
  search?: (query: string) => Promise<WebSearchResult[]>;
  extract?: (prompt: string) => Promise<string>;
  searchEvidence?: (
    query: string,
    signal?: AbortSignal,
  ) => Promise<SearchResult>;
  /** Explicit source-bound fallback; never infer web capability from extraction. */
  research?: (query: string, signal?: AbortSignal) => Promise<SearchResult>;
  maxQueries?: number;
  sources?: DatasetSource[];
  /** By default the LLM/web call is skipped once `sources` already returned
   *  `limit` people (a cost optimization). Set this when the web path is more
   *  RELEVANT than the seeds (e.g. seeds are generic execs but you want a
   *  role-specific contact): the web call always runs and its results are merged
   *  + ranked with the seeds, so the better match still surfaces first. */
  alwaysExtract?: boolean;
};

export type DiscoverInput = {
  signal?: AbortSignal;
  company: string;
  domain?: string;
  roleIntent?: string;
  /** Extra context for the LLM (the partnership angle, the member's offer…). */
  context?: string;
  limit?: number;
};

export type DiscoveredContact = NormalizedPerson & {
  /** One line on why this person fits the role intent, when the LLM gives it. */
  reason?: string;
  evidence?: { url: string; quote: string; retrievedAt?: string }[];
};
