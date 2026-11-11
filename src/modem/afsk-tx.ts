/**
 * Continuous-phase AFSK modulator for Bell 202 / AX.25.
 *
 * Pipeline: payload → HDLC frame → NRZI encode → AFSK synthesis → Float32 PCM
 *
 * Key properties:
 *   - Phase accumulator never resets between bits (continuous-phase FSK).
 *   - 5 ms linear amplitude ramp-in and ramp-out to avoid clicks.
 *   - Mark = 1200 Hz (NRZI 1-level), Space = 2200 Hz (NRZI 0-level).
 *   - Pure TypeScript, no DOM / browser dependencies.
 *
 * Req 1.1, 1.3, 3.1
 */

import { frame } from "./hdlc.js";
import { nrziEncode } from "./nrzi.js";

export interface AfskTxOptions {
  /** Audio output sample rate, e.g. 44100 or 48000. */
  sampleRateHz: number;
  /** Baud rate. Default 1200. */
  baudRate?: number;
  /** Mark frequency in Hz. Default 1200. */
  markHz?: number;
  /** Space frequency in Hz. Default 2200. */
  spaceHz?: number;
  /**
   * Peak amplitude in the range [0.1, 1.0].
   * Output samples span [-amplitude, +amplitude]. Default 1.0.
   */
  amplitude?: number;
  /** Duration of the linear amplitude ramp in/out, in ms. Default 5. */
  rampDurationMs?: number;
}

/**
 * Modulate a raw payload into AFSK Float32 PCM samples.
 *
 * The pipeline is:
 *   payload → HDLC frame (CRC appended, bit-stuffed, flags added)
 *           → NRZI encode
 *           → AFSK phase-accumulator synthesis
 *           → 5 ms linear amplitude ramp-in / ramp-out
 *
 * @param payload - Raw bytes to transmit (0–255 bytes).
 * @param opts    - Modulation parameters (sample rate is mandatory).
 * @returns Float32Array of PCM samples in the range [-amplitude, +amplitude].
 */
export function modulate(payload: Uint8Array, opts: AfskTxOptions): Float32Array {
  const {
    sampleRateHz,
    baudRate = 1200,
    markHz = 1200,
    spaceHz = 2200,
    amplitude = 1.0,
    rampDurationMs = 5,
  } = opts;

  // ── 1. HDLC frame → NRZI bit stream ────────────────────────────────────────
  const frameBits = frame(payload);
  const nrziLevels = nrziEncode(frameBits);

  // ── 2. Allocate output buffer ───────────────────────────────────────────────
  // samplesPerBit must be a float; we use a phase accumulator so non-integer
  // values are handled correctly without rounding artefacts.
  const samplesPerBit = sampleRateHz / baudRate;
  const totalSamples = Math.round(nrziLevels.length * samplesPerBit);
  const out = new Float32Array(totalSamples);

  // ── 3. Phase-accumulator synthesis ─────────────────────────────────────────
  // Phase is in radians and carries over between bits (continuous-phase FSK).
  let phase = 0;
  let sampleIndex = 0;

  for (let bitIdx = 0; bitIdx < nrziLevels.length; bitIdx++) {
    const level = nrziLevels[bitIdx] as number;
    const freqHz = level === 1 ? markHz : spaceHz;
    const phaseInc = (2 * Math.PI * freqHz) / sampleRateHz;

    // Calculate sample boundaries for this bit using floats to avoid drift.
    const sampleStart = Math.round(bitIdx * samplesPerBit);
    const sampleEnd = Math.round((bitIdx + 1) * samplesPerBit);

    for (let s = sampleStart; s < sampleEnd && s < totalSamples; s++) {
      out[s] = Math.sin(phase) * amplitude;
      phase += phaseInc;
      // Keep phase in [-π, π] to avoid floating-point precision loss over time.
      if (phase > Math.PI) phase -= 2 * Math.PI;
    }

    sampleIndex = sampleEnd;
  }

  // Handle any rounding remainder (should be 0 or 1 sample).
  void sampleIndex;

  // ── 4. Apply 5 ms linear amplitude ramp-in and ramp-out ────────────────────
  const rampSamples = Math.round((rampDurationMs * sampleRateHz) / 1000);

  for (let i = 0; i < rampSamples && i < totalSamples; i++) {
    const gain = i / rampSamples; // 0 → 1
    out[i]! *= gain;
  }

  for (let i = 0; i < rampSamples && i < totalSamples; i++) {
    const idx = totalSamples - 1 - i;
    const gain = i / rampSamples; // 0 → 1 (counting from the end)
    out[idx]! *= gain;
  }

  return out;
}
