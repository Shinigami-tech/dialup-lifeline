/** Tests for receiver core + diagnostics counters. Req 2.1, 2.4 */
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { modulate } from '../../src/modem/afsk-tx';
import { createDemodulator } from '../../src/modem/afsk-rx';
import { frame as hdlcFrame } from '../../src/modem/hdlc';
import { nrziEncode } from '../../src/modem/nrzi';
import {
  createReceiverCore,
  dispatchReceiverMessage,
  measureLevel,
  type ReceiverDiagnostics,
  type ReceiverOutMessage,
} from '../../src/audio/rx-protocol';

const sampleRateHz = 44100;

/** Synthesize AFSK for an HDLC bit stream with one bit flipped (bad CRC). */
function corruptedFrameAudio(payload: Uint8Array): Float32Array {
  const bits = hdlcFrame(payload, 4);
  bits[50] = (bits[50] ?? 0) ^ 1;
  const levels = nrziEncode(bits);
  const samplesPerBit = sampleRateHz / 1200;
  const out = new Float32Array(Math.round(levels.length * samplesPerBit));
  let phase = 0;
  for (let b = 0; b < levels.length; b++) {
    const inc = (2 * Math.PI * (levels[b] === 1 ? 1200 : 2200)) / sampleRateHz;
    const end = Math.min(Math.round((b + 1) * samplesPerBit), out.length);
    for (let s = Math.round(b * samplesPerBit); s < end; s++) {
      out[s] = Math.sin(phase) * 0.8;
      phase += inc;
    }
  }
  return out;
}

function feedInBlocks(core: ReturnType<typeof createReceiverCore>, samples: Float32Array): ReceiverOutMessage[] {
  const msgs: ReceiverOutMessage[] = [];
  for (let o = 0; o < samples.length; o += 128) msgs.push(...core.process(samples.subarray(o, o + 128)));
  return msgs;
}

const lastDiagnostics = (msgs: ReceiverOutMessage[]): ReceiverDiagnostics => {
  const d = msgs.filter((m) => m.type === 'diagnostics').at(-1);
  if (!d || d.type !== 'diagnostics') throw new Error('no diagnostics');
  return d.diagnostics;
};

describe('demodulator counters', () => {
  it('increments corruptedFrames for a bad-CRC frame and delivers no payload', () => {
    const demod = createDemodulator({ sampleRateHz });
    const frames = demod.push(corruptedFrameAudio(new Uint8Array([0xca, 0xfe, 0xba, 0xbe])));
    expect(frames).toHaveLength(0);
    expect(demod.stats.corruptedFrames).toBe(1);
    expect(demod.stats.decodedFrames).toBe(0);
  });

  it('delivers a valid frame without touching corruptedFrames', () => {
    const demod = createDemodulator({ sampleRateHz });
    const frames = demod.push(modulate(new Uint8Array([1, 2, 3]), { sampleRateHz }));
    expect(frames).toHaveLength(1);
    expect(demod.stats.decodedFrames).toBe(1);
    expect(demod.stats.corruptedFrames).toBe(0);
  });

  it('resets signal state after 2 s of silence but keeps counters', () => {
    const demod = createDemodulator({ sampleRateHz });
    demod.push(modulate(new Uint8Array([9, 9]), { sampleRateHz }));
    expect(demod.stats.silenceResets).toBe(0);
    demod.push(new Float32Array(Math.round(sampleRateHz * 2.5)));
    expect(demod.stats.silenceResets).toBe(1);
    expect(demod.stats.decodedFrames).toBe(1);
    // Still decodes afterwards.
    expect(demod.push(modulate(new Uint8Array([7]), { sampleRateHz }))).toHaveLength(1);
  });
});

describe('receiver core', () => {
  it('posts a frame message and diagnostics for a valid frame', () => {
    const core = createReceiverCore({ sampleRateHz });
    const msgs = feedInBlocks(core, modulate(new Uint8Array([0x10, 0x20]), { sampleRateHz }));
    const frames = msgs.filter((m) => m.type === 'frame');
    expect(frames).toHaveLength(1);
    expect(Array.from((frames[0] as { payload: Uint8Array }).payload)).toEqual([0x10, 0x20]);
    expect(lastDiagnostics(msgs).decodedFrames).toBe(1);
  });

  it('reports corruptedFrames in diagnostics', () => {
    const core = createReceiverCore({ sampleRateHz });
    const msgs = feedInBlocks(core, corruptedFrameAudio(new Uint8Array([1, 2, 3, 4])));
    expect(msgs.some((m) => m.type === 'frame')).toBe(false);
    expect(lastDiagnostics(msgs).corruptedFrames).toBe(1);
  });

  it('ignores audio while muted', () => {
    const core = createReceiverCore({ sampleRateHz });
    core.handleMessage({ type: 'mute', muted: true });
    const msgs = feedInBlocks(core, new Float32Array(sampleRateHz)); // 1 s, covers the diagnostics interval
    msgs.push(...feedInBlocks(core, modulate(new Uint8Array([5]), { sampleRateHz })));
    expect(msgs.some((m) => m.type === 'frame')).toBe(false);
    expect(lastDiagnostics(msgs).muted).toBe(true);
  });

  it('dispatches messages to handlers', () => {
    const seen: string[] = [];
    const handlers = {
      onFrame: () => seen.push('frame'),
      onDiagnostics: () => seen.push('diag'),
    };
    dispatchReceiverMessage({ type: 'frame', payload: new Uint8Array() }, handlers);
    dispatchReceiverMessage(
      { type: 'diagnostics', diagnostics: lastDiagnostics([{ type: 'diagnostics', diagnostics: {} as ReceiverDiagnostics }]) },
      handlers,
    );
    expect(seen).toEqual(['frame', 'diag']);
  });

  it('measureLevel: peak >= rms for any block (property)', () => {
    fc.assert(
      fc.property(fc.float32Array({ minLength: 1, maxLength: 256, noNaN: true, min: -1, max: 1 }), (block) => {
        const { rms, peak } = measureLevel(block);
        return peak + 1e-6 >= rms;
      }),
    );
  });
});
