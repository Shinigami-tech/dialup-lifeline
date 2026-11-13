import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createMemorySeenBackend } from '../../src/mesh/dedup';
import { createChannel, noteActivity, txEnd, txStart } from '../../src/mesh/channel';
import {
  awaitClear, createMsgRelay, heardMsg, hydrateMsgRelay, markOwn, relayLogLine, setRelayEnabled, takeDueMsgs,
} from '../../src/mesh/msg-relay';
import { decodeMsg, encodeMsg, type Msg } from '../../src/ui/sos';

const hex8 = fc.integer({ min: 0, max: 0xffffffff }).map((n) => n.toString(16).padStart(8, '0'));
const kind = fc.constantFrom('SOS', 'OK', 'ACK', 'INFO' as const) as fc.Arbitrary<Msg['kind']>;
const msgArb = fc.record({
  kind, id: hex8, ref: hex8, hop: fc.integer({ min: 0, max: 7 }), people: fc.integer({ min: 0, max: 15 }),
}).map(({ kind, id, ref, hop, people }): Msg => ({
  kind, id, ref: kind === 'ACK' || kind === 'INFO' ? ref : undefined, flags: [], people, hop, time: 1_000,
}));
const rng = () => 0.5;

describe('msg relay glue', () => {
  it('relays every kind exactly once with hop + 1 and the same wire id', () => {
    fc.assert(fc.property(msgArb, (m) => {
      const r = createMsgRelay();
      const res = heardMsg(r, m, 0, rng);
      if (m.hop >= 7) {
        expect(res.outcome).toBe('ttl-exhausted');
        expect(takeDueMsgs(r, 10_000)).toEqual([]);
        return;
      }
      expect(res.outcome).toBe('scheduled');
      expect(takeDueMsgs(r, 1_999)).toEqual([]); // random delay is at least 2 s
      const out = takeDueMsgs(r, 8_000);
      expect(out).toHaveLength(1);
      expect(out[0]!.id).toBe(m.id);
      expect(out[0]!.kind).toBe(m.kind);
      expect(out[0]!.ref).toBe(m.ref);
      expect(out[0]!.hop).toBe(m.hop + 1);
      expect(decodeMsg(encodeMsg(out[0]!))?.hop).toBe(m.hop + 1); // still a valid wire message
      expect(takeDueMsgs(r, 20_000)).toEqual([]);
    }));
  });

  it('cancels the pending relay when the same id is heard again, and never relays duplicates', () => {
    fc.assert(fc.property(msgArb.filter((m) => m.hop < 7), (m) => {
      const r = createMsgRelay();
      heardMsg(r, m, 0, rng);
      expect(heardMsg(r, { ...m, hop: m.hop + 1 }, 500, rng).outcome).toBe('suppressed');
      expect(takeDueMsgs(r, 20_000)).toEqual([]);
      expect(heardMsg(r, m, 21_000, rng).outcome).toBe('duplicate');
    }));
  });

  it('does not relay our own messages when they echo back', () => {
    const r = createMsgRelay();
    markOwn(r, 'deadbeef', 0);
    const m: Msg = { kind: 'SOS', id: 'deadbeef', flags: [], people: 1, hop: 1, time: 0 };
    expect(heardMsg(r, m, 100, rng).fresh).toBe(false);
    expect(takeDueMsgs(r, 20_000)).toEqual([]);
  });

  it('relay disabled: still fresh for the app, nothing scheduled; toggling off drops pending', () => {
    const r = createMsgRelay(false);
    const m: Msg = { kind: 'SOS', id: '00000001', flags: [], people: 1, hop: 0, time: 0 };
    expect(heardMsg(r, m, 0, rng)).toEqual({ fresh: true, outcome: 'relay-disabled' });
    const r2 = createMsgRelay(true);
    heardMsg(r2, { ...m, id: '00000002' }, 0, rng);
    setRelayEnabled(r2, false);
    expect(takeDueMsgs(r2, 20_000)).toEqual([]);
  });

  it('persists seen ids and restores them after a restart', async () => {
    const backend = createMemorySeenBackend();
    const a = createMsgRelay(true, backend);
    const m: Msg = { kind: 'OK', id: '0000abcd', flags: [], people: 1, hop: 0, time: 0 };
    heardMsg(a, m, 1_000, rng);
    await Promise.resolve();
    expect(backend.entries.has(0xabcd)).toBe(true);
    const b = createMsgRelay(true, backend);
    await hydrateMsgRelay(b, 2_000);
    expect(heardMsg(b, m, 3_000, rng).outcome).toBe('duplicate');
  });

  it('formats the terminal log line', () => {
    expect(relayLogLine({ kind: 'SOS', id: 'a1b2c3d4', flags: [], people: 1, hop: 3, time: 0 })).toBe('RELAY #a1b2c3d4 · HOP 3');
  });
});

describe('awaitClear (listen-before-talk)', () => {
  function harness() {
    let now = 10_000;
    const channel = createChannel();
    return {
      channel,
      opts: { channel, nowMs: () => now, sleepMs: async (ms: number) => { now += ms; }, rng },
      now: () => now,
    };
  }

  it('goes immediately on a quiet channel', async () => {
    const h = harness();
    expect(await awaitClear(h.opts)).toBe(true);
  });

  it('waits out recent activity and never starts before the quiet period elapsed', async () => {
    const h = harness();
    noteActivity(h.channel, h.now());
    const start = h.now();
    expect(await awaitClear(h.opts)).toBe(true);
    expect(h.now() - start).toBeGreaterThanOrEqual(600);
  });

  it('waits for the post-TX guard', async () => {
    const h = harness();
    txStart(h.channel);
    txEnd(h.channel, h.now());
    const start = h.now();
    expect(await awaitClear({ ...h.opts, maxAttempts: 20 })).toBe(true);
    expect(h.now() - start).toBeGreaterThanOrEqual(300);
  });

  it('gives up after maxAttempts while the channel stays busy', async () => {
    let now = 10_000;
    const channel = createChannel();
    noteActivity(channel, now);
    const busy = {
      channel, rng, maxAttempts: 3, nowMs: () => now,
      sleepMs: async (ms: number) => { now += ms; noteActivity(channel, now); }, // someone is always talking
    };
    expect(await awaitClear(busy)).toBe(false);
  });
});
