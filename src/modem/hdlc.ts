/**
 * HDLC framing for Bell 202 / AX.25-compatible packets.
 *
 * Frame layout (bit stream):
 *   [preamble: N × 0x7E flags]
 *   [opening flag: 0x7E]
 *   [bit-stuffed payload + CRC-16/X.25 (little-endian)]
 *   [closing flags: 3 × 0x7E]
 *
 * Bit stuffing rule: after 5 consecutive 1-bits in the data region, insert a
 * 0-bit.  The flag byte 0x7E (01111110) is never stuffed, allowing receivers
 * to sync on it.
 *
 * All functions are pure; state for streaming deframe is kept as plain data.
 * No DOM / browser dependencies — safe to run in Node.js.
 */

import { appendCrc, verifyCrc } from "./crc.js";

/** Bit pattern for HDLC flag 0x7E, LSB first. */
const FLAG_BITS: readonly number[] = [0, 1, 1, 1, 1, 1, 1, 0];

/** Number of preamble flag bytes emitted before the opening flag. */
const DEFAULT_PREAMBLE_FLAGS = 24; // ≈ 160 ms at 1200 baud

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert a byte to 8 bits, LSB first. */
function byteToBitsLsb(byte: number): number[] {
  const bits: number[] = [];
  for (let i = 0; i < 8; i++) {
    bits.push((byte >>> i) & 1);
  }
  return bits;
}

/** Convert 8 bits (LSB first) to a byte. */
function bitsLsbToByte(bits: number[]): number {
  let byte = 0;
  for (let i = 0; i < 8; i++) {
    byte |= (bits[i] as number) << i;
  }
  return byte;
}

/** Bit-stuff a raw bit array: insert a 0 after every run of 5 ones. */
function bitStuff(bits: readonly number[]): number[] {
  const out: number[] = [];
  let onesRun = 0;
  for (const bit of bits) {
    out.push(bit);
    if (bit === 1) {
      onesRun++;
      if (onesRun === 5) {
        out.push(0); // stuffed zero
        onesRun = 0;
      }
    } else {
      onesRun = 0;
    }
  }
  return out;
}

