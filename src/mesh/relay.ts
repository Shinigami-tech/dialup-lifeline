// Relay scheduler: gossip with suppression. Pure state machine, no DOM, no clock, no Math.random.
// Callers pass `nowMs` and an RNG (`() => [0,1)`) explicitly so behaviour is deterministic in tests.
//
//   heard -> (unseen & hop < ttl) -> scheduled(delay 2-8 s) -> [same id heard again?] -> suppressed | due
//
// Packet semantics: `ttl` is the maximum number of relay hops and `hop` counts hops so far, so a relay
// is allowed while hop < ttl and the relayed copy carries hop + 1 (ttl is unchanged; the remaining
// budget is ttl - hop).
import type { Packet } from '../packet';
import { SEEN_TTL_MS, createSeenMap, markSeen, pruneExpired, type SeenMap } from './dedup';

export const RELAY_DELAY_MIN_MS = 2000;
export const RELAY_DELAY_MAX_MS = 8000;

export type Rng = () => number;

export interface PendingRelay {
  /** The packet to transmit (already hop + 1). */
  readonly packet: Packet;
  readonly dueMs: number;
}

export interface RelayState {
  readonly seen: SeenMap;
  readonly pending: Map<number, PendingRelay>;
  /** Requirement 2.5: when false the device only listens. */
  relayEnabled: boolean;
}

export type HeardOutcome =
  | 'scheduled'
  | 'suppressed' // duplicate heard while our relay was pending: cancelled
  | 'duplicate' // already seen, nothing pending
  | 'ttl-exhausted'
  | 'relay-disabled';

export interface HeardResult {
  /** True if the id had not been seen before (caller should store/display it). */
  readonly fresh: boolean;
  readonly outcome: HeardOutcome;
  /** Set only when outcome is 'scheduled'. */
  readonly dueMs?: number;
}

export function createRelayState(relayEnabled = true): RelayState {
  return { seen: createSeenMap(), pending: new Map(), relayEnabled };
}

/** Uniform integer delay in [RELAY_DELAY_MIN_MS, RELAY_DELAY_MAX_MS). Clamped against misbehaving RNGs. */
export function randomRelayDelayMs(rng: Rng): number {
  const r = Math.min(Math.max(rng(), 0), 1 - Number.EPSILON);
  return RELAY_DELAY_MIN_MS + Math.floor(r * (RELAY_DELAY_MAX_MS - RELAY_DELAY_MIN_MS));
}

export function canRelay(p: Packet): boolean {
  return p.hop < p.ttl;
}

/** The copy to rebroadcast: hop + 1, everything else identical. */
export function toRelayed(p: Packet): Packet {
  return { ...p, hop: p.hop + 1 };
}

/** Process a validated, decoded packet that was just heard. */
export function onHeard(state: RelayState, packet: Packet, nowMs: number, rng: Rng): HeardResult {
  const fresh = markSeen(state.seen, packet.msgId, nowMs);
  if (!fresh) {
    // Same id heard again (from another relay): cancel our pending rebroadcast, if any.
    const cancelled = state.pending.delete(packet.msgId);
    return { fresh: false, outcome: cancelled ? 'suppressed' : 'duplicate' };
  }
  if (!state.relayEnabled) return { fresh, outcome: 'relay-disabled' };
  if (!canRelay(packet)) return { fresh, outcome: 'ttl-exhausted' };
  const dueMs = nowMs + randomRelayDelayMs(rng);
  state.pending.set(packet.msgId, { packet: toRelayed(packet), dueMs });
  return { fresh, outcome: 'scheduled', dueMs };
}

/** Remove and return all relays whose timer has fired, earliest first. Each id is returned at most once. */
export function due(state: RelayState, nowMs: number): Packet[] {
  const ready: PendingRelay[] = [];
  for (const entry of state.pending.values()) {
    if (entry.dueMs <= nowMs) ready.push(entry);
  }
  ready.sort((a, b) => a.dueMs - b.dueMs);
  for (const e of ready) state.pending.delete(e.packet.msgId);
  return ready.map((e) => e.packet);
}

/** Earliest pending deadline, or null. Lets the caller arm a single timer. */
export function nextDueMs(state: RelayState): number | null {
  let min: number | null = null;
  for (const e of state.pending.values()) if (min === null || e.dueMs < min) min = e.dueMs;
  return min;
}

/** Housekeeping: drop expired seen entries (never touches pending relays). */
export function pruneRelayState(state: RelayState, nowMs: number, ttlMs = SEEN_TTL_MS): void {
  pruneExpired(state.seen, nowMs, ttlMs);
}
