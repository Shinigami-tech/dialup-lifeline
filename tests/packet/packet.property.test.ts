import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  BATTERY_UNKNOWN, FIXED_HEADER_BYTES, MAX_NOTE_BYTES, PACKET_TYPES, PACKET_VERSION,
  decodePacket, encodePacket, type Packet,
} from '../../src/packet';

const noteArb = fc.string({ unit: 'grapheme', maxLength: 40 }).filter((s) => new TextEncoder().encode(s).length <= MAX_NOTE_BYTES);

export const packetArb: fc.Arbitrary<Packet> = fc
  .record({
    type: fc.constantFrom(...PACKET_TYPES),
    hop: fc.integer({ min: 0, max: 7 }),
    ttl: fc.integer({ min: 0, max: 7 }),
    msgId: fc.integer({ min: 0, max: 2 ** 32 - 1 }),
    originMinutes: fc.integer({ min: 0, max: 2 ** 24 - 1 }),
    position: fc.option(
      fc.record({ latE4: fc.integer({ min: -900000, max: 900000 }), lonE4: fc.integer({ min: -1800000, max: 1800000 }) }),
      { nil: null },
    ),
    fixClass: fc.integer({ min: 1, max: 7 }),
    statusFlags: fc.integer({ min: 0, max: 255 }),
    people: fc.integer({ min: 0, max: 15 }),
    battery: fc.oneof(fc.integer({ min: 0, max: 10 }), fc.constant(BATTERY_UNKNOWN)),
    ref: fc.integer({ min: 0, max: 2 ** 32 - 1 }),
    note: noteArb,
  })
  .map(({ fixClass, ref, ...r }) => ({
    ...r,
    version: PACKET_VERSION,
    accuracyClass: r.position ? fixClass : 0,
    refMsgId: r.type === 'ACK' || r.type === 'INFO' ? ref : null,
  }));

describe('packet codec', () => {
  it('decode(encode(p)) == p for every valid packet (property)', () => {
    // **Validates: Requirements 1.3**
    fc.assert(fc.property(packetArb, (p) => {
      expect(decodePacket(encodePacket(p))).toEqual(p);
    }), { numRuns: 1000 });
  });

  it('SOS without note is at most 20 bytes (17 in practice)', () => {
    // **Validates: Requirements 1.2**
    fc.assert(fc.property(packetArb, (p) => {
      const bytes = encodePacket({ ...p, type: 'SOS', refMsgId: null, note: '' });
      expect(bytes.length).toBe(FIXED_HEADER_BYTES);
      expect(bytes.length).toBeLessThanOrEqual(20);
    }), { numRuns: 200 });
  });

  it('rejects every truncation of a valid packet without throwing (property)', () => {
    // **Validates: Requirements 1.1**
    fc.assert(fc.property(packetArb, fc.nat(), (p, cut) => {
      const bytes = encodePacket(p);
      expect(decodePacket(bytes.subarray(0, cut % bytes.length))).toBeNull();
    }), { numRuns: 500 });
  });

  it('rejects trailing bytes (property)', () => {
    fc.assert(fc.property(packetArb, fc.uint8Array({ minLength: 1, maxLength: 8 }), (p, extra) => {
      const bytes = encodePacket(p);
      const longer = new Uint8Array(bytes.length + extra.length);
      longer.set(bytes); longer.set(extra, bytes.length);
      expect(decodePacket(longer)).toBeNull();
    }), { numRuns: 200 });
  });

  it('never throws on arbitrary bytes, and anything it accepts re-encodes identically (property)', () => {
    fc.assert(fc.property(fc.uint8Array({ maxLength: 80 }), (data) => {
      const p = decodePacket(data);
      if (p) expect(encodePacket(p)).toEqual(data);
    }), { numRuns: 2000 });
  });

  it('never throws on single-bit corruption of a valid packet (property)', () => {
    fc.assert(fc.property(packetArb, fc.nat(), (p, bit) => {
      const bytes = encodePacket(p).slice();
      const i = bit % (bytes.length * 8);
      bytes[i >> 3] = (bytes[i >> 3] ?? 0) ^ (0x80 >> (i & 7));
      const d = decodePacket(bytes);
      if (d) expect(encodePacket(d)).toEqual(bytes);
    }), { numRuns: 500 });
  });
});

describe('packet codec: specific rejections', () => {
  const base: Packet = {
    version: PACKET_VERSION, type: 'SOS', hop: 0, ttl: 7, msgId: 0xdeadbeef, originMinutes: 1234,
    position: { latE4: 511694, lonE4: 714491 }, accuracyClass: 1, statusFlags: 0b11, people: 3,
    battery: BATTERY_UNKNOWN, refMsgId: null, note: 'gym',
  };
  it('encodes a known packet to the documented size', () => {
    expect(encodePacket(base).length).toBe(FIXED_HEADER_BYTES + 3);
  });
  it('rejects unknown version and type', () => {
    const b = encodePacket(base).slice();
    b[0] = (b[0] ?? 0) ^ 0b11100000; // version 1 -> 6
    expect(decodePacket(b)).toBeNull();
    const t = encodePacket(base).slice();
    t[0] = ((t[0] ?? 0) & 0b11100011) | (7 << 2); // type 7
    expect(decodePacket(t)).toBeNull();
  });
  it('rejects invalid UTF-8 in the note', () => {
    const b = encodePacket({ ...base, note: 'aa' }).slice();
    b[b.length - 1] = 0xff;
    expect(decodePacket(b)).toBeNull();
  });
  it('encode throws on out-of-range fields', () => {
    expect(() => encodePacket({ ...base, people: 16 })).toThrow(RangeError);
    expect(() => encodePacket({ ...base, note: 'x'.repeat(41) })).toThrow(RangeError);
    expect(() => encodePacket({ ...base, type: 'ACK' })).toThrow(RangeError);
  });
  it('rejects empty input', () => {
    expect(decodePacket(new Uint8Array())).toBeNull();
  });
});
