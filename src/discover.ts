import type {
  DatasetQuery,
  DiscoverDeps,
  DiscoverInput,
  DiscoveredContact,
  WebSearchResult,
} from "./types";

const DEFAULT_LIMIT = 5;
const MAX_SEARCH_RESULTS = 8;
const DEFAULT_CONFIDENCE = 50;
const MIN_CONFIDENCE = 0;
const MAX_CONFIDENCE = 100;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const normalizeName = (value: string) =>
  value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]/g, "");

const dedupeByName = (people: DiscoveredContact[]) => {
  const seen = new Set<string>();

  return people.filter((person) => {
    const key = normalizeName(person.fullName);
    if (!key || seen.has(key)) return false;
    seen.add(key);

    return true;
  });
};

const buildSearchQuery = (input: DiscoverInput) => {
  const role = input.roleIntent ?? "head of partnerships OR business development";

  return `${input.company} ${role} leadership team site:linkedin.com/in`;
};

// For an AGENTIC extract (a web-enabled LLM that searches on its own — e.g.
// Anthropic/OpenAI web-search tools): no pre-fetched results, ask it to research.
const buildResearchPrompt = (input: DiscoverInput) => {
  const limit = input.limit ?? DEFAULT_LIMIT;

  return `Find the right people to contact at a company for a business partnership. Search the web as needed.

COMPANY: ${input.company}${input.domain ? ` (${input.domain})` : ""}
LOOKING FOR: ${input.roleIntent ?? "the decision-maker for partnerships / business development"}
${input.context ? `CONTEXT: ${input.context}\n` : ""}
Identify up to ${limit} REAL, currently-employed people in that role at THIS company. For each, return one JSON object:
{"fullName": "...", "title": "...", "linkedinUrl": "<url or null>", "source": "<where you found them>", "confidence": 0-100, "reason": "one line on why they fit"}

Never invent a name — only people you can actually find. Return [] if none. Output ONLY the JSON array.`;
};

const buildExtractPrompt = (
  input: DiscoverInput,
  results: WebSearchResult[],
) => {
  const limit = input.limit ?? DEFAULT_LIMIT;
  const block = results
    .map(
      (result, index) =>
        `[${index + 1}] ${result.title}\n${result.url}\n${result.snippet ?? ""}`,
    )
    .join("\n\n");

  return `You are finding the right person to contact at a company for a business partnership.

COMPANY: ${input.company}${input.domain ? ` (${input.domain})` : ""}
LOOKING FOR: ${input.roleIntent ?? "the decision-maker for partnerships / business development"}
${input.context ? `CONTEXT: ${input.context}\n` : ""}
SEARCH RESULTS:
${block}

From ONLY the people who actually appear in these results, return the best matches as a JSON array (most relevant first), each object:
{"fullName": "...", "title": "...", "linkedinUrl": "<url or null>", "source": "<result url>", "confidence": 0-100, "reason": "one line on why they fit"}

Rules: real people only — never invent a name; confidence reflects how clearly the results show this person in that role at THIS company; at most ${limit}. Return [] if none qualify. Output ONLY the JSON array.`;
};

const clampConfidence = (value: unknown) =>
  typeof value === "number"
    ? Math.max(MIN_CONFIDENCE, Math.min(MAX_CONFIDENCE, value))
    : DEFAULT_CONFIDENCE;

const stringOrUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

// Pull a JSON array out of an LLM response (tolerates ```json fences / prose).
const parsePeople = (
  text: string,
  company: string,
  domain: string | undefined,
): DiscoveredContact[] => {
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  return parsed.flatMap((item): DiscoveredContact[] => {
    if (!isRecord(item)) return [];
    const fullName = stringOrUndefined(item["fullName"]);
    if (!fullName) return [];
    const linkedin = stringOrUndefined(item["linkedinUrl"]);

    return [
      {
        company,
        confidence: clampConfidence(item["confidence"]),
        domain,
        fullName,
        linkedinUrl: linkedin?.startsWith("http") ? linkedin : undefined,
        reason: stringOrUndefined(item["reason"]),
        source: stringOrUndefined(item["source"]) ?? "web",
        title: stringOrUndefined(item["title"]),
      },
    ];
  });
};

// Find the people worth contacting at a company. Consults importable dataset
// adapters first (free), then falls to LLM+web only if more are needed. Returns
// deduped, confidence-ranked contacts. Provider-agnostic: with no deps it leans
// entirely on `sources`; with `search`+`extract` it can discover from the open
// web. Never throws — a failing source/search/LLM just contributes nothing.
export const discoverContacts = async (
  input: DiscoverInput,
  deps: DiscoverDeps = {},
): Promise<DiscoveredContact[]> => {
  const limit = input.limit ?? DEFAULT_LIMIT;
  const sources = deps.sources ?? [];
  const query: DatasetQuery = {
    company: input.company,
    domain: input.domain,
    limit,
    roleIntent: input.roleIntent,
  };

  const seeded = await Promise.all(
    sources.map((source) =>
      source.findPeople ? source.findPeople(query).catch(() => []) : [],
    ),
  );
  const collected: DiscoveredContact[] = seeded.flat();

  if (deps.extract && (deps.alwaysExtract || collected.length < limit)) {
    const { search, extract } = deps;
    // With a `search` dep: fetch results, then extract from them. Without one,
    // assume `extract` is web-enabled and have it research directly.
    let prompt: string | null = search ? null : buildResearchPrompt(input);
    if (search) {
      const results = (await search(buildSearchQuery(input)).catch(() => []))
        .slice(0, MAX_SEARCH_RESULTS);
      if (results.length > 0) prompt = buildExtractPrompt(input, results);
    }
    if (prompt) {
      const text = await extract(prompt).catch(() => "");
      collected.push(...parsePeople(text, input.company, input.domain));
    }
  }

  return dedupeByName(collected)
    .sort((left, right) => right.confidence - left.confidence)
    .slice(0, limit);
};
