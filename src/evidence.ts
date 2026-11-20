import type { SearchSource } from "@absolutejs/search";

/** Merge repeated URLs without losing distinct passages or changing originals. */
export const deduplicateDiscoveryEvidence = (sources: SearchSource[]) => {
  const merged = new Map<string, SearchSource>();
  for (const source of sources) {
    const prior = merged.get(source.url);
    merged.set(source.url, {
      ...(prior ?? source),
      excerpts: [...new Set([...(prior?.excerpts ?? []), ...source.excerpts])],
    });
  }
  return [...merged.values()];
};

/** The fit predicate must count the actual provider request, not estimate tokens
 * from characters. Every character is retained. Overlap protects quotations at
 * split boundaries; original sources remain authoritative for validation.
 * Iteration is lazy so callers can checkpoint each successful extraction. */
export async function* partitionDiscoveryEvidence(
  sources: SearchSource[],
  fits: (sources: SearchSource[]) => Promise<boolean>,
): AsyncGenerator<SearchSource[]> {
  if (!sources.length) return;
  if (await fits(sources)) {
    yield sources;
    return;
  }
  if (sources.length > 1) {
    const middle = Math.ceil(sources.length / 2);
    yield* partitionDiscoveryEvidence(sources.slice(0, middle), fits);
    yield* partitionDiscoveryEvidence(sources.slice(middle), fits);
    return;
  }
  const source = sources[0]!;
  if (source.excerpts.length > 1) {
    const middle = Math.ceil(source.excerpts.length / 2);
    yield* partitionDiscoveryEvidence([{ ...source, excerpts: source.excerpts.slice(0, middle) }], fits);
    yield* partitionDiscoveryEvidence([{ ...source, excerpts: source.excerpts.slice(middle) }], fits);
    return;
  }
  const characters = Array.from(source.excerpts[0] ?? "");
  if (characters.length < 2)
    throw new Error("Extraction instructions or source metadata exceed model capacity");
  const middle = Math.ceil(characters.length / 2);
  const overlap = Math.min(512, Math.floor(characters.length / 8));
  yield* partitionDiscoveryEvidence([{ ...source, excerpts: [characters.slice(0, middle + overlap).join("")] }], fits);
  yield* partitionDiscoveryEvidence([{ ...source, excerpts: [characters.slice(middle - overlap).join("")] }], fits);
}
