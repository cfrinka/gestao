/**
 * In-process read cache for the API.
 *
 * Every write the app makes goes through this server (the Firestore rules block browser writes),
 * so the server knows exactly when data changes: any successful write request bumps
 * `dataVersion`, and every cached read keyed to an older version is simply never used again.
 * Between writes, repeated reads (the POS product list, settings, clients, the user's register…)
 * are answered from memory instead of a ~200 ms Firestore round trip each.
 *
 * After a write, reads that someone used in the last few minutes are recomputed in the
 * background, so the next person opening Vendas or Início after a sale finds them ready instead
 * of paying for the recomputation.
 *
 * The TTL only bounds changes made outside this process (Firebase console, a second server
 * instance); it is not what keeps the app correct after its own writes.
 */

const DEFAULT_TTL_MS = 2 * 60 * 1000;
const MAX_ENTRIES = 500;
/** Reads used within this window are recomputed right after a write. */
const REFRESH_WINDOW_MS = 5 * 60 * 1000;
/** Writes often come in bursts (a sale, then its receipt reprint, a payment…): refresh once. */
const REFRESH_DEBOUNCE_MS = 250;
const REFRESH_CONCURRENCY = 3;

let dataVersion = 0;

interface Entry<T> {
  version: number;
  expiresAt: number;
  ttlMs: number;
  promise: Promise<T>;
  load: () => Promise<T>;
  lastAccess: number;
}

const entries = new Map<string, Entry<unknown>>();
let refreshTimer: ReturnType<typeof setTimeout> | null = null;

export function bumpDataVersion(): void {
  dataVersion += 1;
  scheduleRefresh();
}

export function currentDataVersion(): number {
  return dataVersion;
}

function store<T>(key: string, load: () => Promise<T>, ttlMs: number, lastAccess: number): Promise<T> {
  const promise = load();
  const entry: Entry<T> = { version: dataVersion, expiresAt: Date.now() + ttlMs, ttlMs, promise, load, lastAccess };
  entries.set(key, entry as Entry<unknown>);
  promise.catch(() => {
    if (entries.get(key)?.promise === promise) entries.delete(key);
  });
  return promise;
}

/**
 * Returns the cached value for `key` if it was loaded at the current data version and has not
 * expired; otherwise runs `load` once (concurrent callers share the same in-flight promise).
 * A failed load is not cached.
 */
export function cached<T>(key: string, load: () => Promise<T>, ttlMs: number = DEFAULT_TTL_MS): Promise<T> {
  const now = Date.now();
  const hit = entries.get(key) as Entry<T> | undefined;
  if (hit && hit.version === dataVersion && hit.expiresAt > now) {
    hit.lastAccess = now;
    return hit.promise;
  }

  const promise = store(key, load, ttlMs, now);
  prune(now);
  return promise;
}

function prune(now: number) {
  if (entries.size <= MAX_ENTRIES) return;
  for (const [k, entry] of Array.from(entries.entries())) {
    if (now - entry.lastAccess > REFRESH_WINDOW_MS || entry.expiresAt <= now) entries.delete(k);
  }
  while (entries.size > MAX_ENTRIES) {
    const oldest = entries.keys().next().value;
    if (oldest === undefined) break;
    entries.delete(oldest);
  }
}

function scheduleRefresh() {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    void refreshRecentlyUsed();
  }, REFRESH_DEBOUNCE_MS);
}

async function refreshRecentlyUsed() {
  const now = Date.now();
  const due = Array.from(entries.entries()).filter(
    ([, entry]) => entry.version !== dataVersion && now - entry.lastAccess <= REFRESH_WINDOW_MS
  );

  let next = 0;
  const worker = async () => {
    while (next < due.length) {
      const [key, entry] = due[next++];
      const current = entries.get(key);
      // Someone may already have reloaded it at the new version.
      if (!current || current.version === dataVersion) continue;
      await store(key, entry.load, entry.ttlMs, entry.lastAccess).catch(() => undefined);
    }
  };
  await Promise.all(Array.from({ length: REFRESH_CONCURRENCY }, worker));
}

/** Test helper. */
export function resetServerCache(): void {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = null;
  entries.clear();
  dataVersion = 0;
}
