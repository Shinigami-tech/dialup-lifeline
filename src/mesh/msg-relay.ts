// Glue between the UI Msg shape and the mesh relay pieces. Pure: no DOM, no clock, no Math.random.
// Callers pass `nowMs` / `rng` / `sleep` explicitly. Persistence goes through a SeenBackend port.
//
//   heard(Msg) -> dedup by msg id -> schedule rebroadcast (hop + 1, random delay) or suppress
//   takeDue()  -> Msg copies whose timer fired (hop already incremented)
//   awaitClear -> listen-before-talk loop around the channel state machine
import { msgToPacket, packetToMsg, type Msg } from '../ui/sos';
import { markSeen, type SeenBackend } from './dedup';
import { createChannel, requestTx, type ChannelState } from './channel';
import { createRelayState, due, onHeard, type HeardOutcome, type RelayState, type Rng } from './relay';

export interface MsgRelay {
  readonly state: RelayState;
  readonly backend: SeenBackend | null;
}

export interface HeardMsgResult {
  /** First time this id was heard (within 24 h). */
  readonly fresh: boolean;
  readonly outcome: HeardOutcome;
}

export function createMsgRelay(relayEnabled = true, backend: SeenBackend | null = null): MsgRelay {
  return { state: createRelayState(relayEnabled), backend };
}

export function setRelayEnabled(r: MsgRelay, enabled: boolean): void {
  r.state.relayEnabled = enabled;
  // Turning relaying off also drops anything still waiting for its timer.
  if (!enabled) r.state.pending.clear();
}

function idToNumber(id: string): number {
  return parseInt(id, 16);
}

/** Merge persisted ids (from IndexedDB) into the in-memory seen map. Never removes live entries. */
export async function hydrateMsgRelay(r: MsgRelay, nowMs: number): Promise<void> {
  if (!r.backend) return;
  const entries = await r.backend.loadAll();
  const expired: number[] = [];
  for (const e of entries) {
    if (nowMs - e.firstSeenMs > 24 * 60 * 60 * 1000) expired.push(e.msgId);
    else if (!r.state.seen.has(e.msgId)) r.state.seen.set(e.msgId, e.firstSeenMs);
  }
  if (expired.length > 0) await r.backend.remove(expired);
}

function persist(r: MsgRelay, msgId: number, nowMs: number): void {
  // Fire and forget: a storage failure must never block the radio path.
  r.backend?.put({ msgId, firstSeenMs: nowMs }).catch(() => undefined);
}

/** Record a message we originate or already relayed, so echoes of it are never relayed again. */
export function markOwn(r: MsgRelay, id: string, nowMs: number): void {
  const n = idToNumber(id);
  if (markSeen(r.state.seen, n, nowMs)) persist(r, n, nowMs);
}

/**
 * A decoded message was heard from someone else. Kinds SOS, OK, ACK and INFO are all relayed alike.
 * The first hearing with hop < 7 schedules a rebroadcast (hop + 1); hearing the same id again
 * before it fires cancels it.
 */
export function heardMsg(r: MsgRelay, m: Msg, nowMs: number, rng: Rng): HeardMsgResult {
  const res = onHeard(r.state, msgToPacket(m), nowMs, rng);
  if (res.fresh) persist(r, idToNumber(m.id), nowMs);
  return { fresh: res.fresh, outcome: res.outcome };
}

/** Rebroadcasts whose delay has elapsed, earliest first. Each is a Msg with hop already incremented. */
export function takeDueMsgs(r: MsgRelay, nowMs: number): Msg[] {
  return due(r.state, nowMs).map((p) => packetToMsg(p, nowMs));
}

export function relayLogLine(m: Msg): string {
  return `RELAY #${m.id} · HOP ${m.hop}`;
}

export interface ClearOptions {
  readonly channel: ChannelState;
  readonly nowMs: () => number;
  readonly sleepMs: (ms: number) => Promise<void>;
  readonly rng: Rng;
  /** Give up after this many deferrals. */
  readonly maxAttempts?: number;
}

export const DEFAULT_MAX_ATTEMPTS = 8;

/**
 * Listen-before-talk: resolves true when the channel is clear and we may transmit, or false after
 * `maxAttempts` deferrals. The caller decides what to do on false (relays drop, our own SOS goes anyway).
 */
export async function awaitClear(o: ClearOptions): Promise<boolean> {
  const max = o.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  for (let i = 0; i <= max; i++) {
    const d = requestTx(o.channel, o.nowMs(), o.rng);
    if (d.kind === 'go') return true;
    if (i === max) break;
    await o.sleepMs(Math.max(1, d.retryAtMs - o.nowMs()));
  }
  return false;
}

export { createChannel };
