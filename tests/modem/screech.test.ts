/**
 * Classic screech synth tests (Req 1.4).
 *
 * Validates: Requirements 1.4
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { modulate } from "../../src/modem/afsk-tx.js";
import { createDemodulator } from "../../src/modem/afsk-rx.js";
import { synthesizeScreech, modulateWithScreech } from "../../src/modem/screech.js";

const sampleRateArb = fc.constantFrom(44100, 48000);
const durationArb = fc.integer({ min: 0, max: 2000 });
const amplitudeArb = fc.float({ min: Math.fround(0.1), max: Math.fround(1), noNaN: true });
const payloadArb = fc.uint8Array({ minLength: 1, maxLength: 24 });

function same(a: Float32Array, b: Float32Array): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

describe("synthesizeScreech", () => {
  it("defaults to 1.5 s", () => {
    expect(synthesizeScreech({ sampleRateHz: 48000 }).length).toBe(72000);
  });

  it("is deterministic, correct length, bounded, finite", () => {
    fc.assert(
      fc.property(sampleRateArb, durationArb, amplitudeArb, (sampleRateHz, durationMs, amplitude) => {
        const a = synthesizeScreech({ sampleRateHz, durationMs, amplitude });
        const b = synthesizeScreech({ sampleRateHz, durationMs, amplitude });
        expect(same(a, b)).toBe(true);
        expect(a.length).toBe(Math.round((durationMs * sampleRateHz) / 1000));
        let ok = true;
        for (const s of a) {
          if (!Number.isFinite(s) || Math.abs(s) > amplitude + 1e-6) ok = false;
        }
        expect(ok).toBe(true);
      }),
      { numRuns: 40 },
    );
  });

  it("is audible (non-silent) for the default duration", () => {
    const x = synthesizeScreech({ sampleRateHz: 44100 });
    expect(x.some((s) => Math.abs(s) > 0.1)).toBe(true);
  });
});

describe("modulateWithScreech", () => {
  it("skipping yields output identical to plain modulate", () => {
    fc.assert(
      fc.property(payloadArb, sampleRateArb, fc.constantFrom("standard", "robust" as const), (p, sampleRateHz, mode) => {
        const plain = modulate(p, { sampleRateHz, mode: mode as "standard" | "robust" });
        const omitted = modulateWithScreech(p, { sampleRateHz, mode: mode as "standard" | "robust" });
        const off = modulateWithScreech(p, { sampleRateHz, mode: mode as "standard" | "robust", screech: false });
        expect(same(plain, omitted)).toBe(true);
        expect(same(plain, off)).toBe(true);
      }),
      { numRuns: 20 },
    );
  });

  it("prefixes the screech and leaves the packet samples untouched", () => {
    const p = new Uint8Array([1, 2, 3]);
    const plain = modulate(p, { sampleRateHz: 48000 });
    const out = modulateWithScreech(p, { sampleRateHz: 48000, screech: true });
    expect(out.length).toBe(plain.length + 72000);
    expect(same(out.subarray(72000), plain)).toBe(true);
  });

  for (const mode of ["standard", "robust"] as const) {
    it(`frame still decodes after screech prefix (${mode})`, () => {
      fc.assert(
        fc.property(payloadArb, sampleRateArb, amplitudeArb, (p, sampleRateHz, amplitude) => {
          const samples = modulateWithScreech(p, { sampleRateHz, mode, amplitude, screech: true });
          const demod = createDemodulator({ sampleRateHz, mode });
          const frames = demod.push(samples);
          expect(frames.length).toBe(1);
          expect(Array.from(frames[0]!)).toEqual(Array.from(p));
        }),
        { numRuns: 8 },
      );
    });
  }
});
