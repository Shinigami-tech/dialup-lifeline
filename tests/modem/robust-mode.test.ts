/**
 * Robust 300-baud mode tests (Req 1.5).
 *
 * Validates: Requirements 1.5
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { modulate } from "../../src/modem/afsk-tx.js";
import { createDemodulator } from "../../src/modem/afsk-rx.js";
import { MODE_PRESETS } from "../../src/modem/modes.js";

function addAwgn(samples: Float32Array, snrDb: number): Float32Array {
  let p = 0;
  for (const s of samples) p += s * s;
  p /= samples.length;
  const noiseRms = Math.sqrt(p / Math.pow(10, snrDb / 10));
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const u1 = Math.max(Math.random(), 1e-15);
    const u2 = Math.random();
    out[i] =
      (samples[i] ?? 0) +
      Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2) * noiseRms;
  }
  return out;
}

function resampleLinear(x: Float32Array, txRateHz: number, rxRateHz: number): Float32Array {
  const ratio = txRateHz / rxRateHz;
  const out = new Float32Array(Math.floor(x.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const pos = i * ratio;
    const lo = Math.floor(pos);
    const hi = Math.min(lo + 1, x.length - 1);
    const f = pos - lo;
    out[i] = (x[lo] ?? 0) * (1 - f) + (x[hi] ?? 0) * f;
  }
  return out;
}

function decodes(samples: Float32Array, sampleRateHz: number, expected: Uint8Array): boolean {
  const demod = createDemodulator({ sampleRateHz, mode: "robust" });
  return demod
    .push(samples)
    .some((f) => f.length === expected.length && f.every((b, i) => b === expected[i]));
}

const sampleRateArb = fc.constantFrom(44100, 48000);
const payloadArb = fc.uint8Array({ minLength: 1, maxLength: 32 });
const amplitudeArb = fc.float({ min: Math.fround(0.1), max: Math.fround(1), noNaN: true });

describe("robust mode preset", () => {
  it("is 300 baud and transmits 4x slower than standard", () => {
    expect(MODE_PRESETS.robust.baudRate).toBe(300);
    const p = new Uint8Array([1, 2, 3]);
    const std = modulate(p, { sampleRateHz: 48000, mode: "standard" });
    const rob = modulate(p, { sampleRateHz: 48000, mode: "robust" });
    expect(rob.length / std.length).toBeGreaterThan(3.5);
    expect(rob.length / std.length).toBeLessThan(4.5);
  });

  it("standard mode output is unchanged by the default", () => {
    const p = new Uint8Array([9, 8, 7]);
    expect(modulate(p, { sampleRateHz: 48000 })).toEqual(
      modulate(p, { sampleRateHz: 48000, mode: "standard" }),
    );
  });
});

describe("robust mode round trip", () => {
  it("holds for random payloads, sample rates, amplitudes and phase offsets", () => {
    fc.assert(
      fc.property(
        payloadArb,
        sampleRateArb,
        amplitudeArb,
        fc.integer({ min: 0, max: 200 }),
        (payload, sampleRateHz, amplitude, offsetMs) => {
          const raw = modulate(payload, { sampleRateHz, amplitude, mode: "robust" });
          const pad = Math.round((offsetMs * sampleRateHz) / 1000);
          const samples = new Float32Array(pad + raw.length);
          samples.set(raw, pad);
          return decodes(samples, sampleRateHz, payload);
        },
      ),
      { numRuns: 20, seed: 42 },
    );
  });

  it("decodes with AWGN at 10 dB SNR", () => {
    fc.assert(
      fc.property(payloadArb, sampleRateArb, amplitudeArb, (payload, sampleRateHz, amplitude) => {
        const raw = modulate(payload, { sampleRateHz, amplitude, mode: "robust" });
        return decodes(addAwgn(raw, 10), sampleRateHz, payload);
      }),
      { numRuns: 15, seed: 42 },
    );
  });

  it("decodes with ±2% clock skew", () => {
    fc.assert(
      fc.property(
        payloadArb,
        sampleRateArb,
        fc.float({ min: Math.fround(0.98), max: Math.fround(1.02), noNaN: true }),
        (payload, rxRateHz, skew) => {
          const tx = modulate(payload, { sampleRateHz: rxRateHz, amplitude: 0.9, mode: "robust" });
          return decodes(resampleLinear(tx, rxRateHz * skew, rxRateHz), rxRateHz, payload);
        },
      ),
      { numRuns: 15, seed: 42 },
    );
  });

  it("is at least as noise tolerant as standard mode at 6 dB SNR (same noise)", () => {
    // Over fixed trials, robust must decode no fewer frames than standard.
    const payload = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const fs = 48000;
    let std = 0;
    let rob = 0;
    for (let t = 0; t < 10; t++) {
      const s = addAwgn(modulate(payload, { sampleRateHz: fs, mode: "standard" }), 6);
      const r = addAwgn(modulate(payload, { sampleRateHz: fs, mode: "robust" }), 6);
      if (createDemodulator({ sampleRateHz: fs, mode: "standard" }).push(s).length > 0) std++;
      if (createDemodulator({ sampleRateHz: fs, mode: "robust" }).push(r).length > 0) rob++;
    }
    expect(rob).toBeGreaterThanOrEqual(std);
  });
});
