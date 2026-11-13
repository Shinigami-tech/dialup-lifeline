import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  BACKOFF_MAX_MS,
  GUARD_MS,
  QUIET_MS,
  acceptFrame,
  backoffDelayMs,
  createChannel,
  isRxMuted,
  noteActivity,
  requestTx,
  txEnd,
  txStart,
} from '../../src/mesh/channel';

const rngArb = fc.double({ min: 0, max: 1, noNaN: true, maxExcluded: true });
const tArb = fc.integer({ min: 0, max: 1_000_000 });

describe('channel access (Req 2.4)', () => {
  it('idle channel: go immediately', () => {
    expect(requestTx(createChannel(), 0, () => 0.5).kind).toBe('go');
  });

  it('never transmits while busy; defers to at least idle time; backoff bounded', () => {
    fc.assert(
      fc.property(tArb, fc.integer({ min: 0, max: QUIET_MS - 1 }), rngArb, (act, dt, r) => {
        const ch = createChannel();
        noteActivity(ch, act);
        const now = act + dt;
        const d = requestTx(ch, now, () => r);
        expect(d.kind).toBe('defer');
        if (d.kind === 'defer') {
          expect(d.retryAtMs).toBeGreaterThanOrEqual(act + QUIET_MS);
          expect(d.retryAtMs - (act + QUIET_MS)).toBeLessThanOrEqual(BACKOFF_MAX_MS);
        }
      }),
    );
  });

  it('goes once the quiet period has elapsed', () => {
    fc.assert(
      fc.property(tArb, fc.integer({ min: 0, max: 100_000 }), (act, extra) => {
        const ch = createChannel();
        noteActivity(ch, act);
        expect(requestTx(ch, act + QUIET_MS + extra, () => 0).kind).toBe('go');
      }),
    );
  });

  it('retrying at retryAtMs with no new activity eventually goes', () => {
    fc.assert(
      fc.property(tArb, fc.array(rngArb, { minLength: 1, maxLength: 50 }), (act, rs) => {
        const ch = createChannel();
        noteActivity(ch, act);
        let now = act;
        let went = false;
        for (let i = 0; i < 50 && !went; i++) {
          const d = requestTx(ch, now, () => rs[i % rs.length]!);
          if (d.kind === 'go') went = true;
          else now = d.retryAtMs;
        }
        expect(went).toBe(true);
      }),
    );
  });

  it('backoff delay is always in [1, BACKOFF_MAX_MS] for any attempt', () => {
    fc.assert(
      fc.property(fc.integer({ min: -5, max: 1000 }), rngArb, (n, r) => {
        const d = backoffDelayMs(n, () => r);
        expect(d).toBeGreaterThanOrEqual(1);
        expect(d).toBeLessThanOrEqual(BACKOFF_MAX_MS);
      }),
    );
  });

  it('never transmits during own TX or guard tail', () => {
    fc.assert(
      fc.property(tArb, fc.integer({ min: 0, max: GUARD_MS - 1 }), (t0, dt) => {
        const ch = createChannel();
        txStart(ch);
        expect(requestTx(ch, t0, () => 0).kind).toBe('defer');
        txEnd(ch, t0 + 1000);
        expect(requestTx(ch, t0 + 1000 + dt, () => 0).kind).toBe('defer');
      }),
    );
  });

  it('frames during TX and guard are dropped; after guard they pass', () => {
    fc.assert(
      fc.property(
        tArb,
        fc.integer({ min: 0, max: 10_000 }),
        fc.integer({ min: 0, max: GUARD_MS - 1 }),
        fc.integer({ min: 0, max: 10_000 }),
        (t0, txLen, inGuard, after) => {
          const ch = createChannel();
          txStart(ch);
          expect(acceptFrame(ch, t0 + txLen)).toBe(false);
          expect(noteActivity(ch, t0)).toBe(false);
          txEnd(ch, t0 + txLen);
          expect(acceptFrame(ch, t0 + txLen + inGuard)).toBe(false);
          expect(isRxMuted(ch, t0 + txLen + GUARD_MS + after)).toBe(false);
          expect(acceptFrame(ch, t0 + txLen + GUARD_MS + after)).toBe(true);
        },
      ),
    );
  });

  it('own echo never makes the channel look busy', () => {
    const ch = createChannel();
    txStart(ch);
    noteActivity(ch, 100);
    txEnd(ch, 200);
    expect(requestTx(ch, 200 + GUARD_MS, () => 0).kind).toBe('go');
  });
});
