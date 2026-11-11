/**
 * Quadrature-correlator AFSK demodulator with second-order digital PLL.
 *
 * Pipeline:
 *   Float32 PCM → gain normalise → quadrature correlators @1200/2200 Hz
 *     → energy difference (soft decision) → 2nd-order PLL bit-clock recovery
 *     → hard-bit sample → NRZI decode → HDLC deframe → Uint8Array[] payloads
 *
 * Correlator design:
 *   We maintain a circular buffer of the last W = round(fs/baud) normalised
 *   samples.  On each PLL tick we compute a full dot-product of that buffer
 *   against reference cosine/sine vectors.  This is O(W) ≈ 37 multiplies per
 *   SAMPLE, which is well within budget for an AudioWorklet.
 *
 *   The reference vectors are keyed by DELAY (not absolute time), so they are
 *   fixed and computed once at construction:
 *
 *     I = Σ_{k=0}^{W-1}  x[n-k] · cos(2πf·k/fs)
 *     Q = Σ_{k=0}^{W-1}  x[n-k] · sin(2πf·k/fs)
 *
 *   This equals the standard DFT correlator because:
 *     Σ x[n-k]·e^{−j2πf·(n-k)/fs} = e^{−j2πf·n/fs} · Σ x[n-k]·e^{+j2πf·k/fs}
 *   The leading phase term cancels out in the energy I²+Q².
 *
 * PLL design — second order:
 *   A first-order PLL (phase-only nudge) drifts at ±2% because a steady clock
 *   offset creates a constant phase error per symbol that the proportional term
 *   can only partially cancel.  A second-order PLL adds a frequency integrator:
 *
 *     err        = pllPhase − 0.5           (measured at each zero-crossing)
 *     pllPhase  -= alpha · err              (proportional: fast phase correction)
 *     pllFreqBias += beta · err             (integral: slow frequency correction)
 *
 *   The effective per-sample increment is:
 *     nominalInc + pllFreqBias
 *
 *   where nominalInc = 1/symbolLen.  With beta ≈ alpha²/4 the loop settles in
 *   ~1/beta ≈ 2000 samples (~60 bits) for a constant 2% frequency offset while
 *   remaining stable over the ±5% range observable in practice.
 *
 *   The causal sliding window means zero-crossings of the soft decision land
 *   ~W/2 samples after the bit boundary — i.e. at PLL phase ≈ 0.5 (where
 *   phase=0..1, fire at 1.0 = end-of-symbol).
 *   Initial phase = 0 → first fire at end of first symbol.
 *
 * Pure TypeScript, zero DOM / browser dependencies — runs in Node.
 *
 * Req 2.1, 2.2, 2.4
 */

import { deframeBit, createDeframeState, type DeframeState } from "./hdlc.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface AfskRxOptions {
  /** Audio input sample rate in Hz (e.g. 44100 or 48000). */
  sampleRateHz: number;
  /** Baud rate. Default 1200. */
  baudRate?: number;
  /** Mark frequency in Hz. Default 1200. */
  markHz?: number;
  /** Space frequency in Hz. Default 2200. */
  spaceHz?: number;
  /**
   * PLL proportional gain α in [0, 1].  Larger → faster phase lock but noisier.
   * Default 0.15 (balances ±2% clock tolerance against phase jitter).
   */
  pllAlpha?: number;
  /**
   * PLL integral gain β in [0, 1].  Controls how quickly frequency offset is
   * absorbed.  Default alpha²/4; set explicitly to override.
   */
  pllBeta?: number;
}

export interface DemodulatorStats {
  /** Frames whose CRC was invalid and were dropped. */
  corruptedFrames: number;
  /** Frames successfully decoded. */
  decodedFrames: number;
  /** Total hard bits clocked out by the PLL. */
  totalBits: number;
}

/** Demodulator handle returned by createDemodulator. */
export interface Demodulator {
  /**
   * Push a chunk of Float32 PCM samples into the demodulator.
   * Returns all complete frames (CRC-verified payloads) decoded so far.
   */
  push(samples: Float32Array): Uint8Array[];
  /** Live statistics — mutated in place, safe to read between calls. */
  stats: DemodulatorStats;
}

