import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { PACKET_VERSION, validatePacket, type Packet } from '../../src/packet';
import {
  RELAY_DELAY_MAX_MS,
  RELAY_DELAY_MIN_MS,
  createRelayState,
  due,
  nextDueMs,
  onHeard,
  randomRelayDelayMs,
} from '../../src/mesh/relay';

function makePacket(msgId: number, hop: number, ttl: number): Packet {
  return {
    version: PACKET_VERSION,
    type: 'SOS',
    hop,
    ttl,
    msgId,
    originMinutes: 1000,
    position: null,
    accuracyClass: 0,
    statusFlags: 1,
    people: 3,
    battery: 5,
    refMsgId: null,
    note: 'help',
  };
}

const msgIdArb = fc.integer({ min: 0, max: 0xffffffff });
const nowArb = fc.integer({ min: 0, max: 4_000_000_000_000 });
const rngArb = fc.double({ min: 0, max: 1, maxExcluded: true, noNaN: true });
const relayablePacket = fc
  .tuple(msgIdArb, fc.integer({ min: 0, max: 6 }))
  .chain(([id, hop]) => fc.integer({ min: hop + 1, max: 7 }).map((ttl) => makePacket(id, hop, ttl)));

describe('relay scheduler (unit)', () => {
  it('delay window is 2-8 s at the extremes', () => {
    expect(randomRelayDelayMs(() => 0)).toBe(RELAY_DELAY_MIN_MS);
    expect(randomRelayDelayMs(() => 0.999999999)).toBeLessThanOrEqual(RELAY_DELAY_MAX_MS);
  });

  it('schedules, then fires once at the due time with hop + 1', () => {
    const s = createRelayState();
    const r = onHeard(s, makePacket(1, 0, 3), 10_000, () => 0.5);
    expect(r).toEqual({ fresh: true, outcome: 'scheduled', dueMs: 15_000 });
    expect(nextDueMs(s)).toBe(15_000);
    expect(due(s, 14_999)).toEqual([]);
    const out = due(s, 15_000);
    expect(out).toHaveLength(1);
    expect(out[0]!.hop).toBe(1);
    expect(due(s, 99_000)).toEqual([]);
    expect(nextDueMs(s)).toBeNull();
  });

  it('suppression cancels the pending relay; a later repeat does not reschedule', () => {
    const s = createRelayState();
    onHeard(s, makePacket(2, 0, 3), 0, () => 0.5);
    expect(onHeard(s, makePacket(2, 1, 3), 1000, () => 0).outcome).toBe('suppressed');
    expect(due(s, 100_000)).toEqual([]);
    expect(onHeard(s, makePacket(2, 1, 3), 2000, () => 0).outcome).toBe('duplicate');
    expect(due(s, 100_000)).toEqual([]);
  });

  it('does nothing when relaying is disabled but still reports fresh', () => {
    const s = createRelayState(false);
    expect(onHeard(s, makePacket(3, 0, 3), 0, () => 0)).toEqual({ fresh: true, outcome: 'relay-disabled' });
    expect(due(s, 100_000)).toEqual([]);
  });
});

describe('relay scheduler (properties)', () => {
  it('delay is always within [2 s, 8 s]', () => {
    fc.assert(
      fc.property(rngArb, (r) => {
        const d = randomRelayDelayMs(() => r);
        expect(Number.isInteger(d)).toBe(true);
        expect(d).toBeGreaterThanOrEqual(RELAY_DELAY_MIN_MS);
        expect(d).toBeLessThanOrEqual(RELAY_DELAY_MAX_MS);
      }),
    );
  });

  it('scheduled dueMs is within the delay window after nowMs', () => {
    fc.assert(
      fc.property(relayablePacket, nowArb, rngArb, (p, now, r) => {
        const s = createRelayState();
        const res = onHeard(s, p, now, () => r);
        expect(res.outcome).toBe('scheduled');
        expect(res.dueMs! - now).toBeGreaterThanOrEqual(RELAY_DELAY_MIN_MS);
        expect(res.dueMs! - now).toBeLessThanOrEqual(RELAY_DELAY_MAX_MS);
      }),
    );
  });

  it('suppression: a repeat heard before the timer cancels the relay', () => {
    fc.assert(
      fc.property(relayablePacket, nowArb, rngArb, fc.double({ min: 0, max: 1, maxExcluded: true, noNaN: true }), (p, now, r, f) => {
        const s = createRelayState();
        const { dueMs } = onHeard(s, p, now, () => r);
        const repeatAt = now + Math.floor(f * (dueMs! - now));
        expect(onHeard(s, { ...p, hop: p.hop + 1 > 7 ? 7 : p.hop + 1 }, repeatAt, () => r).outcome).toBe('suppressed');
        expect(due(s, dueMs! + 1_000_000)).toEqual([]);
      }),
    );
  });

  it('TTL exhausted (hop >= ttl) is never relayed', () => {
    fc.assert(
      fc.property(
        msgIdArb,
        fc.integer({ min: 0, max: 7 }),
        fc.integer({ min: 0, max: 7 }),
        nowArb,
        rngArb,
        (id, a, b, now, r) => {
          const [ttl, hop] = a <= b ? [a, b] : [b, a]; // hop >= ttl
          const s = createRelayState();
          const res = onHeard(s, makePacket(id, hop, ttl), now, () => r);
          expect(res.outcome).toBe('ttl-exhausted');
          expect(res.fresh).toBe(true);
          expect(due(s, now + 1_000_000)).toEqual([]);
        },
      ),
    );
  });

  it('each id is relayed at most once, for any sequence of hearings and polls', () => {
    const event = fc.record({
      id: fc.integer({ min: 0, max: 5 }),
      hop: fc.integer({ min: 0, max: 6 }),
      dt: fc.integer({ min: 0, max: 5000 }),
      r: rngArb,
      poll: fc.boolean(),
    });
    fc.assert(
      fc.property(fc.array(event, { maxLength: 60 }), (events) => {
        const s = createRelayState();
        const relayed = new Map<number, number>();
        let now = 1_000_000;
        for (const e of events) {
          now += e.dt;
          onHeard(s, makePacket(e.id, e.hop, 7), now, () => e.r);
          if (e.poll) for (const p of due(s, now)) relayed.set(p.msgId, (relayed.get(p.msgId) ?? 0) + 1);
        }
        for (const p of due(s, now + 1_000_000)) relayed.set(p.msgId, (relayed.get(p.msgId) ?? 0) + 1);
        expect([...relayed.values()].every((n) => n <= 1)).toBe(true);
      }),
    );
  });

  it('relayed packet has hop + 1, same ttl and payload, and stays a valid packet', () => {
    fc.assert(
      fc.property(relayablePacket, nowArb, rngArb, (p, now, r) => {
        const s = createRelayState();
        const { dueMs } = onHeard(s, p, now, () => r);
        const out = due(s, dueMs!);
        expect(out).toHaveLength(1);
        expect(out[0]).toEqual({ ...p, hop: p.hop + 1 });
        expect(out[0]!.ttl).toBe(p.ttl);
        expect(validatePacket(out[0]!)).toBeNull();
      }),
    );
  });
});
