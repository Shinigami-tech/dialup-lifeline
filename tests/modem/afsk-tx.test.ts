/**
 * Tests for the continuous-phase AFSK modulator — Task 3 (Req 1.1, 1.3, 3.1, 3.2)
 *
 * Unit tests:  output length, amplitude envelope, continuous phase
 * Property:    length invariant, amplitude bounds
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { modulate, type AfskTxOptions } from "../../src/modem/afsk-tx.js";
import { frame } from "../../src/modem/hdlc.js";
import { nrziEncode } from "../../src/modem/nrzi.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function expectedSampleCount(
  payload: Uint8Array,
  sampleRateHz: number,
  baudRate = 1200,
): number {
  const frameBits = frame(payload);
  const nrziLevels = nrziEncode(frameBits);
  return Math.round(nrziLevels.length * (sampleRateHz / baudRate));
}

// ---------------------------------------------------------------------------
// Unit: output length
// ---------------------------------------------------------------------------

describe("modulate() — output length", () => {
  it("produces the correct number of samples at 44100 Hz", () => {
    const payload = new Uint8Array([0x01, 0x02, 0x03]);
    const opts: AfskTxOptions = { sampleRateHz: 44100 };
    const samples = modulate(payload, opts);
    const expected = expectedSampleCount(payload, 44100);
    expect(samples.length).toBe(expected);
  });

  it("produces the correct number of samples at 48000 Hz", () => {
    const payload = new Uint8Array([0xaa, 0xbb]);
    const opts: AfskTxOptions = { sampleRateHz: 48000 };
    const samples = modulate(payload, opts);
    const expected = expectedSampleCount(payload, 48000);
    expect(samples.length).toBe(expected);
  });

  it("empty payload still produces samples (HDLC preamble + flags)", () => {
    const opts: AfskTxOptions = { sampleRateHz: 44100 };
    const samples = modulate(new Uint8Array(0), opts);
    expect(samples.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Unit: amplitude envelope (ramp-in / ramp-out + peak bounds)
// ---------------------------------------------------------------------------

describe("modulate() — amplitude envelope", () => {
  it("first sample is near 0 (ramp-in)", () => {
    const opts: AfskTxOptions = { sampleRateHz: 44100, amplitude: 1.0 };
    const samples = modulate(new Uint8Array([0x55]), opts);
    // The very first sample has gain 0/rampSamples = 0, so sin(phase)*amp*0 = 0
    expect(Math.abs(samples[0]!)).toBe(0);
  });

  it("last sample is near 0 (ramp-out)", () => {
    const opts: AfskTxOptions = { sampleRateHz: 44100, amplitude: 1.0 };
    const samples = modulate(new Uint8Array([0x55]), opts);
    expect(Math.abs(samples[samples.length - 1]!)).toBe(0);
  });

  it("peak amplitude does not exceed opts.amplitude", () => {
    const amplitude = 0.75;
    const opts: AfskTxOptions = { sampleRateHz: 44100, amplitude };
    const samples = modulate(new Uint8Array([0xde, 0xad, 0xbe, 0xef]), opts);
    const max = samples.reduce((m, s) => Math.max(m, Math.abs(s)), 0);
    expect(max).toBeLessThanOrEqual(amplitude + 1e-9);
  });

  it("amplitude defaults to 1.0 when not specified", () => {
    const opts: AfskTxOptions = { sampleRateHz: 44100 };
    const samples = modulate(new Uint8Array([0xff]), opts);
    const max = samples.reduce((m, s) => Math.max(m, Math.abs(s)), 0);
    expect(max).toBeLessThanOrEqual(1.0 + 1e-9);
  });
});

// ---------------------------------------------------------------------------
// Unit: continuous phase (no large jumps between adjacent samples)
// ---------------------------------------------------------------------------

describe("modulate() — continuous phase", () => {
  it("adjacent sample differences are bounded by 2·amp·sin(π·maxFreq/fs)", () => {
    const sampleRateHz = 44100;
    const amplitude = 1.0;
    const spaceHz = 2200; // highest frequency → largest step
    const opts: AfskTxOptions = { sampleRateHz, amplitude, spaceHz };

    const samples = modulate(new Uint8Array([0x00, 0xff, 0xaa]), opts);

    // Maximum possible step between consecutive sine samples at maxFreq:
    //   |sin(φ + Δ) - sin(φ)| ≤ 2·|sin(Δ/2)| ≈ 2·sin(π·f/fs) for small Δ
    // We use a small epsilon to handle floating-point.
    const maxStep =
      2 * amplitude * Math.sin(Math.PI * spaceHz / sampleRateHz) + 1e-9;

    // Skip the ramp regions where amplitude is intentionally scaling down.
    const rampSamples = Math.round(5 * sampleRateHz / 1000);
    for (let i = rampSamples + 1; i < samples.length - rampSamples; i++) {
      const diff = Math.abs(samples[i]! - samples[i - 1]!);
      if (diff > maxStep) {
        throw new Error(
          `Phase discontinuity at sample ${i}: |diff| = ${diff.toFixed(6)} > maxStep ${maxStep.toFixed(6)}`,
        );
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Property: length invariant  — Validates: Requirements 1.1, 3.2
// ---------------------------------------------------------------------------

describe("modulate() — property: length invariant", () => {
  it("output length matches expected bit count × samplesPerBit for any payload", () => {
    fc.assert(
      fc.property(
        fc.uint8Array({ minLength: 0, maxLength: 255 }),
        fc.constantFrom(44100, 48000),
        (payload, sampleRateHz) => {
          const opts: AfskTxOptions = { sampleRateHz };
          const samples = modulate(payload, opts);
          const expected = expectedSampleCount(payload, sampleRateHz);
          expect(samples.length).toBeGreaterThan(0);
          expect(samples.length).toBe(expected);
        },
      ),
      { numRuns: 200 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property: amplitude bounds  — Validates: Requirements 1.1, 1.3
// ---------------------------------------------------------------------------

describe("modulate() — property: amplitude bounds", () => {
  it("all samples are within [-amplitude, +amplitude] for any payload and amplitude", () => {
    fc.assert(
      fc.property(
        fc.uint8Array({ minLength: 0, maxLength: 255 }),
        fc.constantFrom(44100, 48000),
        fc.float({ min: Math.fround(0.1), max: Math.fround(1.0), noNaN: true }),
        (payload, sampleRateHz, amplitude) => {
          const opts: AfskTxOptions = { sampleRateHz, amplitude };
          const samples = modulate(payload, opts);
          for (let i = 0; i < samples.length; i++) {
            const s = samples[i]!;
            if (Math.abs(s) > amplitude + 1e-9) {
              throw new Error(
                `Sample ${i} out of range: ${s} (amplitude = ${amplitude})`,
              );
            }
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