// ---------------------------------------------------------------------------
// createDemodulator
// ---------------------------------------------------------------------------

/**
 * Create a streaming AFSK demodulator.
 *
 * @param opts - Demodulator options (`sampleRateHz` is mandatory)
 * @returns `{ push(samples): Uint8Array[], stats }`
 */
export function createDemodulator(opts: AfskRxOptions): Demodulator {
  const {
    sampleRateHz,
    baudRate = 1200,
    markHz = 1200,
    spaceHz = 2200,
    pllAlpha = 0.15,
  } = opts;
  const pllBeta = opts.pllBeta ?? 0.002;

  // Samples per symbol (may be fractional; PLL manages fractional drift).
  const symbolLen = sampleRateHz / baudRate;
  const windowSize = Math.round(symbolLen); // W

  // ── Pre-computed reference vectors (delay-domain, fixed) ─────────────────
  // For delay k ∈ [0, W-1]:
  //   markCos[k]  = cos(2π·markHz·k/fs)
  //   markSin[k]  = sin(2π·markHz·k/fs)
  //   spaceCos[k] = cos(2π·spaceHz·k/fs)
  //   spaceSin[k] = sin(2π·spaceHz·k/fs)
  const markCos  = new Float32Array(windowSize);
  const markSin  = new Float32Array(windowSize);
  const spaceCos = new Float32Array(windowSize);
  const spaceSin = new Float32Array(windowSize);
  for (let k = 0; k < windowSize; k++) {
    const phase = (2 * Math.PI * k) / sampleRateHz;
    markCos[k]  = Math.cos(markHz  * phase);
    markSin[k]  = Math.sin(markHz  * phase);
    spaceCos[k] = Math.cos(spaceHz * phase);
    spaceSin[k] = Math.sin(spaceHz * phase);
  }

  // ── Circular sample buffer (last W normalised samples) ────────────────────
  const sampleBuf = new Float32Array(windowSize);
  let bufHead = 0; // index of the most-recently written slot

  // ── AGC: RMS normaliser over ~100 ms ──────────────────────────────────────
  const rmsWinSize = Math.round(sampleRateHz * 0.1);
  const rmsBuf = new Float32Array(rmsWinSize);
  let rmsBufPos = 0;
  let rmsRunSum = 0;
  let gainFactor = 1.0;

  // ── Second-order PLL ──────────────────────────────────────────────────────
  // pllPhase ∈ [0, 1).  Fires (clocks out a bit) when it wraps past 1.0.
  //
  // On each zero-crossing of the soft decision:
  //   err         = pllPhase − 0.5         (ideal crossing at mid-symbol)
  //   pllPhase   -= alpha · err            (proportional: immediate phase correction)
  //   pllFreqBias += beta  · err           (integral: steady-state frequency correction)
  //
  // Effective increment per sample: nominalInc + pllFreqBias
  // pllFreqBias is clamped to ±5% of nominalInc to prevent runaway.
  const nominalInc  = 1.0 / symbolLen;
  const maxFreqBias = nominalInc * 0.05; // allow ±5% frequency correction
  let pllPhase    = 0.0;
  let pllFreqBias = 0.0;

  // ── Soft-decision history (for zero-crossing detection) ───────────────────
  let prevSoft = 0;

  // ── NRZI tracking ─────────────────────────────────────────────────────────
  let prevNrziLevel = 1;

  // ── HDLC streaming deframer ───────────────────────────────────────────────
  let deframeState: DeframeState = createDeframeState();

  // ── Stats ─────────────────────────────────────────────────────────────────
  const stats: DemodulatorStats = {
    corruptedFrames: 0,
    decodedFrames: 0,
    totalBits: 0,
  };

  // ---------------------------------------------------------------------------
  // Correlate: compute mark and space energies from the circular sample buffer.
  // ---------------------------------------------------------------------------
  function correlate(): { soft: number } {
    let mI = 0, mQ = 0, sI = 0, sQ = 0;
    // bufHead points to the most recently written slot.
    // Delay k=0 → bufHead, delay k=1 → bufHead-1 (mod W), etc.
    for (let k = 0; k < windowSize; k++) {
      const slotIdx = (bufHead - k + windowSize) % windowSize;
      const x = sampleBuf[slotIdx] ?? 0;
      mI += x * (markCos[k]  ?? 0);
      mQ += x * (markSin[k]  ?? 0);
      sI += x * (spaceCos[k] ?? 0);
      sQ += x * (spaceSin[k] ?? 0);
    }
    const markE  = mI * mI + mQ * mQ;
    const spaceE = sI * sI + sQ * sQ;
    return { soft: markE - spaceE };
  }

  // ---------------------------------------------------------------------------
  // push()
  // ---------------------------------------------------------------------------

  function push(samples: Float32Array): Uint8Array[] {
    const decoded: Uint8Array[] = [];

    for (let i = 0; i < samples.length; i++) {
      const raw = samples[i] ?? 0;

      // ── 1. AGC / gain normalise ───────────────────────────────────────
      const rmsIdx = rmsBufPos % rmsWinSize;
      const oldSq = rmsBuf[rmsIdx] ?? 0;
      const newSq = raw * raw;
      rmsRunSum = rmsRunSum - oldSq + newSq;
      rmsBuf[rmsIdx] = newSq;
      rmsBufPos++;

      const rms = Math.sqrt(Math.max(rmsRunSum / rmsWinSize, 0));
      if (rms > 1e-6) gainFactor = Math.min(1.0 / rms, 100.0);
      const x = raw * gainFactor;

      // ── 2. Write into circular buffer ─────────────────────────────────
      bufHead = (bufHead + 1) % windowSize;
      sampleBuf[bufHead] = x;

      // ── 3. Compute soft decision ──────────────────────────────────────
      const { soft } = correlate();

      // ── 4. Second-order PLL — zero-crossing phase & frequency correction
      const crossedZero =
        (prevSoft >= 0 && soft < 0) || (prevSoft < 0 && soft >= 0);
      prevSoft = soft;

      if (crossedZero) {
        // err = how far pllPhase is from the ideal crossing point (0.5).
        // Wrap into [-0.5, 0.5] to pick the shortest correction direction.
        let err = pllPhase - 0.5;
        if (err >  0.5) err -= 1.0;
        if (err < -0.5) err += 1.0;

        // Proportional: immediate phase nudge
        pllPhase -= pllAlpha * err;
        if (pllPhase < 0)  pllPhase += 1.0;
        if (pllPhase >= 1) pllPhase -= 1.0;

        // Integral: frequency bias accumulation (clamped to ±5% of nominal)
        // err > 0 means our clock runs fast → decrease increment to slow down
        pllFreqBias -= pllBeta * err;
        if (pllFreqBias >  maxFreqBias) pllFreqBias =  maxFreqBias;
        if (pllFreqBias < -maxFreqBias) pllFreqBias = -maxFreqBias;
      }

      // Advance PLL by one sample using the corrected rate.
      pllPhase += nominalInc + pllFreqBias;

      // ── 5. Symbol clock tick ──────────────────────────────────────────
      if (pllPhase >= 1.0) {
        pllPhase -= 1.0;

        // Sample the soft decision: positive → mark (NRZI=1), negative → space (NRZI=0)
        const nrziLevel = soft >= 0 ? 1 : 0;

        // NRZI decode: transition → bit 0, no transition → bit 1
        const bit = nrziLevel === prevNrziLevel ? 1 : 0;
        prevNrziLevel = nrziLevel;
        stats.totalBits++;

        // ── 6. HDLC streaming deframer ────────────────────────────────
        const [frames, nextState] = deframeBit(deframeState, bit);
        deframeState = nextState;

        for (const f of frames) {
          stats.decodedFrames++;
          decoded.push(f);
        }
      }
    }

    return decoded;
  }

  return { push, stats };
}