/** Bit-destuff: remove the 0 that follows every run of 5 ones. */
function bitDestuff(bits: readonly number[]): number[] {
  const out: number[] = [];
  let onesRun = 0;
  let skipNext = false;
  for (const bit of bits) {
    if (skipNext) {
      // This should be the stuffed 0 — discard it.
      skipNext = false;
      onesRun = 0;
      continue;
    }
    out.push(bit);
    if (bit === 1) {
      onesRun++;
      if (onesRun === 5) {
        skipNext = true;
        onesRun = 0;
      }
    } else {
      onesRun = 0;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Frame a payload into an HDLC bit stream ready for NRZI encoding.
 *
 * @param payload - Raw bytes to transmit (0–255 bytes)
 * @param preambleFlagCount - Number of 0x7E preamble flags (default 24, ~160 ms at 1200 baud)
 * @returns Flat bit array (each element 0 or 1), LSB-first per byte
 */
export function frame(
  payload: Uint8Array,
  preambleFlagCount = DEFAULT_PREAMBLE_FLAGS,
): number[] {
  // 1. Append CRC to payload
  const withCrc = appendCrc(payload);

  // 2. Build the data bits (LSB first per byte)
  const dataBits: number[] = [];
  for (const byte of withCrc) {
    dataBits.push(...byteToBitsLsb(byte));
  }

  // 3. Bit-stuff the data region
  const stuffedBits = bitStuff(dataBits);

  // 4. Assemble the full bit stream
  const out: number[] = [];

  // Preamble flags
  for (let i = 0; i < preambleFlagCount; i++) {
    out.push(...FLAG_BITS);
  }

  // Opening flag
  out.push(...FLAG_BITS);

  // Bit-stuffed data + CRC
  out.push(...stuffedBits);

  // 3-flag trailer
  for (let i = 0; i < 3; i++) {
    out.push(...FLAG_BITS);
  }

  return out;
}

// ---------------------------------------------------------------------------
// Deframer — stateful stream decoder kept as plain data
// ---------------------------------------------------------------------------

/**
 * Plain-data state for the streaming HDLC deframer.
 *
 * The HDLC flag `01111110` poses a challenge for streaming: we cannot know
 * whether the leading `0` is data or a flag-opener until we have seen all six
 * following ones AND the closing `0`.  To handle this correctly we defer
 * committing a `0` bit until the subsequent 1-run is resolved:
 *
 *   pendingZero=false, pendingOnes=0  → quiescent
 *   after a data 0 arrives            → pendingZero=true (not yet committed)
 *   then 1s arrive                    → pendingOnes counts them
 *   next 0 arrives:
 *     pendingOnes == 5  → stuffed zero: commit pendingZero+5 ones, discard this 0
 *     pendingOnes == 6  → flag:         discard pendingZero+6 ones, close/open frame
 *     pendingOnes  > 6  → abort:        reset everything
 *     pendingOnes  < 5  → data:         commit pendingZero+pendingOnes ones, then
 *                                        set pendingZero=true for this new 0
 */
export interface DeframeState {
  /** Confirmed data bits accumulated since the last flag. */
  bitBuffer: number[];
  /** Whether we are currently inside a frame (seen opening flag). */
  inFrame: boolean;
  /** True when the most recent 0 is deferred (not yet committed). */
  pendingZero: boolean;
  /** Count of consecutive 1-bits accumulated after the deferred 0. */
  pendingOnes: number;
  /** Kept for interface stability. */
  skipNext: boolean;
  /** Kept for interface stability. */
  onesRun: number;
}

/** Create a fresh DeframeState. */
export function createDeframeState(): DeframeState {
  return {
    bitBuffer: [],
    inFrame: false,
    pendingZero: false,
    pendingOnes: 0,
    skipNext: false,
    onesRun: 0,
  };
}

/**
 * Feed one bit into the streaming deframer.
 * Returns [completedFrames, newState].
 */
export function deframeBit(
  state: DeframeState,
  bit: number,
): [Uint8Array[], DeframeState] {
  const completed: Uint8Array[] = [];

  let bitBuffer = [...state.bitBuffer];
  let { inFrame, pendingZero, pendingOnes } = state;

  if (bit === 1) {
    pendingOnes++;
    return [completed, { bitBuffer, inFrame, pendingZero, pendingOnes, skipNext: false, onesRun: 0 }];
  }

  // ── bit === 0 ──────────────────────────────────────────────────────────────
  if (pendingOnes === 5) {
    // Stuffed zero: the deferred 0 (if any) + 5 ones are real data; this 0 is discarded.
    if (inFrame) {
      if (pendingZero) bitBuffer.push(0);
      for (let i = 0; i < 5; i++) bitBuffer.push(1);
    }
    pendingZero = false;
    pendingOnes = 0;
  } else if (pendingOnes === 6) {
    // Flag byte: deferred 0 + 6 ones + this closing 0 = 01111110
    // Discard all of them. Close the current frame if open.
    if (inFrame && bitBuffer.length >= 16) {
      const extracted = tryExtractFrame(bitBuffer);
      if (extracted !== null) completed.push(extracted);
    }
    bitBuffer = [];
    inFrame = true;
    pendingZero = false;
    pendingOnes = 0;
  } else if (pendingOnes > 6) {
    // Abort sequence — reset
    bitBuffer = [];
    inFrame = false;
    pendingZero = false;
    pendingOnes = 0;
  } else {
    // Normal data: commit deferred 0 (if any) + pendingOnes ones, defer this new 0
    if (inFrame) {
      if (pendingZero) bitBuffer.push(0);
      for (let i = 0; i < pendingOnes; i++) bitBuffer.push(1);
    }
    pendingZero = true;   // defer this 0 until next 1-run is resolved
    pendingOnes = 0;
  }

  return [completed, { bitBuffer, inFrame, pendingZero, pendingOnes, skipNext: false, onesRun: 0 }];
}

/**
 * Attempt to decode the accumulated (already-destuffed by the per-bit logic)
 * bit buffer into a valid frame payload.
 *
 * Returns the payload (without CRC) if CRC checks out, else null.
 */
function tryExtractFrame(bits: number[]): Uint8Array | null {
  // Must be a whole number of bytes
  if (bits.length % 8 !== 0) return null;
  // Must have at least 2 CRC bytes
  if (bits.length < 16) return null;

  const bytes = new Uint8Array(bits.length / 8);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = bitsLsbToByte(bits.slice(i * 8, i * 8 + 8));
  }

  if (!verifyCrc(bytes)) return null;

  // Strip the 2 CRC bytes
  return bytes.slice(0, bytes.length - 2);
}

/**
 * Convenience batch function: feed an entire bit array and collect all
 * complete frames found.
 *
 * @param bits - Full NRZI-decoded bit stream
 * @returns Array of decoded payloads (CRC verified, CRC bytes stripped)
 */
export function deframe(bits: readonly number[]): Uint8Array[] {
  let state = createDeframeState();
  const results: Uint8Array[] = [];

  for (const bit of bits) {
    const [frames, nextState] = deframeBit(state, bit);
    results.push(...frames);
    state = nextState;
  }

  return results;
}
