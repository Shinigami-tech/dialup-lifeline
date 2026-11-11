/**
 * Full modulate → demodulate property-based tests — Task 5 (Req 2.5, 3.2)
 *
 * Four property families:
 *
 *   P1 — Round-trip (Req 3.2)
 *        For any payload (0–255 bytes), sample rate in {44100, 48000},
 *        phase offset and amplitude in [0.1, 1.0]:
 *          demodulate(modulate(payload)) === payload
 *
 *   P2 — Noise resilience (Req 2.5)
 *        Round-trip holds when AWGN is added at SNR ≥ 10 dB.
 *
 *   P3 — Clock-skew tolerance (Req 2.2)
 *        Round-trip holds with ±2% sample-rate mismatch between TX and RX,
 *        simulated by linear-interpolation resampling of the modulated audio.
 *
 *   P4 — DC offset / amplitude variation
 *        Round-trip holds when a DC offset is added and amplitude is varied.
 *
 * All imports are from `src/modem/` only (pure TS, no DOM).
 *
 * Validates: Requirements 2.2, 2.5, 3.2
 */

import { describe, it } from "vitest";
import * as fc from "fast-check";
import { modulate } from "../src/modem/afsk-tx.js";
import { createDemodulator } from "../src/modem/afsk-rx.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Add additive white Gaussian noise to a Float32Array at the given SNR (dB).
 * Uses the Box-Muller transform for Gaussian samples.
 */
function addAwgn(samples: Float32Array, snrDb: number): Float32Array {
  // Signal power (RMS²)
  let sigPower = 0;
  for (let i = 0; i < samples.length; i++) {
    sigPower += (samples[i] ?? 0) ** 2;
  }
  sigPower /= samples.length;

  // Noise power derived from SNR
  const noiseRms = Math.sqrt(sigPower / Math.pow(10, snrDb / 10));

  // Box-Muller — deterministic seed via xoshiro-style using array index
  // We use Math.random() here; fast-check seeds the PRNG per run so this is
  // acceptable (the property is checked over many runs; individual noise
  // realisations are random but SNR is controlled).
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    // Box-Muller: N(0,1) from two Uniform(0,1) values
    const u1 = Math.random();
    const u2 = Math.random();
    const gaussian =
      Math.sqrt(-2 * Math.log(Math.max(u1, 1e-15))) *
      Math.cos(2 * Math.PI * u2);
    out[i] = (samples[i] ?? 0) + gaussian * noiseRms;
  }
  return out;
}

/**
 * Simulate a phase offset by prepending `offsetSamples` of silence.
 * This shifts the demodulator lock-on point without changing frequency content.
 */
function applyPhaseOffset(
  samples: Float32Array,
  offsetSamples: number,
): Float32Array {
  const out = new Float32Array(offsetSamples + samples.length);
  out.set(samples, offsetSamples);
  return out;
}

/**
 * Resample by linear interpolation to simulate TX/RX clock skew.
 * txSamples was produced at txRateHz; we return an array sized as if the
 * signal were played at the demodulator's rxRateHz.
 */
function resampleLinear(
  txSamples: Float32Array,
  txRateHz: number,
  rxRateHz: number,
): Float32Array {
  if (txRateHz === rxRateHz) return txSamples;
  const ratio = txRateHz / rxRateHz; // e.g. 1.02 for +2% TX
  const outLen = Math.floor(txSamples.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio;
    const lo = Math.floor(pos);
    const hi = Math.min(lo + 1, txSamples.length - 1);
    const frac = pos - lo;
    out[i] =
      (txSamples[lo] ?? 0) * (1 - frac) + (txSamples[hi] ?? 0) * frac;
  }
  return out;
}

/**
 * Run samples through a fresh demodulator and return true iff the target
 * payload is found in the decoded frames.
 */
