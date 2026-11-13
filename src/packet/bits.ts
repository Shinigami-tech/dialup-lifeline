// Minimal MSB-first bit writer / reader. Pure, no DOM. Fields are at most 32 bits wide, so all
// arithmetic uses multiplication/division instead of 32-bit bitwise ops (which would go negative).

export interface BitWriter {
  bytes: number[];
  bitCount: number;
}

export function createBitWriter(): BitWriter {
  return { bytes: [], bitCount: 0 };
}

/** Append `width` bits of the unsigned integer `value`, most significant bit first. */
export function writeBits(w: BitWriter, value: number, width: number): void {
  if (!Number.isInteger(value) || value < 0 || value >= 2 ** width) {
    throw new RangeError(`value ${value} does not fit in ${width} bits`);
  }
  for (let i = width - 1; i >= 0; i--) {
    const bit = Math.floor(value / 2 ** i) % 2;
    const byteIndex = w.bitCount >> 3;
    if (byteIndex === w.bytes.length) w.bytes.push(0);
    if (bit === 1) w.bytes[byteIndex] = (w.bytes[byteIndex] ?? 0) | (0x80 >> (w.bitCount & 7));
    w.bitCount++;
  }
}

/** Append whole bytes. The writer must be byte aligned. */
export function writeBytes(w: BitWriter, data: Uint8Array): void {
  if (w.bitCount % 8 !== 0) throw new RangeError('writer is not byte aligned');
  for (const b of data) {
    w.bytes.push(b);
    w.bitCount += 8;
  }
}

export interface BitReader {
  data: Uint8Array;
  bitPos: number;
}

export function createBitReader(data: Uint8Array): BitReader {
  return { data, bitPos: 0 };
}

/** Read `width` bits as an unsigned integer. Throws RangeError when reading past the end. */
export function readBits(r: BitReader, width: number): number {
  if (r.bitPos + width > r.data.length * 8) throw new RangeError('read past end of data');
  let value = 0;
  for (let i = 0; i < width; i++) {
    const byte = r.data[r.bitPos >> 3] ?? 0;
    const bit = (byte >> (7 - (r.bitPos & 7))) & 1;
    value = value * 2 + bit;
    r.bitPos++;
  }
  return value;
}
