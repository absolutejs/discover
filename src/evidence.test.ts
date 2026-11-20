import { expect, test } from "bun:test";
import { deduplicateDiscoveryEvidence, partitionDiscoveryEvidence } from "./evidence";
import { discoverContactsWithEvidence } from "./discover";
const source = {
  id: "directory", url: "https://example.com/staff.pdf", title: "Staff directory",
  retrievedAt: "2026-11-20", excerpts: ["Jane Example — Director of Partnerships."],
};

test("duplicate URLs retain every distinct passage without mutating saved originals", () => {
  const other = { ...source, excerpts: ["Another passage", ...source.excerpts] };
  expect(deduplicateDiscoveryEvidence([source, other])).toEqual([{ ...source, excerpts: [...source.excerpts, "Another passage"] }]);
  expect(source.excerpts).toHaveLength(1);
});

test("large Unicode documents are consumed fully in fitting overlapping batches", async () => {
  const original = Array.from({ length: 3000 }, (_, i) => `Staff ${i} 🦋. `).join("");
  const fragments: string[] = [];
  for await (const batch of partitionDiscoveryEvidence([{ ...source, excerpts: [original] }], async items => JSON.stringify(items).length < 1800)) {
    expect(JSON.stringify(batch).length).toBeLessThan(1800);
    fragments.push(...batch.flatMap(item => item.excerpts));
  }
  // Coverage of every original character, including boundaries and non-BMP text.
  const covered = new Uint8Array(original.length);
  for (const fragment of fragments) {
    const offset = original.indexOf(fragment);
    expect(offset).toBeGreaterThanOrEqual(0);
    covered.fill(1, offset, offset + fragment.length);
    expect(fragment.isWellFormed()).toBe(true);
  }
  expect(covered.every(Boolean)).toBe(true);
});

test("unfittable request metadata fails rather than recursing forever or dropping text", async () => {
  await expect((async () => {
    for await (const _ of partitionDiscoveryEvidence([source], async () => false)) {}
  })()).rejects.toThrow("metadata exceed model capacity");
});

test("later extraction failure preserves earlier grounded contacts and reports partial", async () => {
  let calls = 0;
  const result = await discoverContactsWithEvidence({ company: "Example", domain: "example.com" }, {
    searchEvidence: async query => ({ attempts: [], limitations: [], provider: "test", query, version: "1", status: "ok", sources: [source, { ...source, id: "second", url: "https://example.com/team", excerpts: ["Other evidence"] }] }),
    fitsExtractionPrompt: async prompt => JSON.parse(prompt.slice(prompt.lastIndexOf("\n") + 1)).length === 1,
    extract: async () => {
      if (++calls === 2) throw new Error("provider interrupted");
      return JSON.stringify([{ fullName: "Jane Example", title: "Director of Partnerships", source: source.url, quote: source.excerpts[0] }]);
    },
  });
  expect(calls).toBe(2);
  expect(result.contacts[0]?.fullName).toBe("Jane Example");
  expect(result.status).toBe("partial");
});
