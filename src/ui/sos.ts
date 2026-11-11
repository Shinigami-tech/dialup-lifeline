// Interim SOS message format for the UI prototype.
// The compact binary packet (17 bytes) is specified in .kiro/specs/mesh-relay and replaces this.
export const FLAGS = ['injured', 'trapped', 'water', 'medicine', 'fire', 'children', 'elderly'] as const;
export type Flag = (typeof FLAGS)[number];

export interface Sos {
  kind: 'SOS' | 'OK';
  id: string;
  flags: Flag[];
  people: number;
  lat?: number;
  lon?: number;
  note?: string;
  time: number;
}

export function encodeSos(s: Sos): Uint8Array {
  const parts = [
    s.kind,
    s.id,
    s.flags.map((f) => FLAGS.indexOf(f)).join(''),
    String(s.people),
    s.lat !== undefined && s.lon !== undefined ? `${s.lat.toFixed(4)},${s.lon.toFixed(4)}` : '',
    (s.note ?? '').slice(0, 40),
  ];
  return new TextEncoder().encode(parts.join('|'));
}

export function decodeSos(b: Uint8Array): Sos | null {
  const p = new TextDecoder().decode(b).split('|');
  if (p.length < 6 || (p[0] !== 'SOS' && p[0] !== 'OK')) return null;
  const [lat, lon] = (p[4] ?? '').split(',').map(Number);
  return {
    kind: p[0] as 'SOS' | 'OK',
    id: p[1] ?? '',
    flags: [...(p[2] ?? '')].map((c) => FLAGS[Number(c)]).filter(Boolean) as Flag[],
    people: Number(p[3]) || 0,
    lat: Number.isFinite(lat) ? lat : undefined,
    lon: Number.isFinite(lon) ? lon : undefined,
    note: p[5] || undefined,
    time: Date.now(),
  };
}
