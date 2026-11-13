// Compact binary packet (see .kiro/specs/mesh-relay/design.md). Pure, no DOM, i18n-free.
//
// Layout (MSB first, 136 bits = 17 bytes fixed header):
//   version 3 | type 3 | hop 3 | ttl 3 | msgId 32 | originMinutes 24 | lat 21 | lon 22
//   | accuracyClass 3 | statusFlags 8 | people 4 | battery 4 | noteLength 6
// followed, byte aligned, by:
//   refMsgId 32 bits   (only for ACK and INFO, which refer to another message)
//   note     noteLength bytes of UTF-8 (0..40)
import { createBitReader, createBitWriter, readBits, writeBits, writeBytes } from './bits';

export const PACKET_VERSION = 1;
export const PACKET_TYPES = ['SOS', 'OK', 'ACK', 'INFO'] as const;
export type PacketType = (typeof PACKET_TYPES)[number];

export const FIXED_HEADER_BYTES = 17;
export const MAX_NOTE_BYTES = 40;
export const MAX_HOP = 7;
export const MAX_TTL = 7;
/** Origin time is counted in minutes since 2026-01-01T00:00:00Z. */
export const ORIGIN_EPOCH_MS = Date.UTC(2026, 0, 1);
export const MAX_ORIGIN_MINUTES = 2 ** 24 - 1;
/** Battery is in 10 % steps (0..10); 15 means unknown. */
export const BATTERY_UNKNOWN = 15;

const LAT_OFFSET_E4 = 900000;
const LON_OFFSET_E4 = 1800000;
const MAX_LAT_RAW = 2 * LAT_OFFSET_E4;
const MAX_LON_RAW = 2 * LON_OFFSET_E4;

export interface PacketPosition {
  /** Latitude in 1e-4 degrees (~11 m), -900000..900000. */
  latE4: number;
  /** Longitude in 1e-4 degrees, -1800000..1800000. */
  lonE4: number;
}

export interface Packet {
  version: number;
  type: PacketType;
  /** Relay hops so far, 0..7. */
  hop: number;
  /** Maximum relay hops, 0..7. */
  ttl: number;
  /** Random unsigned 32-bit message id. */
  msgId: number;
  /** Minutes since 2026-01-01T00:00:00Z, 0..2^24-1. */
  originMinutes: number;
  /** null = no GPS fix. */
  position: PacketPosition | null;
  /** 0 = no fix (required when position is null), 1..7 = accuracy class (required when position is set). */
  accuracyClass: number;
  /** 8 status bits, meaning assigned by the app layer. */
  statusFlags: number;
  /** 0..15 */
  people: number;
  /** 0..10 in 10 % steps, or BATTERY_UNKNOWN. */
  battery: number;
  /** Referenced message id; required for ACK and INFO, null otherwise. */
  refMsgId: number | null;
  /** UTF-8 note, at most 40 bytes once encoded. Empty string = no note. */
  note: string;
}

function hasRef(type: PacketType): boolean {
  return type === 'ACK' || type === 'INFO';
}

function isUint(v: number, bits: number): boolean {
  return Number.isInteger(v) && v >= 0 && v < 2 ** bits;
}

/** Returns a description of the first problem found, or null when the packet is valid and encodable. */
export function validatePacket(p: Packet): string | null {
  if (p.version !== PACKET_VERSION) return 'version';
  if (!PACKET_TYPES.includes(p.type)) return 'type';
  if (!isUint(p.hop, 3)) return 'hop';
  if (!isUint(p.ttl, 3)) return 'ttl';
  if (!isUint(p.msgId, 32)) return 'msgId';
  if (!isUint(p.originMinutes, 24)) return 'originMinutes';
  if (p.position === null) {
    if (p.accuracyClass !== 0) return 'accuracyClass';
  } else {
    const { latE4, lonE4 } = p.position;
    if (!Number.isInteger(latE4) || Math.abs(latE4) > LAT_OFFSET_E4) return 'latE4';
    if (!Number.isInteger(lonE4) || Math.abs(lonE4) > LON_OFFSET_E4) return 'lonE4';
    if (!isUint(p.accuracyClass, 3) || p.accuracyClass === 0) return 'accuracyClass';
  }
  if (!isUint(p.statusFlags, 8)) return 'statusFlags';
  if (!isUint(p.people, 4)) return 'people';
  if (!isUint(p.battery, 4) || (p.battery > 10 && p.battery !== BATTERY_UNKNOWN)) return 'battery';
  if (hasRef(p.type)) {
    if (p.refMsgId === null || !isUint(p.refMsgId, 32)) return 'refMsgId';
  } else if (p.refMsgId !== null) return 'refMsgId';
  if (typeof p.note !== 'string' || new TextEncoder().encode(p.note).length > MAX_NOTE_BYTES) return 'note';
  return null;
}

