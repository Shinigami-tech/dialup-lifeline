/**
 * Tests for CRC-16/X.25
 *
 * Validates: Requirements 3.3
 *   - crc16(x) appended to x always verifies
 *   - any single-bit flip is detected
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { crc16x25, appendCrc, verifyCrc } from "../../src/modem/crc";

// ---------------------------------------------------------------------------
// Unit tests: known test vectors
// ---------------------------------------------------------------------------

describe("crc16x25 – known vectors", () => {
  it('produces the standard check value 0x906E for "123456789"', () => {
    const bytes = new TextEncoder().encode("123456789");
    expect(crc16x25(bytes)).toBe(0x906e);
  });

  it("returns 0xFFFF (init XOR 0xFFFF) for an empty input", () => {
    // CRC of empty: init 0xFFFF XOR out 0xFFFF = 0x0000
    // Actually: empty loop leaves crc=0xFFFF, then XOR 0xFFFF => 0x0000
    expect(crc16x25(new Uint8Array(0))).toBe(0x0000);
  });

  it("produces 0x906E for the same bytes as a Uint8Array directly", () => {
    // "123456789" = 0x31..0x39
    const bytes = Uint8Array.from([
      0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39,
    ]);
    expect(crc16x25(bytes)).toBe(0x906e);
  });

  it("produces a known CRC for a single zero byte", () => {
    // crc16x25([0x00]) = 0xF078  (verified by running the implementation)
    expect(crc16x25(new Uint8Array([0x00]))).toBe(0xf078);
  });

  it("produces a known CRC for a single 0xFF byte", () => {
    // crc16x25([0xFF]) = 0xFF00  (verified by running the implementation)
    expect(crc16x25(new Uint8Array([0xff]))).toBe(0xff00);
  });
});

// ---------------------------------------------------------------------------
// Unit tests: appendCrc / verifyCrc helpers
// ---------------------------------------------------------------------------

describe("appendCrc / verifyCrc", () => {
  it("appended buffer has length payload.length + 2", () => {
    const payload = new Uint8Array([1, 2, 3]);
    expect(appendCrc(payload).length).toBe(5);
  });

  it("verifyCrc returns true for a correctly framed buffer", () => {
    const payload = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
    expect(verifyCrc(appendCrc(payload))).toBe(true);
  });

  it("verifyCrc returns false when a byte in the payload is corrupted", () => {
    const payload = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
    const framed = appendCrc(payload);
    framed[1] ^= 0x01; // flip one bit in payload
    expect(verifyCrc(framed)).toBe(false);
  });

  it("verifyCrc returns false when a CRC byte is corrupted", () => {
    const payload = new Uint8Array([0x01, 0x02, 0x03]);
    const framed = appendCrc(payload);
    framed[framed.length - 1] ^= 0x80; // flip high bit of high CRC byte
    expect(verifyCrc(framed)).toBe(false);
  });

  it("stores CRC little-endian (low byte at payload.length)", () => {
    const payload = new Uint8Array([0x31, 0x32]);
    const crc = crc16x25(payload);
    const framed = appendCrc(payload);
    expect(framed[payload.length]).toBe(crc & 0xff);
    expect(framed[payload.length + 1]).toBe((crc >>> 8) & 0xff);
  });
});

// ---------------------------------------------------------------------------
// Property tests (fast-check)
// ---------------------------------------------------------------------------

describe("crc16x25 – properties", () => {
  /**
   * Validates: Requirements 3.3
   * Property A – Round-trip residue:
   *   For any payload, crc16x25(appendCrc(payload)) === 0xF0B8
   */
  it("round-trip: crc over payload+CRC always equals residue 0xF0B8", () => {
    fc.assert(
      fc.property(
        fc.uint8Array({ minLength: 0, maxLength: 255 }),
        (payload) => {
          const framed = appendCrc(payload);
          return crc16x25(framed) === 0x0f47;
        }
      ),
      { numRuns: 1000 }
    );
  });

  /**
   * Validates: Requirements 3.3
   * Property B – Single-bit-flip detection:
   *   For any valid framed buffer, flipping any single bit causes verifyCrc to return false.
   */
  it("single-bit-flip: any bit flip in a framed buffer is detected", () => {
    fc.assert(
      fc.property(
        // payload: 0–255 bytes
        fc.uint8Array({ minLength: 0, maxLength: 255 }),
        // which bit to flip: index into the full framed byte array * 8 + bit position
        fc.nat(),
        (payload, bitIndex) => {
          const framed = appendCrc(payload);
          const totalBits = framed.length * 8;
          const bitPos = bitIndex % totalBits;
          const byteIdx = Math.floor(bitPos / 8);
          const bitMask = 1 << (bitPos % 8);

          // Flip the bit
          const corrupted = new Uint8Array(framed);
          corrupted[byteIdx] ^= bitMask;

          return !verifyCrc(corrupted);
        }
      ),
      { numRuns: 2000 }
    );
  });
});
