import { test, expect } from "bun:test";
import {
  discoverContactsWithEvidence,
  mergeDiscoveredContacts,
} from "./discover";
import { withCache } from "./cache";
const source = {
  id: "https://acme.com/team",
  url: "https://acme.com/team",
  title: "Team",
  retrievedAt: "2026-09-24T00:00:00Z",
  excerpts: ["Jane Doe — Head of Partnerships at Acme."],
};
test("rejects invented sources and unsupported employment", async () => {
  for (const override of [
    {},
    { source: "https://invented.com" },
    { quote: "Jane Doe — CEO at Other." },
  ]) {
    const result = await discoverContactsWithEvidence(
      { company: "Acme", domain: "acme.com" },
      {
        searchEvidence: async (query) => ({
          provider: "test",
          version: "1",
          query,
          status: "ok",
          sources: [source],
          attempts: [],
          limitations: [],
        }),
        extract: async () =>
          JSON.stringify([
            {
              fullName: "Jane Doe",
              title: "Head of Partnerships",
              source: source.url,
              quote: source.excerpts[0],
              ...override,
            },
          ]),
      },
    );
    expect(result.contacts.length).toBe(Object.keys(override).length ? 0 : 1);
  }
});
test("outage is unavailable and never invokes evidence-only extraction", async () => {
  let calls = 0;
  const result = await discoverContactsWithEvidence(
    { company: "Acme" },
    {
      searchEvidence: async (query) => ({
        provider: "x",
        version: "1",
        query,
        status: "quota_exceeded",
        sources: [],
        attempts: [],
        limitations: [],
      }),
      extract: async () => {
        calls++;
        return "[]";
      },
    },
  );
  expect(result.status).toBe("unavailable");
  expect(calls).toBe(0);
});
test("stronger evidence wins without merging homonyms or non-Latin names", () => {
  const base = {
    fullName: "李明",
    title: "CEO",
    company: "Acme",
    source: "dataset",
    confidence: 20,
  };
  const results = mergeDiscoveredContacts([
    base,
    { ...base, confidence: 85, source: "web" },
    { ...base, fullName: "王明" },
    { ...base, company: "Other" },
  ]);
  expect(results).toHaveLength(3);
  expect(results[0]?.source).toBe("web");
});
test("dataset cache coalesces and does not retain failures", async () => {
  let calls = 0;
  const cached = withCache({
    name: "test",
    findPeople: async () => {
      calls++;
      await Promise.resolve();
      throw Error("down");
    },
  });
  await Promise.allSettled([
    cached.findPeople!({ company: "Acme" }),
    cached.findPeople!({ company: "Acme" }),
  ]);
  expect(calls).toBe(1);
  await cached.findPeople!({ company: "Acme" }).catch(() => {});
  expect(calls).toBe(2);
});

test('malformed extraction is unavailable, not a successful negative lookup',async()=>{
 const result=await discoverContactsWithEvidence({company:'Acme',domain:'acme.com'}, {searchEvidence:async query=>({provider:'test',version:'1',query,status:'ok',sources:[source],attempts:[],limitations:[]}),extract:async()=>'{bad json'});
 expect(result.status).toBe('unavailable');
});
test('matching roles merge stronger later evidence even when a seed lacks its profile URL',()=>{
 const seed={fullName:'Jane Doe',title:'Partnerships',company:'Acme',source:'seed',confidence:90};
 const web={...seed,source:'web',confidence:65,linkedinUrl:'https://linkedin.com/in/jane',evidence:[{url:source.url,quote:source.excerpts[0]!}]};
 expect(mergeDiscoveredContacts([seed,web])).toHaveLength(1);expect(mergeDiscoveredContacts([seed,web])[0]?.source).toBe('web');
});
