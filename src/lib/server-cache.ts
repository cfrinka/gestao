/**
 * In-process read cache for the API.
 *
 * Every write the app makes goes through this server (the Firestore rules block browser writes),
 * so the server knows exactly when data changes: any successful write request bumps
 * `dataVersion`, and every cached read keyed to an older version is simply never used again.
 * Between writes, repeated reads (the POS product list, settings, clients, the user's register…)
 * are answered from memory instead of a ~200 ms Firestore round trip each.
 *
 * The TTL only bounds changes made outside this process (Firebase console, a second server
 * instance); it is not what keeps the app correct after its own writes.
 */

const DEFAULT_TTL_MS = 2 * 60 * 1000;
const MAX_ENTRIES = 500;

let dataVersion = 0;

export function bumpDataVersion(): void {
  dataVersion += 1;
}

export function currentDataVersion(): number {
  return dataVersion;
}

interface Entry<T> {
  version: number;
  expiresAt: number;
  promise: Promise<T>;
}

const entries = new Map<string, Entry<unknown>>();

/**
 * Returns the cached value for `key` if it was loaded at the current data version and has not
 * expired; otherwise runs `load` once (concurrent callers share the same in-flight promise).
 * A failed load is not cached.
 */
export function cached<T>(key: string, load: () => Promise<T>, ttlMs: number = DEFAULT_TTL_MS): Promise<T> {
  const now = Date.now();
  const hit = entries.get(key) as Entry<T> | undefined;
  if (hit && hit.version === dataVersion && hit.expiresAt > now) {
    return hit.promise;
  }

  const version = dataVersion;
  const promise = load();
  entries.set(key, { version, expiresAt: now + ttlMs, promise });
  promise.catch(() => {
    const current = entries.get(key);
    if (current && current.promise === promise) entries.delete(key);
  });

  if (entries.size > MAX_ENTRIES) {
    for (const [k, entry] of Array.from(entries.entries())) {
      if (entry.version !== dataVersion || entry.expiresAt <= now) entries.delete(k);
    }
    if (entries.size > MAX_ENTRIES) {
      const oldest = entries.keys().next().value;
      if (oldest !== undefined) entries.delete(oldest);
    }
  }

  return promise;
}

/** Test helper. */
export function resetServerCache(): void {
  entries.clear();
  dataVersion = 0;
}
