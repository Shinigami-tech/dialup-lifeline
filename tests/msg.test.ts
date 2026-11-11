import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { encodeMsg, decodeMsg, urgency, distanceBearing, FLAGS, type Msg } from '../src/ui/sos';
import { modulate } from '../src/modem/afsk-tx';
import { createDemodulator } from '../src/modem/afsk-rx';

const msgArb = fc.record({
  kind: fc.constantFrom('SOS', 'OK', 'ACK', 'INFO') as fc.Arbitrary<Msg['kind']>,
  id: fc.string({ unit: fc.constantFrom(...'0123456789abcdef'), minLength: 6, maxLength: 6 }),
  ref: fc.option(fc.string({ unit: fc.constantFrom(...'0123456789abcdef'), minLength: 6, maxLength: 6 }), { nil: undefined }),
  flags: fc.subarray([...FLAGS]),
  people: fc.integer({ min: 0, max: 15 }),
  lat: fc.option(fc.integer({ min: -900000, max: 900000 }).map((v) => v / 1e4), { nil: undefined }),
  lon: fc.integer({ min: -1800000, max: 1800000 }).map((v) => v / 1e4),
  note: fc.option(fc.string({ maxLength: 40 }).filter((s) => !s.includes('|') && s.length > 0), { nil: undefined }),
  drill: fc.boolean(),
  hop: fc.integer({ min: 0, max: 7 }),
});

describe('message codec', () => {
  it('round-trips every valid message (property)', () => {
    fc.assert(fc.property(msgArb, (raw) => {
      const m = { ...raw, lon: raw.lat === undefined ? undefined : raw.lon, time: 0 } as Msg;
      const d = decodeMsg(encodeMsg(m))!;
      expect(d.kind).toBe(m.kind); expect(d.id).toBe(m.id); expect(d.ref).toBe(m.ref);
      expect(d.flags).toEqual(m.flags); expect(d.people).toBe(m.people); expect(d.drill).toBe(m.drill);
      expect(d.hop).toBe(m.hop); expect(d.note).toBe(m.note);
      if (m.lat !== undefined) { expect(d.lat).toBeCloseTo(m.lat, 4); expect(d.lon).toBeCloseTo(m.lon!, 4); }
      else expect(d.lat).toBeUndefined();
    }), { numRuns: 300 });
  });
  it('rejects garbage', () => {
    expect(decodeMsg(new Uint8Array([0xff, 0xfe, 0x00]))).toBeNull();
    expect(decodeMsg(new TextEncoder().encode('HELLO|x'))).toBeNull();
  });
});

describe('rescue triage', () => {
  const base = { kind: 'SOS' as const, id: 'a', flags: [], people: 1, hop: 0, time: Date.now() };
  it('trapped outranks injured outranks medicine', () => {
    expect(urgency({ ...base, flags: ['trapped'] })).toBeGreaterThan(urgency({ ...base, flags: ['injured'] }));
    expect(urgency({ ...base, flags: ['injured'] })).toBeGreaterThan(urgency({ ...base, flags: ['medicine'] }));
  });
  it('distance Astana Bayterek -> Khan Shatyr is about 1.8 km', () => {
    const { m } = distanceBearing(51.1283, 71.4305, 51.1328, 71.4036);
    expect(m).toBeGreaterThan(1700); expect(m).toBeLessThan(2100);
  });
});

it('end-to-end: real SOS goes through the modem with 1% clock skew and noise', () => {
  const m: Msg = { kind: 'SOS', id: 'ab12cd', flags: ['trapped', 'water'], people: 3, lat: 51.1694, lon: 71.4491, note: 'school gym, 2nd floor', hop: 0, time: 0 };
  const rate = 48000, tx = modulate(encodeMsg(m), { sampleRateHz: rate, amplitude: 0.6 });
  const skew = 1.01, n = Math.floor(tx.length / skew), rx = new Float32Array(n);
  let seed = 1; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < n; i++) { const t = i * skew, k = Math.floor(t), f = t - k; rx[i] = (tx[k] ?? 0) * (1 - f) + (tx[k + 1] ?? 0) * f + (rnd() - 0.5) * 0.25; }
  const d = createDemodulator({ sampleRateHz: rate });
  const frames: Uint8Array[] = [];
  for (let i = 0; i < n; i += 128) frames.push(...d.push(rx.subarray(i, i + 128)));
  const got = decodeMsg(frames[0]!)!;
  expect(got.note).toBe('school gym, 2nd floor'); expect(got.flags).toEqual(['trapped', 'water']);
});
