/**
 * Classic dial-up "screech" handshake synth (cosmetic, skippable).
 *
 * A stylised V.22-like handshake: answer tone, carrier hops, a
 * noise burst, then a short silent tail so the receiver is quiet before the
 * first real frame. Deterministic (noise comes from a seeded LCG), phase
 * continuous, with 5 ms ramps in/out. Pure TypeScript, no DOM.
 *
 * Skipping: `modulateWithScreech` prepends the screech only when
 * `screech` is true; otherwise its output is identical to `modulate`.
 *
 * Req 1.4
 */

import { modulate, type AfskTxOptions } from "./afsk-tx.js";

export interface ScreechOptions {
  /** Audio output sample rate, e.g. 44100 or 48000. */
  sampleRateHz: number;
  /** Total screech length in ms (including silent tail). Default 1500. */
  durationMs?: number;
  /** Peak amplitude in [0, 1]. Output stays within [-amplitude, +amplitude]. Default 0.5. */
  amplitude?: number;
  /** Noise PRNG seed (uint32). Default 0x1200. */
  seed?: number;
}

export const DEFAULT_SCREECH_DURATION_MS = 1500;
const RAMP_DURATION_MS = 5;
/** Silent tail so the demodulator sees quiet before the first preamble. */
const TAIL_SILENCE_MS = 100;

/** Tone plan as fractions of the audible part: [startFraction, freqHz, noiseMix]. */
const SEGMENTS: ReadonlyArray<readonly [number, number, number]> = [
  [0.0, 2100, 0.0], // answer tone
  [0.2, 1200, 0.0], // low carrier
  [0.3, 2400, 0.1], // high carrier
  [0.4, 1800, 0.5], // training: tone + noise
  [0.6, 980, 0.8], // mostly noise (the "shhh")
  [0.8, 1650, 0.4],
  [0.9, 2250, 0.1],
];

/**
 * Generate the classic screech as Float32 PCM.
 * Length is exactly round(durationMs * sampleRateHz / 1000) samples.
 */
export function synthesizeScreech(opts: ScreechOptions): Float32Array {
  const {
    sampleRateHz,
    durationMs = DEFAULT_SCREECH_DURATION_MS,
    amplitude = 0.5,
    seed = 0x1200,
  } = opts;

  const totalSamples = Math.max(0, Math.round((durationMs * sampleRateHz) / 1000));
  const out = new Float32Array(totalSamples);
  const tailSamples = Math.min(
    totalSamples,
    Math.round((TAIL_SILENCE_MS * sampleRateHz) / 1000),
  );
  const activeSamples = totalSamples - tailSamples;
  const rampSamples = Math.min(
    Math.round((RAMP_DURATION_MS * sampleRateHz) / 1000),
    Math.floor(activeSamples / 2),
  );

  let phaseRad = 0;
  let lcg = seed >>> 0;
  let seg = 0;

  for (let i = 0; i < activeSamples; i++) {
    const frac = i / activeSamples;
    while (seg + 1 < SEGMENTS.length && frac >= (SEGMENTS[seg + 1] as readonly number[])[0]!) seg++;
    const [, freqHz, noiseMix] = SEGMENTS[seg] as readonly [number, number, number];

    // Slow vibrato makes it sound more like a real handshake; phase stays continuous.
    const vibratoHz = freqHz * (1 + 0.02 * Math.sin((2 * Math.PI * 7 * i) / sampleRateHz));
    phaseRad += (2 * Math.PI * vibratoHz) / sampleRateHz;
    if (phaseRad > Math.PI) phaseRad -= 2 * Math.PI;

    lcg = (Math.imul(lcg, 1664525) + 1013904223) >>> 0;
    const noise = lcg / 0x80000000 - 1; // [-1, 1)

    // Convex mix keeps |sample| <= 1 before scaling by amplitude.
    let s = (1 - noiseMix) * Math.sin(phaseRad) + noiseMix * noise;

    if (i < rampSamples) s *= i / rampSamples;
    const fromEnd = activeSamples - 1 - i;
    if (fromEnd < rampSamples) s *= fromEnd / rampSamples;

    out[i] = s * amplitude;
  }

  return out;
}

export interface TransmitOptions extends AfskTxOptions {
  /** Prepend the classic screech. Default false (skipped). */
  screech?: boolean;
  /** Screech duration in ms. Default 1500. */
  screechDurationMs?: number;
  /** Screech amplitude. Defaults to the modulation amplitude * 0.5. */
  screechAmplitude?: number;
}

/**
 * Modulate a payload, optionally preceded by the classic screech.
 * With `screech` false/omitted the result is identical to `modulate`.
 */
export function modulateWithScreech(payload: Uint8Array, opts: TransmitOptions): Float32Array {
  const { screech = false, screechDurationMs, screechAmplitude, ...txOpts } = opts;
  const packet = modulate(payload, txOpts);
  if (!screech) return packet;

  const intro = synthesizeScreech({
    sampleRateHz: opts.sampleRateHz,
    durationMs: screechDurationMs ?? DEFAULT_SCREECH_DURATION_MS,
    amplitude: screechAmplitude ?? (opts.amplitude ?? 1) * 0.5,
  });
  const out = new Float32Array(intro.length + packet.length);
  out.set(intro, 0);
  out.set(packet, intro.length);
  return out;
}
