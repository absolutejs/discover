import { expect, test } from "bun:test";
import { discoverContactsWithEvidence } from "./discover";
import type { DiscoveryDiagnostic } from "./types";
const source = {
  id: "team",
  url: "https://acme.test/team",
  title: "Team",
  excerpts: ["Jane Doe is CEO at Acme."],
  retrievedAt: "2026-09-26",
};
const search = async (query: string) => ({
  provider: "test",
  version: "1",
  query,
  status: "ok" as const,
  sources: [source],
  attempts: [],
  limitations: [],
});

test("malformed output retains the parse error without exposing it in public limitations", async () => {
  const diagnostics: DiscoveryDiagnostic[] = [];
  const result = await discoverContactsWithEvidence(
    { company: "Acme" },
    {
      searchEvidence: search,
      extract: async () => "not JSON",
      onDiagnostic: (d) => {
        diagnostics.push(d);
      },
    },
  );
  expect(result.status).toBe("unavailable");
  expect(result.limitations).toEqual(["Evidence extraction unavailable"]);
  expect(diagnostics).toHaveLength(1);
  expect(diagnostics[0]?.stage).toBe("extraction");
  expect((diagnostics[0]?.error as Error).message).toBe(
    "Contact extraction returned invalid JSON",
  );
});

test("provider extraction errors and local search rejection reasons survive", async () => {
  const diagnostics: DiscoveryDiagnostic[] = [];
  const failure = new Error("provider unavailable");
  let calls = 0;
  const result = await discoverContactsWithEvidence(
    { company: "Acme" },
    {
      searchEvidence: async (query) =>
        ++calls === 1
          ? search(query)
          : {
              ...(await search(query)),
              status: "rate_limited",
              sources: [],
              limitations: ["Too many searches; retry in 2s"],
            },
      extract: async () => {
        throw failure;
      },
      onDiagnostic: (d) => {
        diagnostics.push(d);
      },
    },
  );
  expect(result.limitations).toEqual([
    "Search rate_limited",
    "Evidence extraction unavailable",
  ]);
  expect(diagnostics[0]).toMatchObject({
    stage: "search",
    status: "rate_limited",
    source: "test",
    limitations: ["Too many searches; retry in 2s"],
  });
  expect(diagnostics[1]?.error).toBe(failure);
});

test("a broken diagnostic observer cannot discard evidence or change failure semantics", async () => {
  const result = await discoverContactsWithEvidence(
    { company: "Acme" },
    {
      sources: [
        {
          name: "offline",
          findPeople: async () => {
            throw new Error("offline");
          },
        },
      ],
      searchEvidence: search,
      extract: async () =>
        JSON.stringify([
          {
            fullName: "Jane Doe",
            title: "CEO",
            source: source.url,
            quote: source.excerpts[0],
          },
        ]),
      onDiagnostic: () => {
        throw new Error("observer failed");
      },
    },
  );
  expect(result.status).toBe("partial");
  expect(result.contacts[0]?.fullName).toBe("Jane Doe");
  expect(result.limitations).toEqual(["Dataset offline unavailable"]);
});

test("cancellation during extraction is rethrown, not diagnosed as provider failure", async () => {
  const controller = new AbortController();
  const reason = new Error("cancelled");
  const diagnostics: DiscoveryDiagnostic[] = [];
  await expect(
    discoverContactsWithEvidence(
      { company: "Acme", signal: controller.signal },
      {
        searchEvidence: search,
        extract: async () => {
          controller.abort(reason);
          throw reason;
        },
        onDiagnostic: (d) => {
          diagnostics.push(d);
        },
      },
    ),
  ).rejects.toBe(reason);
  expect(diagnostics).toEqual([]);
});