/** Encode a valid packet. Throws RangeError when the packet is not valid (a programming error). */
export function encodePacket(p: Packet): Uint8Array {
  const problem = validatePacket(p);
  if (problem !== null) throw new RangeError(`invalid packet field: ${problem}`);
  const noteBytes = new TextEncoder().encode(p.note);
  const w = createBitWriter();
  writeBits(w, p.version, 3);
  writeBits(w, PACKET_TYPES.indexOf(p.type), 3);
  writeBits(w, p.hop, 3);
  writeBits(w, p.ttl, 3);
  writeBits(w, p.msgId, 32);
  writeBits(w, p.originMinutes, 24);
  writeBits(w, p.position ? p.position.latE4 + LAT_OFFSET_E4 : 0, 21);
  writeBits(w, p.position ? p.position.lonE4 + LON_OFFSET_E4 : 0, 22);
  writeBits(w, p.accuracyClass, 3);
  writeBits(w, p.statusFlags, 8);
  writeBits(w, p.people, 4);
  writeBits(w, p.battery, 4);
  writeBits(w, noteBytes.length, 6);
  if (hasRef(p.type)) writeBits(w, p.refMsgId ?? 0, 32);
  writeBytes(w, noteBytes);
  return Uint8Array.from(w.bytes);
}

/**
 * Decode bytes into a packet. Never throws: returns null for anything that is not exactly one
 * well-formed packet (truncated, trailing bytes, unknown version/type, out-of-range fields,
 * inconsistent position, invalid UTF-8).
 */
export function decodePacket(data: Uint8Array): Packet | null {
  if (data.length < FIXED_HEADER_BYTES) return null;
  try {
    const r = createBitReader(data);
    const version = readBits(r, 3);
    const typeIndex = readBits(r, 3);
    const type = PACKET_TYPES[typeIndex];
    if (version !== PACKET_VERSION || type === undefined) return null;
    const hop = readBits(r, 3);
    const ttl = readBits(r, 3);
    const msgId = readBits(r, 32);
    const originMinutes = readBits(r, 24);
    const latRaw = readBits(r, 21);
    const lonRaw = readBits(r, 22);
    const accuracyClass = readBits(r, 3);
    const statusFlags = readBits(r, 8);
    const people = readBits(r, 4);
    const battery = readBits(r, 4);
    const noteLength = readBits(r, 6);
    if (noteLength > MAX_NOTE_BYTES) return null;
    if (battery > 10 && battery !== BATTERY_UNKNOWN) return null;

    const refBytes = hasRef(type) ? 4 : 0;
    if (data.length !== FIXED_HEADER_BYTES + refBytes + noteLength) return null;
    const refMsgId = refBytes ? readBits(r, 32) : null;

    let position: PacketPosition | null = null;
    if (accuracyClass === 0) {
      if (latRaw !== 0 || lonRaw !== 0) return null;
    } else {
      if (latRaw > MAX_LAT_RAW || lonRaw > MAX_LON_RAW) return null;
      position = { latE4: latRaw - LAT_OFFSET_E4, lonE4: lonRaw - LON_OFFSET_E4 };
    }

    const noteBytes = data.subarray(FIXED_HEADER_BYTES + refBytes);
    const note = new TextDecoder('utf-8', { fatal: true }).decode(noteBytes);
    return { version, type, hop, ttl, msgId, originMinutes, position, accuracyClass, statusFlags, people, battery, refMsgId, note };
  } catch {
    return null;
  }
}
