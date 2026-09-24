import type {
  DatasetSource,
  NormalizedCompany,
  NormalizedPerson,
} from "./types";
type Value = NormalizedCompany | NormalizedPerson[] | null;
export type DatasetCacheEntry = { value: Value; expiresAt: number };
export type WithCacheOptions = {
  ttlMs?: number;
  emptyTtlMs?: number;
  capacity?: number;
  now?: () => number;
  store?: {
    get: (key: string) => Promise<DatasetCacheEntry | undefined>;
    set: (key: string, entry: DatasetCacheEntry) => Promise<void>;
  };
};
export const withCache = (
  source: DatasetSource,
  options: WithCacheOptions = {},
): DatasetSource => {
  const cache = new Map<string, DatasetCacheEntry>(),
    pending = new Map<string, Promise<Value>>();
  const now = options.now ?? Date.now;
  const capacity = options.capacity ?? 500;
  if (!Number.isInteger(capacity) || capacity < 1)
    throw new Error("Cache capacity must be positive");
  const load = async <T extends Value>(
    kind: string,
    query: object,
    fetchValue: () => Promise<T>,
  ): Promise<T> => {
    const key = JSON.stringify([
      source.name,
      kind,
      Object.entries(query)
        .filter(([key]) => key !== "signal")
        .sort(([a], [b]) => a.localeCompare(b)),
    ]);
    const cached = cache.get(key) ?? (await options.store?.get(key));
    if (cached && cached.expiresAt > now())
      return structuredClone(cached.value) as T;
    cache.delete(key);
    const inFlight = pending.get(key);
    if (inFlight) return structuredClone(await inFlight) as T;
    const work = (async () => {
      const value = await fetchValue();
      const empty = value === null || (Array.isArray(value) && !value.length);
      const ttl = empty
        ? (options.emptyTtlMs ?? 60000)
        : (options.ttlMs ?? 86400000);
      if (ttl > 0) {
        const entry = { value: structuredClone(value), expiresAt: now() + ttl };
        while (cache.size >= capacity) cache.delete(cache.keys().next().value!);
        cache.set(key, entry);
        await options.store?.set(key, entry);
      }
      return value;
    })();
    pending.set(key, work);
    try {
      return await work;
    } finally {
      pending.delete(key);
    }
  };
  return {
    name: source.name,
    ...(source.findPeople
      ? {
          findPeople: (
            query: Parameters<NonNullable<DatasetSource["findPeople"]>>[0],
          ) => load("people", query, () => source.findPeople!(query)),
        }
      : {}),
    ...(source.findCompany
      ? {
          findCompany: (
            query: Parameters<NonNullable<DatasetSource["findCompany"]>>[0],
          ) => load("company", query, () => source.findCompany!(query)),
        }
      : {}),
  };
};
