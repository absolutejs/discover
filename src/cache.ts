import { createWriteBehindCache } from "@absolutejs/sync/write-behind-cache";
import type {
  DatasetQuery,
  DatasetSource,
  NormalizedCompany,
  NormalizedPerson,
} from "./types";

const HOURS_PER_DAY = 24;
const MINUTES_PER_HOUR = 60;
const SECONDS_PER_MINUTE = 60;
const MS_PER_SECOND = 1000;
const DEFAULT_TTL_MS =
  HOURS_PER_DAY * MINUTES_PER_HOUR * SECONDS_PER_MINUTE * MS_PER_SECOND;

type TimedEntry<V> = { value: V; fetchedAt: number };

const queryKey = (query: DatasetQuery) =>
  [
    query.company ?? "",
    query.domain ?? "",
    query.roleIntent ?? "",
    String(query.limit ?? ""),
  ]
    .join("|")
    .toLowerCase();

const companyKey = (input: { name?: string; domain?: string }) =>
  [input.name ?? "", input.domain ?? ""].join("|").toLowerCase();

export type WithCacheOptions = {
  /** Entries older than this are re-fetched. Default 24h. */
  ttlMs?: number;
  /** Injectable clock (for tests). */
  now?: () => number;
};

// Wrap a DatasetSource with a TTL'd read-through cache so repeated lookups for
// the same company skip the (often many-call) API hit — e.g. SEC's ~10 and
// GitHub's ~15 requests collapse to one per company per TTL window. Backed by
// @absolutejs/sync's write-behind cache primitive; in-memory today, and ready to
// gain a durable cross-instance store through that primitive's load/persist
// hooks without changing this surface.
export const withCache = (
  source: DatasetSource,
  options: WithCacheOptions = {},
): DatasetSource => {
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const now = options.now ?? (() => Date.now());

  const noLoad = () => undefined;
  const noPersist = () => undefined;
  const peopleCache = createWriteBehindCache<
    string,
    TimedEntry<NormalizedPerson[]>
  >({ load: noLoad, persist: noPersist });
  const companyCache = createWriteBehindCache<
    string,
    TimedEntry<NormalizedCompany | null>
  >({ load: noLoad, persist: noPersist });

  const result: DatasetSource = { name: source.name };

  const findCompanyImpl = source.findCompany;
  if (findCompanyImpl) {
    result.findCompany = async (input) => {
      const key = companyKey(input);
      const entry = companyCache.peek(key);
      if (entry !== undefined && now() - entry.fetchedAt < ttlMs) {
        return entry.value;
      }
      const value = await findCompanyImpl(input);
      companyCache.set(key, { fetchedAt: now(), value });

      return value;
    };
  }

  const findPeopleImpl = source.findPeople;
  if (findPeopleImpl) {
    result.findPeople = async (query) => {
      const key = queryKey(query);
      const entry = peopleCache.peek(key);
      if (entry !== undefined && now() - entry.fetchedAt < ttlMs) {
        return entry.value;
      }
      const value = await findPeopleImpl(query);
      peopleCache.set(key, { fetchedAt: now(), value });

      return value;
    };
  }

  return result;
};
