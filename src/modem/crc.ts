/**
 * CRC-16/X.25
 *
 * Parameters:
 *   Polynomial : 0x1021  (generator G(x) = x^16 + x^12 + x^5 + 1)
 *   Init       : 0xFFFF
 *   RefIn      : true    (each input byte is processed LSB-first)
 *   RefOut     : true    (output register is reflected before final XOR)
 *   XorOut     : 0xFFFF
 *   Check      : 0x906E  (CRC of ASCII "123456789")
 *   Residue    : 0x0F47  (CRC of any valid message + its own CRC bytes LE)
 *
 * Used by HDLC, AX.25 and APRS for frame check sequences.
 */

/** Precomputed reflected CRC-16/X.25 lookup table (256 entries). */
const TABLE: Uint16Array = (() => {
  const table = new Uint16Array(256);
  for (let i = 0; i < 256; i++) {
    // Reflect the byte (process LSB-first)
    let crc = i;
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0x8408 : crc >>> 1;
      // 0x8408 is 0x1021 reflected
    }
    table[i] = crc;
  }
  return table;
})();

/**
 * Compute CRC-16/X.25 over `bytes`.
 *
 * @param bytes - Input data
 * @returns 16-bit CRC value (before appending to a frame)
 *
 * @example
 * // Standard check value
 * crc16x25(new TextEncoder().encode("123456789")) === 0x906E
 */
export function crc16x25(bytes: Uint8Array): number {
  let crc = 0xffff; // init
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i] as number;
    crc = (crc >>> 8) ^ (TABLE[(crc ^ byte) & 0xff] as number);
  }
  return (crc ^ 0xffff) & 0xffff; // final XOR
}

/**
 * Append the CRC-16/X.25 of `payload` to it, returning a new buffer.
 * The CRC is stored little-endian (low byte first), matching HDLC/AX.25 convention.
 *
 * @param payload - Frame payload bytes
 * @returns payload + 2-byte CRC (little-endian)
 */
export function appendCrc(payload: Uint8Array): Uint8Array {
  const crc = crc16x25(payload);
  const out = new Uint8Array(payload.length + 2);
  out.set(payload);
  out[payload.length] = crc & 0xff;        // low byte
  out[payload.length + 1] = (crc >>> 8) & 0xff; // high byte
  return out;
}

/**
 * Verify a buffer that ends with its own CRC-16/X.25 (little-endian).
 * A valid framed buffer always produces the residue 0xF0B8.
 *
 * @param framedBytes - payload + 2-byte CRC (little-endian)
 * @returns true if the frame check sequence is correct
 */
export function verifyCrc(framedBytes: Uint8Array): boolean {
  return crc16x25(framedBytes) === 0x0f47;
}