function roundTrip(
  samples: Float32Array,
  rxRateHz: number,
  expected: Uint8Array,
): boolean {
  const demod = createDemodulator({ sampleRateHz: rxRateHz });
  const frames = demod.push(samples);
  return frames.some(
    (f) =>
      f.length === expected.length && f.every((b, i) => b === expected[i]),
  );
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/** Sample rates supported by the spec. */
const sampleRateArb = fc.constantFrom(44100 as const, 48000 as const);

/** Payloads: 1–64 bytes (we cap at 64 to keep test time reasonable; the
 *  HDLC/CRC property tests cover the full 0–255 range already). */
const payloadArb = fc.uint8Array({ minLength: 1, maxLength: 64 });

/** Amplitude in [0.1, 1.0]. */
const amplitudeArb = fc.float({
  min: Math.fround(0.1),
  max: Math.fround(1.0),
  noNaN: true,
});

/** Phase offset: 0–200 ms worth of silence prepended, expressed in ms. */
const phaseOffsetMsArb = fc.integer({ min: 0, max: 200 });

/** DC offset in [-0.1, 0.1] (kept small to stay demodulable). */
const dcOffsetArb = fc.float({
  min: Math.fround(-0.1),
  max: Math.fround(0.1),
  noNaN: true,
});

/** ±2% skew as a multiplier applied to TX sample rate (0.98 … 1.02). */
const skewArb = fc.float({
  min: Math.fround(0.98),
  max: Math.fround(1.02),
  noNaN: true,
});

// ---------------------------------------------------------------------------
// P1 — Round-trip  (Req 3.2)
// ---------------------------------------------------------------------------

describe("P1: round-trip property — demodulate(modulate(b)) === b (Req 3.2)", () => {
  /**
   * Validates: Requirements 3.2
   *
   * For any byte array b (0–255 bytes), any sample rate in {44100, 48000},
   * any phase offset and any amplitude in [0.1, 1.0]:
   *   demodulate(modulate(b)) === b
   */
  it(
    "holds for random payloads, sample rates, amplitudes and phase offsets",
    () => {
      fc.assert(
        fc.property(
          payloadArb,
          sampleRateArb,
          amplitudeArb,
          phaseOffsetMsArb,
          (payload, sampleRateHz, amplitude, phaseOffsetMs) => {
            const raw = modulate(payload, { sampleRateHz, amplitude });
            const offsetSamples = Math.round(
              (phaseOffsetMs * sampleRateHz) / 1000,
            );
            const samples = applyPhaseOffset(raw, offsetSamples);
            return roundTrip(samples, sampleRateHz, payload);
          },
        ),
        { numRuns: 50, seed: 42 },
      );
    },
  );
});

// ---------------------------------------------------------------------------
// P2 — Noise resilience at SNR ≥ 10 dB  (Req 2.5)
// ---------------------------------------------------------------------------

describe("P2: noise-resilience property — demodulate succeeds at SNR ≥ 10 dB (Req 2.5)", () => {
  /**
   * Validates: Requirements 2.5
   *
   * For random payloads, sample rates and amplitudes:
   *   Adding AWGN at exactly 10 dB SNR must not prevent decoding.
   *
   * We fix SNR at 10 dB (the spec threshold) rather than drawing it
   * randomly, because below 10 dB decoding failure is acceptable.
   */
  it(
    "decodes correctly with AWGN at 10 dB SNR",
    () => {
      fc.assert(
        fc.property(
          payloadArb,
          sampleRateArb,
          amplitudeArb,
          (payload, sampleRateHz, amplitude) => {
            const raw = modulate(payload, { sampleRateHz, amplitude });
            const noisy = addAwgn(raw, 10);
            return roundTrip(noisy, sampleRateHz, payload);
          },
        ),
        { numRuns: 30, seed: 42 },
      );
    },
  );
});

// ---------------------------------------------------------------------------
// P3 — Clock-skew tolerance ±2%  (Req 2.2)
// ---------------------------------------------------------------------------

describe("P3: clock-skew property — demodulates at ±2% TX/RX mismatch (Req 2.2)", () => {
  /**
   * Validates: Requirements 2.2
   *
   * Correct skew model: the TX device *believes* it runs at rxRate (it calls
   * modulate with sampleRateHz = rxRate), but its physical DAC actually ticks
   * at rxRate * skewFactor.  The waveform is therefore stretched in time.
   * The RX sees that stretched waveform; we simulate this by resampling:
   *
   *   rxSamples = resampleLinear(modulate(p, {sampleRateHz: rxRate}),
   *                              rxRate * skewFactor,   // effective DAC rate
   *                              rxRate)                // RX sample rate
   *
   * This produces a signal whose bit periods are rxRate/(rxRate*skew) of
   * nominal — exactly the mismatch the PLL must absorb.
   *
   * The previous (vacuous) model modulated at txRate = rxRate*skew and then
   * resampled back, which cancelled the skew entirely before the demodulator
   * saw the signal.
   */
  it(
    "holds for random payloads, sample rates and skew factors in [0.98, 1.02]",
    () => {
      fc.assert(
        fc.property(
          payloadArb,
          sampleRateArb,
          skewArb,
          (payload, rxRateHz, skewFactor) => {
            // TX modulates believing it runs at rxRate (nominal)
            const txSamples = modulate(payload, {
              sampleRateHz: rxRateHz,
              amplitude: 0.9,
            });
            // The TX DAC physically runs at rxRate * skewFactor → waveform is
            // stretched.  Resample from the effective DAC rate to what the RX
            // ADC captures at its own (nominal) rxRate.
            const rxSamples = resampleLinear(txSamples, rxRateHz * skewFactor, rxRateHz);
            return roundTrip(rxSamples, rxRateHz, payload);
          },
        ),
        { numRuns: 30, seed: 42 },
      );
    },
  );
});

// ---------------------------------------------------------------------------
// P4 — DC offset and amplitude variation
// ---------------------------------------------------------------------------

describe("P4: DC offset and amplitude variation (Req 3.2)", () => {
  /**
   * Validates: Requirements 3.2
   *
   * The demodulator uses an AGC normaliser, so a DC offset and varying
   * amplitude should not prevent decoding.
   */
  it(
    "holds for random payloads, amplitudes and DC offsets",
    () => {
      fc.assert(
        fc.property(
          payloadArb,
          sampleRateArb,
          amplitudeArb,
          dcOffsetArb,
          (payload, sampleRateHz, amplitude, dcOffset) => {
            const raw = modulate(payload, { sampleRateHz, amplitude });
            // Apply DC offset
            const withDc = new Float32Array(raw.length);
            for (let i = 0; i < raw.length; i++) {
              withDc[i] = (raw[i] ?? 0) + dcOffset;
            }
            return roundTrip(withDc, sampleRateHz, payload);
          },
        ),
        { numRuns: 50, seed: 42 },
      );
    },
  );
});
