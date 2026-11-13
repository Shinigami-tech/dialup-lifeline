// Dedup ("seen") store for the mesh relay. Pure logic, no DOM, no clock access:
// callers pass `nowMs` explicitly so everything is testable in Node.
//
// Semantics: an id is "seen" while its age (nowMs - firstSeenMs) is <= SEEN_TTL_MS.
// Strictly after 24 h it is expired and treated as unseen again.

export const SEEN_TTL_MS = 24 * 60 * 60 * 1000;

/** msgId (uint32) -> first time heard, in epoch milliseconds. */
export type SeenMap = Map<number, number>;

export interface SeenEntry {
  readonly msgId: number;
  readonly firstSeenMs: number;
}

/** Persistence port. Implemented by IndexedDB in the browser and by memory in tests. */
export interface SeenBackend {
  loadAll(): Promise<SeenEntry[]>;
  put(entry: SeenEntry): Promise<void>;
  remove(msgIds: readonly number[]): Promise<void>;
}

export function createSeenMap(): SeenMap {
  return new Map();
}

function isLive(firstSeenMs: number, nowMs: number, ttlMs: number): boolean {
  return nowMs - firstSeenMs <= ttlMs;
}

/** True if the id was heard within the last `ttlMs`. Does not modify the map. */
export function isSeen(seen: SeenMap, msgId: number, nowMs: number, ttlMs = SEEN_TTL_MS): boolean {
  const t = seen.get(msgId);
  return t !== undefined && isLive(t, nowMs, ttlMs);
}

/**
 * Record an id. Returns true if it was unseen (new or expired), false if it is a live duplicate.
 * A live duplicate keeps its original first-seen time, so entries cannot be kept alive forever by repeats.
 */
export function markSeen(seen: SeenMap, msgId: number, nowMs: number, ttlMs = SEEN_TTL_MS): boolean {
  if (isSeen(seen, msgId, nowMs, ttlMs)) return false;
  seen.set(msgId, nowMs);
  return true;
}

/** Remove expired entries; returns the removed ids. Live entries are never touched. */
export function pruneExpired(seen: SeenMap, nowMs: number, ttlMs = SEEN_TTL_MS): number[] {
  const removed: number[] = [];
  for (const [msgId, t] of seen) {
    if (!isLive(t, nowMs, ttlMs)) removed.push(msgId);
  }
  for (const msgId of removed) seen.delete(msgId);
  return removed;
}

/** Load persisted entries, dropping (and deleting from the backend) any that already expired. */
export async function hydrateSeen(
  backend: SeenBackend,
  nowMs: number,
  ttlMs = SEEN_TTL_MS,
): Promise<SeenMap> {
  const seen = createSeenMap();
  const expired: number[] = [];
  for (const e of await backend.loadAll()) {
    if (isLive(e.firstSeenMs, nowMs, ttlMs)) seen.set(e.msgId, e.firstSeenMs);
    else expired.push(e.msgId);
  }
  if (expired.length > 0) await backend.remove(expired);
  return seen;
}

/** Mark an id as heard and persist it if new. Resolves to true if it was unseen. */
export async function registerHeard(
  seen: SeenMap,
  backend: SeenBackend,
  msgId: number,
  nowMs: number,
  ttlMs = SEEN_TTL_MS,
): Promise<boolean> {
  const fresh = markSeen(seen, msgId, nowMs, ttlMs);
  if (fresh) await backend.put({ msgId, firstSeenMs: nowMs });
  return fresh;
}

/** Prune memory and backend together. */
export async function pruneSeen(
  seen: SeenMap,
  backend: SeenBackend,
  nowMs: number,
  ttlMs = SEEN_TTL_MS,
): Promise<number> {
  const removed = pruneExpired(seen, nowMs, ttlMs);
  if (removed.length > 0) await backend.remove(removed);
  return removed.length;
}

/** In-memory backend for tests and for private-mode fallback. */
export function createMemorySeenBackend(): SeenBackend & { readonly entries: Map<number, number> } {
  const entries = new Map<number, number>();
  return {
    entries,
    async loadAll() {
      return [...entries].map(([msgId, firstSeenMs]) => ({ msgId, firstSeenMs }));
    },
    async put(e) {
      entries.set(e.msgId, e.firstSeenMs);
    },
    async remove(ids) {
      for (const id of ids) entries.delete(id);
    },
  };
}
