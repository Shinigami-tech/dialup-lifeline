/**
 * Tests for HDLC framing + NRZI encoding — Task 2 (Req 1.2, 3.1, 3.2)
 *
 * Unit tests:  known bit patterns, flag detection, bit stuffing, CRC rejection
 * Property:    for any Uint8Array (0–255 bytes), deframe(frame(payload)) == payload
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { frame, deframe, createDeframeState, deframeBit } from "../../src/modem/hdlc.js";
import { nrziEncode, nrziDecode } from "../../src/modem/nrzi.js";

// ---------------------------------------------------------------------------
// NRZI unit tests
// ---------------------------------------------------------------------------

describe("nrziEncode / nrziDecode", () => {
  it("encodes known pattern: all-zeros become alternating levels", () => {
    // Each 0-bit causes a transition starting from level 1
    const bits = [0, 0, 0, 0];
    const encoded = nrziEncode(bits, 1);
    expect(encoded).toEqual([0, 1, 0, 1]);
  });

  it("encodes known pattern: all-ones stay constant", () => {
    const bits = [1, 1, 1, 1];
    const encoded = nrziEncode(bits, 1);
    expect(encoded).toEqual([1, 1, 1, 1]);
  });

  it("encodes the flag byte 0x7E (LSB first: 0,1,1,1,1,1,1,0)", () => {
    // 0x7E = 0111 1110; LSB first → 0,1,1,1,1,1,1,0
    const flagBits = [0, 1, 1, 1, 1, 1, 1, 0];
    const encoded = nrziEncode(flagBits, 1);
    // bit0=0 → transition: 1→0
    // bit1=1 → no transition: 0
    // bit2=1 → no transition: 0
    // bit3=1 → no transition: 0
    // bit4=1 → no transition: 0
    // bit5=1 → no transition: 0
    // bit6=1 → no transition: 0
    // bit7=0 → transition: 0→1
    expect(encoded).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
  });

  it("round-trips arbitrary bit arrays", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 1 }), { minLength: 0, maxLength: 200 }),
        fc.integer({ min: 0, max: 1 }),
        (bits, initialLevel) => {
          const encoded = nrziEncode(bits, initialLevel);
          const decoded = nrziDecode(encoded, initialLevel);
          expect(decoded).toEqual(bits);
        },
      ),
    );
  });
});

// ---------------------------------------------------------------------------
// HDLC unit tests
// ---------------------------------------------------------------------------

describe("frame()", () => {
  it("starts with the flag byte 0x7E (preamble)", () => {
    const bits = frame(new Uint8Array([0xaa]));
    // First 8 bits should be flag: 0,1,1,1,1,1,1,0
    expect(bits.slice(0, 8)).toEqual([0, 1, 1, 1, 1, 1, 1, 0]);
  });

  it("ends with 3 flag bytes", () => {
    const bits = frame(new Uint8Array([0x00]));
    const tail = bits.slice(-24);
    const expectedFlag = [0, 1, 1, 1, 1, 1, 1, 0];
    expect(tail.slice(0, 8)).toEqual(expectedFlag);
    expect(tail.slice(8, 16)).toEqual(expectedFlag);
    expect(tail.slice(16, 24)).toEqual(expectedFlag);
  });

  it("inserts a stuffed zero after 5 consecutive data ones", () => {
    // Payload byte 0xFF = 11111111 (8 ones) — will trigger stuffing
    const payload = new Uint8Array([0xff]);
    const bits = frame(payload, 0); // no preamble for easier inspection
    // Find the data region (after opening flag, 8 bits in)
    const dataStart = 8;
    const dataRegion = bits.slice(dataStart, dataStart + 20);
    // After 5 ones we should see a 0 inserted
    // 0xFF LSB first = 1,1,1,1,1,1,1,1 → stuffed: 1,1,1,1,1,0,1,1,1,0,1
    expect(dataRegion[5]).toBe(0); // stuffed zero after first 5 ones
  });

  it("empty payload produces a valid frame with just CRC", () => {
    const bits = frame(new Uint8Array(0), 0);
    const frames = deframe(bits);
    expect(frames).toHaveLength(1);
    expect(frames[0]).toEqual(new Uint8Array(0));
  });
});

describe("deframe()", () => {
  it("recovers a single-byte payload", () => {
    const payload = new Uint8Array([0x42]);
    const bits = frame(payload);
    const result = deframe(bits);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(payload);
  });

  it("recovers a multi-byte payload", () => {
    const payload = new Uint8Array([0x01, 0x02, 0x03, 0x04, 0x05]);
    const bits = frame(payload);
    const result = deframe(bits);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(payload);
  });

  it("discards a frame with a flipped bit (bad CRC)", () => {
    const payload = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
    const bits = frame(payload, 0);
    // Flip one bit in the data region (after the opening flag at bit 8)
    bits[20] ^= 1;
    const result = deframe(bits);
    expect(result).toHaveLength(0);
  });

  it("recovers multiple frames concatenated", () => {
    const p1 = new Uint8Array([0x11, 0x22]);
    const p2 = new Uint8Array([0x33, 0x44, 0x55]);
    // Concatenate bit streams (share trailing flags as next preamble)
    const bits = [...frame(p1, 4), ...frame(p2, 4)];
    const result = deframe(bits);
    // At least both frames should be found
    const found1 = result.some(
      (f) => f.length === p1.length && f[0] === p1[0] && f[1] === p1[1],
    );
    const found2 = result.some(
      (f) => f.length === p2.length && f[0] === p2[0] && f[1] === p2[1] && f[2] === p2[2],
    );
    expect(found1).toBe(true);
    expect(found2).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// HDLC + NRZI combined round-trip unit test
// ---------------------------------------------------------------------------

describe("HDLC + NRZI combined round-trip", () => {
  it("survives NRZI encode then decode", () => {
    const payload = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]); // "Hello"
    const frameBits = frame(payload);
    const nrziEncoded = nrziEncode(frameBits);
    const nrziDecoded = nrziDecode(nrziEncoded);
    const result = deframe(nrziDecoded);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(payload);
  });
});

// ---------------------------------------------------------------------------
// Property-based tests  — Validates: Requirements 3.2
// ---------------------------------------------------------------------------

describe("HDLC round-trip property (Req 3.2)", () => {
  it("deframe(frame(payload)) === payload for any Uint8Array 0–255 bytes", () => {
    fc.assert(
      fc.property(
        fc.uint8Array({ minLength: 0, maxLength: 255 }),
        (payload) => {
          const bits = frame(payload);
          const decoded = deframe(bits);
          expect(decoded).toHaveLength(1);
          expect(decoded[0]).toEqual(payload);
        },
      ),
      { numRuns: 500 },
    );
  });

  it("HDLC + NRZI combined round-trip for any payload", () => {
    fc.assert(
      fc.property(
        fc.uint8Array({ minLength: 0, maxLength: 255 }),
        fc.integer({ min: 0, max: 1 }),
        (payload, initialLevel) => {
          const bits = frame(payload);
          const encoded = nrziEncode(bits, initialLevel);
          const decoded = nrziDecode(encoded, initialLevel);
          const frames = deframe(decoded);
          expect(frames).toHaveLength(1);
          expect(frames[0]).toEqual(payload);
        },
      ),
      { numRuns: 500 },
    );
  });
});
