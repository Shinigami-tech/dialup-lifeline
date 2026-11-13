// UI-facing message shape. Wire encoding is the compact binary packet in src/packet
// (.kiro/specs/mesh-relay); this module only maps Msg <-> Packet.
import {
  BATTERY_UNKNOWN, MAX_HOP, MAX_NOTE_BYTES, MAX_ORIGIN_MINUTES, MAX_TTL, ORIGIN_EPOCH_MS, PACKET_VERSION,
  decodePacket, encodePacket, type Packet,
} from '../packet';

export const FLAGS = ['injured', 'trapped', 'water', 'medicine', 'fire', 'children', 'elderly'] as const;
export type Flag = (typeof FLAGS)[number];
export type Kind = 'SOS' | 'OK' | 'ACK' | 'INFO';

export interface Msg {
  kind: Kind;
  id: string;
  /** For ACK / INFO: the id of the SOS this refers to. */
  ref?: string;
  flags: Flag[];
  people: number;
  lat?: number;
  lon?: number;
  note?: string;
  /** true when sent in Drill (training) mode. */
  drill?: boolean;
  /** Hop count (incremented by relays). */
  hop: number;
  /** Local receive / create time in ms. */
  time: number;
}

/** statusFlags bit i = FLAGS[i]; bit 7 marks a Drill (training) message. */
const DRILL_BIT = 7;
/** Msg carries no TTL, so every message we originate or relay uses the maximum. */
const DEFAULT_TTL = MAX_TTL;
/** Accuracy class stamped on any GPS fix (the UI does not track accuracy yet). */
const FIX_ACCURACY_CLASS = 1;

/** 32-bit random message id as 8 lowercase hex characters. */
export function newId(): string {
  const a = new Uint8Array(4);
  crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function idToNumber(id: string): number {
  if (!/^[0-9a-f]{8}$/.test(id)) throw new RangeError(`message id must be 8 hex chars: ${id}`);
  return parseInt(id, 16);
}

function numberToId(n: number): string {
  return n.toString(16).padStart(8, '0');
}

function clampInt(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.trunc(Number.isFinite(v) ? v : min)));
}

/** Truncate to at most `maxBytes` UTF-8 bytes without splitting a code point. */
function truncateUtf8(s: string, maxBytes: number): string {
  const enc = new TextEncoder();
  let out = '', used = 0;
  for (const ch of s) {
    const n = enc.encode(ch).length;
    if (used + n > maxBytes) break;
    out += ch; used += n;
  }
  return out;
}

export function msgToPacket(m: Msg): Packet {
  const hasFix = m.lat !== undefined && m.lon !== undefined && Number.isFinite(m.lat) && Number.isFinite(m.lon);
  let statusFlags = 0;
  for (const f of m.flags) statusFlags |= 1 << FLAGS.indexOf(f);
  if (m.drill) statusFlags |= 1 << DRILL_BIT;
  const refKind = m.kind === 'ACK' || m.kind === 'INFO';
  return {
    version: PACKET_VERSION,
    type: m.kind,
    hop: clampInt(m.hop, 0, MAX_HOP),
    ttl: DEFAULT_TTL,
    msgId: idToNumber(m.id),
    originMinutes: clampInt(Math.floor((m.time - ORIGIN_EPOCH_MS) / 60000), 0, MAX_ORIGIN_MINUTES),
    position: hasFix
      ? { latE4: clampInt(Math.round(m.lat! * 1e4), -900000, 900000), lonE4: clampInt(Math.round(m.lon! * 1e4), -1800000, 1800000) }
      : null,
    accuracyClass: hasFix ? FIX_ACCURACY_CLASS : 0,
    statusFlags,
    people: clampInt(m.people, 0, 15),
    battery: BATTERY_UNKNOWN,
    // ACK/INFO must reference a message; an unset ref is sent as id 0.
    refMsgId: refKind ? (m.ref !== undefined ? idToNumber(m.ref) : 0) : null,
    note: truncateUtf8(m.note ?? '', MAX_NOTE_BYTES),
  };
}

export function packetToMsg(p: Packet, nowMs: number = Date.now()): Msg {
  return {
    kind: p.type,
    drill: (p.statusFlags & (1 << DRILL_BIT)) !== 0,
    id: numberToId(p.msgId),
    ref: p.refMsgId === null ? undefined : numberToId(p.refMsgId),
    flags: FLAGS.filter((_, i) => (p.statusFlags & (1 << i)) !== 0),
    people: p.people,
    lat: p.position ? p.position.latE4 / 1e4 : undefined,
    lon: p.position ? p.position.lonE4 / 1e4 : undefined,
    hop: p.hop,
    note: p.note || undefined,
    time: nowMs,
  };
}

/** Binary encoding (see src/packet). Throws RangeError if `m.id` / `m.ref` are not 8 hex chars. */
export function encodeMsg(m: Msg): Uint8Array {
  return encodePacket(msgToPacket(m));
}

/** Returns null for anything that is not exactly one valid packet. */
export function decodeMsg(b: Uint8Array): Msg | null {
  const p = decodePacket(b);
  return p ? packetToMsg(p) : null;
}

/** Urgency score used by Rescue Mode: trapped > injured > medical > others, then people, then age. */
export function urgency(m: Msg, now = Date.now()): number {
  if (m.kind !== 'SOS') return -1;
  let s = 0;
  if (m.flags.includes('trapped')) s += 1000;
  if (m.flags.includes('injured')) s += 500;
  if (m.flags.includes('medicine')) s += 250;
  if (m.flags.includes('fire')) s += 400;
  if (m.flags.includes('children') || m.flags.includes('elderly')) s += 100;
  s += Math.min(15, m.people) * 10;
  s += Math.min(60, (now - m.time) / 60000); // older unanswered cases drift up
  return s;
}

/** Great-circle distance in metres and initial bearing in degrees. */
export function distanceBearing(lat1: number, lon1: number, lat2: number, lon2: number): { m: number; deg: number } {
  const R = 6371000, toRad = Math.PI / 180;
  const φ1 = lat1 * toRad, φ2 = lat2 * toRad, dφ = (lat2 - lat1) * toRad, dλ = (lon2 - lon1) * toRad;
  const a = Math.sin(dφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2;
  const m = 2 * R * Math.asin(Math.sqrt(a));
  const y = Math.sin(dλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(dλ);
  return { m, deg: ((Math.atan2(y, x) / toRad) + 360) % 360 };
}
