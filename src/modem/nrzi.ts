/**
 * NRZI (Non-Return-to-Zero Inverted) encoding/decoding.
 *
 * Convention (matching Bell 202 / HDLC / AX.25):
 *   0-bit → transition (level change)
 *   1-bit → no transition (level stays)
 *
 * Both functions accept and return plain number arrays where each element
 * is 0 or 1. They are pure functions with no side effects.
 */

/**
 * NRZI-encode a bit array.
 *
 * @param bits - Input bits (0 or 1)
 * @param initialLevel - Starting level before the first bit (default 1 / high)
 * @returns Encoded bit array of the same length
 */
export function nrziEncode(bits: readonly number[], initialLevel = 1): number[] {
  const out: number[] = [];
  let level = initialLevel & 1;
  for (const bit of bits) {
    if (bit === 0) {
      // 0 → transition
      level ^= 1;
    }
    // 1 → no transition: level unchanged
    out.push(level);
  }
  return out;
}

/**
 * NRZI-decode a bit array.
 *
 * @param bits - NRZI-encoded bits (0 or 1)
 * @param initialLevel - Starting level assumed before the first bit (default 1 / high)
 * @returns Decoded bit array of the same length
 */
export function nrziDecode(bits: readonly number[], initialLevel = 1): number[] {
  const out: number[] = [];
  let prev = initialLevel & 1;
  for (const bit of bits) {
    const level = bit & 1;
    // transition → 0, no transition → 1
    out.push(prev === level ? 1 : 0);
    prev = level;
  }
  return out;
}
