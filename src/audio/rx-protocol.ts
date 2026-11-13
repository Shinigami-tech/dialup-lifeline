/**
 * Receiver core + worklet message protocol.
 *
 * DOM-free: everything the AudioWorklet does lives here so it can be unit
 * tested in Node. The worklet (rx-worklet.ts) is a thin shell around
 * createReceiverCore(); the main thread uses dispatchReceiverMessage().
 *
 * Req 2.1, 2.4
 */

import { createDemodulator, type DemodulatorStats } from '../modem/afsk-rx';
import type { ModemMode } from '../modem/modes';

/** Diagnostics snapshot sent to the main thread. */
export interface ReceiverDiagnostics extends DemodulatorStats {
  /** RMS level of the most recent audio block, 0..1. */
  levelRms: number;
  /** Peak absolute level of the most recent audio block, 0..1. */
  levelPeak: number;
  /** True while RX is muted (own transmitter active). */
  muted: boolean;
}

/** Worklet -> main thread. */
export type ReceiverOutMessage =
  | { type: 'frame'; payload: Uint8Array }
  | { type: 'diagnostics'; diagnostics: ReceiverDiagnostics };

/** Main thread -> worklet. */
export type ReceiverInMessage = { type: 'mute'; muted: boolean };

export interface ReceiverCoreOptions {
  sampleRateHz: number;
  /** Modem mode ('standard' | 'robust'). Default 'standard'. */
  mode?: ModemMode;
  /** How often to post diagnostics while running. Default 250 ms. */
  diagnosticsIntervalMs?: number;
}

export interface ReceiverCore {
  /** Process one block of mono PCM; returns messages to post. */
  process(block: Float32Array): ReceiverOutMessage[];
  /** Apply a message received from the main thread. */
  handleMessage(msg: ReceiverInMessage): void;
}

/** Compute RMS and peak of a block. */
export function measureLevel(block: Float32Array): { rms: number; peak: number } {
  if (block.length === 0) return { rms: 0, peak: 0 };
  let sumSq = 0;
  let peak = 0;
  for (let i = 0; i < block.length; i++) {
    const v = block[i] ?? 0;
    sumSq += v * v;
    const a = Math.abs(v);
    if (a > peak) peak = a;
  }
  return { rms: Math.sqrt(sumSq / block.length), peak };
}

export function createReceiverCore(opts: ReceiverCoreOptions): ReceiverCore {
  const { sampleRateHz, diagnosticsIntervalMs = 250, mode } = opts;
  const demod = createDemodulator({ sampleRateHz, mode });
  const diagnosticsIntervalSamples = Math.round((sampleRateHz * diagnosticsIntervalMs) / 1000);
  let samplesSinceDiagnostics = 0;
  let muted = false;
  let lastCorrupted = 0;

  function snapshot(block: Float32Array): ReceiverOutMessage {
    const { rms, peak } = measureLevel(block);
    return {
      type: 'diagnostics',
      diagnostics: { ...demod.stats, levelRms: rms, levelPeak: peak, muted },
    };
  }

  return {
    handleMessage(msg) {
      if (msg.type === 'mute') muted = msg.muted;
    },
    process(block) {
      const out: ReceiverOutMessage[] = [];
      samplesSinceDiagnostics += block.length;
      let urgent = false;
      if (!muted) {
        for (const payload of demod.push(block)) {
          out.push({ type: 'frame', payload });
          urgent = true;
        }
        if (demod.stats.corruptedFrames !== lastCorrupted) {
          lastCorrupted = demod.stats.corruptedFrames;
          urgent = true;
        }
      }
      if (urgent || samplesSinceDiagnostics >= diagnosticsIntervalSamples) {
        samplesSinceDiagnostics = 0;
        out.push(snapshot(block));
      }
      return out;
    },
  };
}

export interface ReceiverHandlers {
  onFrame(payload: Uint8Array): void;
  onDiagnostics(diagnostics: ReceiverDiagnostics): void;
}

/** Route a worklet message to the right handler (main thread side). */
export function dispatchReceiverMessage(msg: ReceiverOutMessage, handlers: ReceiverHandlers): void {
  if (msg.type === 'frame') handlers.onFrame(msg.payload);
  else if (msg.type === 'diagnostics') handlers.onDiagnostics(msg.diagnostics);
}
