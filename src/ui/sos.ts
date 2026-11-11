// Interim message format used by the UI.
// The compact 17-byte binary packet is specified in .kiro/specs/mesh-relay (Kiro task) and will replace this
// encoder without touching the UI, because the UI only depends on the `Msg` shape below.
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

const KINDS: Kind[] = ['SOS', 'OK', 'ACK', 'INFO'];

export function newId(): string {
  const a = new Uint8Array(3);
  crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function encodeMsg(m: Msg): Uint8Array {
  const parts = [
    m.kind + (m.drill ? '*' : ''),
    m.id,
    m.ref ?? '',
    m.flags.map((f) => FLAGS.indexOf(f)).join(''),
    String(Math.min(15, Math.max(0, m.people))),
    m.lat !== undefined && m.lon !== undefined ? `${m.lat.toFixed(4)},${m.lon.toFixed(4)}` : '',
    String(m.hop),
    (m.note ?? '').replace(/\|/g, '/').slice(0, 40),
  ];
  return new TextEncoder().encode(parts.join('|'));
}

export function decodeMsg(b: Uint8Array): Msg | null {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(b);
  } catch {
    return null;
  }
  const p = text.split('|');
  if (p.length < 8) return null;
  const head = p[0] ?? '';
  const drill = head.endsWith('*');
  const kind = (drill ? head.slice(0, -1) : head) as Kind;
  if (!KINDS.includes(kind)) return null;
  const [lat, lon] = (p[5] ?? '').split(',').map(Number);
  return {
    kind,
    drill,
    id: p[1] ?? '',
    ref: p[2] || undefined,
    flags: [...(p[3] ?? '')].map((c) => FLAGS[Number(c)]).filter((f): f is Flag => Boolean(f)),
    people: Number(p[4]) || 0,
    lat: Number.isFinite(lat) && p[5] ? lat : undefined,
    lon: Number.isFinite(lon) && p[5] ? lon : undefined,
    hop: Number(p[6]) || 0,
    note: p.slice(7).join('|') || undefined,
    time: Date.now(),
  };
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
