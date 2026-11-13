// ACK flow (Req 3). Pure logic: no DOM, no classes, no clock, no Math.random.
//
// Rescuer side: an SOS heard in Rescue Mode is answered once with an ACK packet whose `refMsgId` is the
// SOS id. The ACK has its own random msgId, so it travels through the normal relay scheduler
// (onHeard / due in ./relay) exactly like any other packet.
//
// Sender side: every SOS we originate is tracked as
//   sent -> relayed-unconfirmed -> acknowledged
// `acknowledged` is reachable ONLY through onAckHeard() with a valid ACK whose refMsgId matches a message
// we are tracking. Hearing our own packet echoed by a relay (hop > 0) is NOT delivery: it only moves
// sent -> relayed-unconfirmed. Product rule: never claim rescuers heard us without an ACK.
import { PACKET_VERSION, MAX_TTL, ORIGIN_EPOCH_MS, MAX_ORIGIN_MINUTES, BATTERY_UNKNOWN, type Packet } from '../packet';

// ---------- rescuer side ----------

export interface AckResponderState {
  /** SOS ids we already acknowledged, so a re-heard SOS (resend) does not trigger another ACK. */
  readonly acked: Set<number>;
}

export function createAckResponderState(): AckResponderState {
  return { acked: new Set() };
}

/** Build the ACK packet for `sos`. `ackMsgId` must be a fresh random 32-bit id (caller supplies the RNG). */
export function createAck(sos: Packet, ackMsgId: number, nowMs: number): Packet {
  const minutes = Math.floor((nowMs - ORIGIN_EPOCH_MS) / 60000);
  return {
    version: PACKET_VERSION,
    type: 'ACK',
    hop: 0,
    ttl: MAX_TTL,
    msgId: ackMsgId >>> 0,
    originMinutes: Math.min(MAX_ORIGIN_MINUTES, Math.max(0, Number.isFinite(minutes) ? minutes : 0)),
    position: null,
    accuracyClass: 0,
    // Keep the drill marker (bit 7) so a training SOS gets a training ACK.
    statusFlags: sos.statusFlags & 0x80,
    people: 0,
    battery: BATTERY_UNKNOWN,
    refMsgId: sos.msgId,
    note: '',
  };
}

/**
 * Rescuer entry point. Call for each freshly heard packet. Returns the ACK to transmit, or null when
 * not in Rescue Mode, the packet is not an SOS, or this SOS was already acknowledged by us.
 */
export function ackForHeard(
  state: AckResponderState,
  packet: Packet,
  rescueMode: boolean,
  nowMs: number,
  newMsgId: () => number,
): Packet | null {
  if (!rescueMode || packet.type !== 'SOS') return null;
  if (state.acked.has(packet.msgId)) return null;
  state.acked.add(packet.msgId);
  return createAck(packet, newMsgId(), nowMs);
}

// ---------- sender side ----------

export type DeliveryState = 'sent' | 'relayed-unconfirmed' | 'acknowledged';

export interface PendingMessage {
  readonly msgId: number;
  readonly sentAtMs: number;
  state: DeliveryState;
  /** Set only when state === 'acknowledged': when the first matching ACK was heard (Req 3.2). */
  ackedAtMs: number | null;
  /** Hop count carried by that first ACK (Req 3.2). */
  ackHop: number | null;
  /** Transmission rounds so far (the initial send counts as 1). */
  attempts: number;
  /** Next resend time, or null once acknowledged / out of attempts. */
  nextResendMs: number | null;
}

export interface SenderState {
  readonly messages: Map<number, PendingMessage>;
}

export const RESEND_BASE_MS = 60_000;
export const RESEND_MAX_MS = 5 * 60_000;
export const RESEND_MAX_ATTEMPTS = 8;

export function createSenderState(): SenderState {
  return { messages: new Map() };
}

/** Delay before the resend that follows `attempts` completed rounds: 60 s, 120 s, 240 s, then capped at 300 s. */
export function resendDelayMs(attempts: number): number {
  const n = Math.max(1, Math.floor(attempts));
  return Math.min(RESEND_MAX_MS, RESEND_BASE_MS * 2 ** (n - 1));
}

/** Start tracking an SOS we just transmitted. Re-tracking an existing id is a no-op. */
export function trackSent(state: SenderState, msgId: number, nowMs: number): PendingMessage {
  const existing = state.messages.get(msgId);
  if (existing) return existing;
  const m: PendingMessage = {
    msgId, sentAtMs: nowMs, state: 'sent', ackedAtMs: null, ackHop: null,
    attempts: 1, nextResendMs: nowMs + resendDelayMs(1),
  };
  state.messages.set(msgId, m);
  return m;
}

export type AckOutcome =
  | 'acknowledged' // first valid matching ACK
  | 'duplicate' // matching ACK for an already acknowledged message: harmless, nothing changes
  | 'unknown' // ACK for a message we are not tracking: ignored
  | 'not-an-ack';

/** Feed every heard packet that is an ACK. Only a matching ACK can move a message to 'acknowledged'. */
export function onAckHeard(state: SenderState, packet: Packet, nowMs: number): AckOutcome {
  if (packet.type !== 'ACK' || packet.refMsgId === null) return 'not-an-ack';
  const m = state.messages.get(packet.refMsgId);
  if (!m) return 'unknown';
  if (m.state === 'acknowledged') return 'duplicate';
  m.state = 'acknowledged';
  m.ackedAtMs = nowMs;
  m.ackHop = packet.hop;
  m.nextResendMs = null;
  return 'acknowledged';
}

/**
 * Feed every heard packet. If a relay echoes one of our own unconfirmed SOS back, note it as
 * 'relayed-unconfirmed' (someone nearby repeated it; still NOT delivered). Returns true on a change.
 */
export function onEchoHeard(state: SenderState, packet: Packet): boolean {
  if (packet.type === 'ACK') return false;
  const m = state.messages.get(packet.msgId);
  if (!m || m.state !== 'sent' || packet.hop === 0) return false;
  m.state = 'relayed-unconfirmed';
  return true;
}

/**
 * Messages that should be transmitted again now. Marks each as resent (attempts + 1, next deadline),
 * and stops scheduling after RESEND_MAX_ATTEMPTS. Acknowledged messages are never returned.
 * Note: resends reuse the same msgId (the ACK reference depends on it), so devices that already
 * relayed it will not relay it again (dedup); a resend mainly reaches listeners who were not in range before.
 */
export function dueResends(state: SenderState, nowMs: number): number[] {
  const out: number[] = [];
  for (const m of state.messages.values()) {
    if (m.state === 'acknowledged' || m.nextResendMs === null || m.nextResendMs > nowMs) continue;
    m.attempts += 1;
    m.nextResendMs = m.attempts >= RESEND_MAX_ATTEMPTS ? null : nowMs + resendDelayMs(m.attempts);
    out.push(m.msgId);
  }
  return out;
}

/** UI helper: true only when a matching ACK was actually heard (Req 3.3). */
export function isDelivered(state: SenderState, msgId: number): boolean {
  return state.messages.get(msgId)?.state === 'acknowledged';
}
