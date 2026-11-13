// Channel access: listen-before-talk + RX mute while transmitting. Pure state machine, no DOM,
// no clock, no Math.random. Callers pass `nowMs` and an RNG (`() => [0,1)`) explicitly.
//
//   due transmission -> channel idle for >= QUIET_MS and not transmitting/in guard? -> go
//                    -> otherwise defer(retryAtMs) with bounded exponential backoff + jitter
//
// RX mute: while we transmit (and for GUARD_MS after) decoded frames are our own echo and are dropped.
import type { Rng } from './relay';

/** Required channel silence before we may start transmitting (design.md: 600 ms). */
export const QUIET_MS = 600;
/** Mute tail after our own TX ends (speaker/room reverb must not be decoded). */
export const GUARD_MS = 300;
/** Backoff window for attempt 0; doubles per busy attempt. */
export const BACKOFF_BASE_MS = 600;
/** Attempts beyond this no longer grow the window. */
export const BACKOFF_MAX_EXPONENT = 4;
/** Upper bound of any single backoff delay (base * 2^max, plus nothing else). */
export const BACKOFF_MAX_MS = BACKOFF_BASE_MS * 2 ** BACKOFF_MAX_EXPONENT;

export interface ChannelState {
  /** True between txStart and txEnd. */
  txActive: boolean;
  /** When our last TX ended; -Infinity if never. */
  txEndedMs: number;
  /** Last time carrier/frame activity from others was observed; -Infinity if never. */
  lastActivityMs: number;
  /** Consecutive busy deferrals since the last successful start. */
  busyAttempts: number;
}

export type AccessDecision =
  | { readonly kind: 'go' }
  | { readonly kind: 'defer'; readonly retryAtMs: number };

export function createChannel(): ChannelState {
  return { txActive: false, txEndedMs: -Infinity, lastActivityMs: -Infinity, busyAttempts: 0 };
}

/** True while RX must be ignored: during TX and for GUARD_MS afterwards. */
export function isRxMuted(state: ChannelState, nowMs: number, guardMs = GUARD_MS): boolean {
  return state.txActive || nowMs < state.txEndedMs + guardMs;
}

/**
 * Record carrier/frame activity heard from others. Ignored while RX is muted so our own sound
 * never makes the channel look busy. Returns true if recorded.
 */
export function noteActivity(state: ChannelState, nowMs: number): boolean {
  if (isRxMuted(state, nowMs)) return false;
  state.lastActivityMs = Math.max(state.lastActivityMs, nowMs);
  return true;
}

/**
 * Gate a decoded frame: returns true if it should be delivered (not our own echo).
 * A delivered frame also counts as channel activity.
 */
export function acceptFrame(state: ChannelState, nowMs: number): boolean {
  if (isRxMuted(state, nowMs)) return false;
  state.lastActivityMs = Math.max(state.lastActivityMs, nowMs);
  return true;
}

export function txStart(state: ChannelState): void {
  state.txActive = true;
  state.busyAttempts = 0;
}

export function txEnd(state: ChannelState, nowMs: number): void {
  state.txActive = false;
  state.txEndedMs = nowMs;
}

/** Backoff delay for the given attempt: uniform in [1, base * 2^min(attempt, max)] ms. Always bounded. */
export function backoffDelayMs(attempt: number, rng: Rng): number {
  const exp = Math.min(Math.max(Math.floor(attempt), 0), BACKOFF_MAX_EXPONENT);
  const windowMs = BACKOFF_BASE_MS * 2 ** exp;
  const r = Math.min(Math.max(rng(), 0), 1 - Number.EPSILON);
  return 1 + Math.floor(r * windowMs);
}

/**
 * Decide whether a due transmission may start now. 'go' only when we are not transmitting, not in
 * the post-TX guard, and no activity was heard for QUIET_MS. Otherwise defer: the retry time is
 * never earlier than the moment the channel could become idle, plus a bounded random backoff.
 * Does not call txStart; the caller does that when it actually begins playing.
 */
export function requestTx(
  state: ChannelState,
  nowMs: number,
  rng: Rng,
  quietMs = QUIET_MS,
  guardMs = GUARD_MS,
): AccessDecision {
  const idleSinceMs = Math.max(state.lastActivityMs + quietMs, state.txEndedMs + guardMs);
  if (!state.txActive && nowMs >= idleSinceMs) {
    state.busyAttempts = 0;
    return { kind: 'go' };
  }
  const delayMs = backoffDelayMs(state.busyAttempts, rng);
  state.busyAttempts += 1;
  // While txActive the end time is unknown: just back off from now.
  const earliestMs = state.txActive ? nowMs : Math.max(idleSinceMs, nowMs);
  return { kind: 'defer', retryAtMs: earliestMs + delayMs };
}
