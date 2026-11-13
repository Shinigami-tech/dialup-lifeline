import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  SEEN_TTL_MS,
  createSeenMap,
  createMemorySeenBackend,
  hydrateSeen,
  isSeen,
  markSeen,
  pruneExpired,
  pruneSeen,
  registerHeard,
} from '../../src/mesh/dedup';

const msgId = fc.integer({ min: 0, max: 0xffffffff });
const timeMs = fc.integer({ min: 0, max: 4_000_000_000_000 });

describe('dedup store (unit)', () => {
  it('24 h boundary: seen at exactly 24 h, unseen 1 ms later', () => {
    const seen = createSeenMap();
    expect(markSeen(seen, 7, 1000)).toBe(true);
    expect(isSeen(seen, 7, 1000 + SEEN_TTL_MS)).toBe(true);
    expect(isSeen(seen, 7, 1000 + SEEN_TTL_MS + 1)).toBe(false);
  });

  it('a live duplicate does not refresh the first-seen time', () => {
    const seen = createSeenMap();
    markSeen(seen, 1, 0);
    markSeen(seen, 1, SEEN_TTL_MS - 1);
    expect(isSeen(seen, 1, SEEN_TTL_MS + 1)).toBe(false);
  });
});

describe('dedup store (properties)', () => {
  it('seen-once: first mark is new, repeats within 24 h are duplicates', () => {
    fc.assert(
      fc.property(msgId, timeMs, fc.array(fc.integer({ min: 0, max: SEEN_TTL_MS }), { maxLength: 10 }), (id, t0, offsets) => {
        const seen = createSeenMap();
        expect(markSeen(seen, id, t0)).toBe(true);
        for (const o of offsets) {
          expect(markSeen(seen, id, t0 + o)).toBe(false);
          expect(isSeen(seen, id, t0 + o)).toBe(true);
        }
      }),
    );
  });

  it('expiry: after more than 24 h the id is unseen and can be marked again', () => {
    fc.assert(
      fc.property(msgId, timeMs, fc.integer({ min: 1, max: 10 * SEEN_TTL_MS }), (id, t0, extra) => {
        const seen = createSeenMap();
        markSeen(seen, id, t0);
        const later = t0 + SEEN_TTL_MS + extra;
        expect(isSeen(seen, id, later)).toBe(false);
        expect(markSeen(seen, id, later)).toBe(true);
      }),
    );
  });

  it('pruning removes exactly the expired entries and never a live one', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.tuple(msgId, timeMs), { selector: (e) => e[0], maxLength: 40 }),
        timeMs,
        (entries, nowMs) => {
          const seen = createSeenMap();
          for (const [id, t] of entries) seen.set(id, t);
          const removed = new Set(pruneExpired(seen, nowMs));
          for (const [id, t] of entries) {
            const live = nowMs - t <= SEEN_TTL_MS;
            expect(seen.has(id)).toBe(live);
            expect(removed.has(id)).toBe(!live);
          }
        },
      ),
    );
  });

  it('backend round-trip: hydrate restores live entries and drops expired ones', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uniqueArray(fc.tuple(msgId, fc.integer({ min: 0, max: 3 * SEEN_TTL_MS })), { selector: (e) => e[0], maxLength: 30 }),
        async (entries) => {
          const nowMs = 3 * SEEN_TTL_MS;
          const backend = createMemorySeenBackend();
          const seen = createSeenMap();
          for (const [id, t] of entries) await registerHeard(seen, backend, id, t);
          const restored = await hydrateSeen(backend, nowMs);
          for (const [id, t] of entries) {
            const live = nowMs - t <= SEEN_TTL_MS;
            expect(restored.get(id)).toBe(live ? t : undefined);
            expect(backend.entries.has(id)).toBe(live);
          }
        },
      ),
    );
  });

  it('pruneSeen keeps memory and backend consistent', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uniqueArray(fc.tuple(msgId, fc.integer({ min: 0, max: 3 * SEEN_TTL_MS })), { selector: (e) => e[0], maxLength: 30 }),
        async (entries) => {
          const backend = createMemorySeenBackend();
          const seen = createSeenMap();
          for (const [id, t] of entries) await registerHeard(seen, backend, id, t);
          await pruneSeen(seen, backend, 3 * SEEN_TTL_MS);
          expect([...backend.entries.keys()].sort()).toEqual([...seen.keys()].sort());
        },
      ),
    );
  });
});
