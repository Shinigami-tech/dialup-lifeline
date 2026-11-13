import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { PACKET_VERSION, decodePacket, encodePacket, validatePacket, type Packet } from '../../src/packet';
import {
  RESEND_MAX_ATTEMPTS, ackForHeard, createAck, createAckResponderState, createSenderState, dueResends,
  isDelivered, onAckHeard, onEchoHeard, resendDelayMs, trackSent,
} from '../../src/mesh/ack';
import { createRelayState, due, onHeard } from '../../src/mesh/relay';

const idArb = fc.integer({ min: 0, max: 0xffffffff });
const nowArb = fc.integer({ min: 1_800_000_000_000, max: 4_000_000_000_000 });
const hopArb = fc.integer({ min: 0, max: 7 });

function sos(msgId: number, hop = 0, statusFlags = 1): Packet {
  return {
    version: PACKET_VERSION, type: 'SOS', hop, ttl: 7, msgId, originMinutes: 5, position: null,
    accuracyClass: 0, statusFlags, people: 2, battery: 5, refMsgId: null, note: 'x',
  };
}
const ackPacket = (ref: number, hop = 0, id = 1): Packet => ({ ...createAck(sos(ref), id, 1_800_000_000_000), hop });

describe('ACK creation', () => {
  it('references the SOS id, is valid, and keeps the drill bit only', () => {
    const a = createAck(sos(0xdeadbeef, 3, 0x81), 42, 1_800_000_000_000);
    expect(a.type).toBe('ACK');
    expect(a.refMsgId).toBe(0xdeadbeef);
    expect(a.statusFlags).toBe(0x80);
    expect(validatePacket(a)).toBeNull();
  });

  it('rescuer acks only SOS, only in rescue mode, and only once per id', () => {
    const st = createAckResponderState();
    const p = sos(7);
    expect(ackForHeard(st, p, false, 0, () => 1)).toBeNull();
    expect(ackForHeard(st, { ...p, type: 'OK' }, true, 0, () => 1)).toBeNull();
    expect(ackForHeard(st, p, true, 0, () => 1)?.refMsgId).toBe(7);
    expect(ackForHeard(st, p, true, 0, () => 2)).toBeNull();
  });

  it('ACK for unknown id is ignored; echo of own SOS is not delivery', () => {
    const s = createSenderState();
    trackSent(s, 10, 0);
    expect(onAckHeard(s, ackPacket(11), 5)).toBe('unknown');
    expect(onEchoHeard(s, sos(10, 2))).toBe(true);
    expect(s.messages.get(10)?.state).toBe('relayed-unconfirmed');
    expect(isDelivered(s, 10)).toBe(false);
  });

  it('resend schedule backs off, caps, stops after max attempts, and stops once acknowledged', () => {
    expect(resendDelayMs(1)).toBe(60_000);
    expect(resendDelayMs(2)).toBe(120_000);
    expect(resendDelayMs(50)).toBe(300_000);
    const s = createSenderState();
    trackSent(s, 1, 0);
    let now = 0, resends = 0;
    for (let i = 0; i < 100; i++) { now += 300_000; resends += dueResends(s, now).length; }
    expect(resends).toBe(RESEND_MAX_ATTEMPTS - 1);
    const s2 = createSenderState();
    trackSent(s2, 2, 0);
    onAckHeard(s2, ackPacket(2), 10);
    expect(dueResends(s2, 10_000_000)).toEqual([]);
  });

  it('an ACK is relayed by the normal relay scheduler', () => {
    const r = createRelayState();
    const a = ackPacket(99, 0, 1234);
    expect(onHeard(r, a, 0, () => 0).outcome).toBe('scheduled');
    const out = due(r, 10_000);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ type: 'ACK', refMsgId: 99, hop: 1 });
  });
});

describe('ACK properties', () => {
  it('ACK packet round-trips through encode/decode', () => {
    // **Validates: Requirements 3.1**
    fc.assert(fc.property(idArb, idArb, nowArb, fc.integer({ min: 0, max: 255 }), (ref, id, now, flags) => {
      const a = createAck(sos(ref, 0, flags), id, now);
      expect(decodePacket(encodePacket(a))).toEqual(a);
    }));
  });

  it('acknowledged only when a valid ACK with a matching ref is heard', () => {
    // **Validates: Requirements 3.2, 3.3**
    fc.assert(fc.property(idArb, idArb, hopArb, nowArb, (mine, ref, hop, now) => {
      const s = createSenderState();
      trackSent(s, mine, now);
      const outcome = onAckHeard(s, ackPacket(ref, hop), now + 1);
      const m = s.messages.get(mine)!;
      if (ref === mine) {
        expect(outcome).toBe('acknowledged');
        expect(m).toMatchObject({ state: 'acknowledged', ackedAtMs: now + 1, ackHop: hop });
      } else {
        expect(outcome).toBe('unknown');
        expect(m.state).not.toBe('acknowledged');
        expect(m.ackedAtMs).toBeNull();
      }
    }));
  });

  it('never acknowledged without an ACK, whatever other packets are heard', () => {
    // **Validates: Requirements 3.3**
    const nonAck = fc.record({ type: fc.constantFrom('SOS', 'OK', 'INFO' as const), id: idArb, hop: hopArb });
    fc.assert(fc.property(idArb, fc.array(nonAck, { maxLength: 30 }), fc.array(nowArb, { maxLength: 5 }), (mine, heard, times) => {
      const s = createSenderState();
      trackSent(s, mine, 0);
      for (const h of heard) {
        const base = sos(h.id, h.hop);
        const p: Packet = h.type === 'INFO' ? { ...base, type: 'INFO', refMsgId: mine } : { ...base, type: h.type as Packet['type'] };
        // Even an echo of our own id or an INFO referencing us must never mean delivered.
        expect(onAckHeard(s, p, 1)).toBe('not-an-ack');
        onEchoHeard(s, { ...p, msgId: heard.length % 2 ? mine : p.msgId });
      }
      for (const t of times) dueResends(s, t);
      expect(isDelivered(s, mine)).toBe(false);
    }));
  });

  it('is idempotent: duplicate ACKs change nothing after the first', () => {
    // **Validates: Requirements 3.2**
    fc.assert(fc.property(idArb, fc.array(fc.tuple(hopArb, nowArb), { minLength: 1, maxLength: 10 }), (mine, acks) => {
      const s = createSenderState();
      trackSent(s, mine, 0);
      const [firstHop, firstTime] = acks[0]!;
      expect(onAckHeard(s, ackPacket(mine, firstHop), firstTime)).toBe('acknowledged');
      const snapshot = { ...s.messages.get(mine)! };
      for (const [hop, t] of acks.slice(1)) expect(onAckHeard(s, ackPacket(mine, hop), t)).toBe('duplicate');
      expect(s.messages.get(mine)).toEqual(snapshot);
      expect(onEchoHeard(s, sos(mine, 3))).toBe(false);
      expect(s.messages.get(mine)!.state).toBe('acknowledged');
    }));
  });
});
