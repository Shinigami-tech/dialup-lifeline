// Web Audio glue: speaker scheduler + microphone capture worklet.
import { modulate } from '../modem/afsk-tx';
import { createDemodulator, type Demodulator } from '../modem/afsk-rx';
import { acceptFrame, createChannel, noteActivity, txEnd, txStart } from '../mesh/channel';

/** Shared half-duplex channel state (listen-before-talk + own-TX mute). Clock: performance.now(). */
export const channel = createChannel();
const CARRIER_RMS = 0.02;

let ctx: AudioContext | null = null;
export function audioContext(): AudioContext {
  ctx ??= new AudioContext({ latencyHint: 'interactive' });
  return ctx;
}

/** Play a payload as Bell 202 AFSK. Resolves when the sound has finished. */
export async function transmit(payload: Uint8Array, onSamples?: (s: Float32Array) => void): Promise<void> {
  const ac = audioContext();
  await ac.resume();
  const samples = modulate(payload, { sampleRateHz: ac.sampleRate, amplitude: 0.9 });
  onSamples?.(samples);
  const buf = ac.createBuffer(1, samples.length, ac.sampleRate);
  buf.copyToChannel(new Float32Array(samples), 0);
  const src = ac.createBufferSource();
  src.buffer = buf;
  src.connect(ac.destination);
  txStart(channel);
  try {
    await new Promise<void>((resolve) => {
      src.onended = () => resolve();
      src.start();
    });
  } finally {
    txEnd(channel, performance.now());
  }
}

const WORKLET = `
class Tap extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) this.port.postMessage(ch.slice(0));
    return true;
  }
}
registerProcessor('lifeline-tap', Tap);
`;

export interface Listener {
  stop(): void;
  demod: Demodulator;
  /** true while our own transmitter is active (RX muted). */
  muted: boolean;
}

/** Start listening on the microphone. Calls onFrame for every CRC-valid frame. */
export async function listen(
  onFrame: (payload: Uint8Array) => void,
  onLevel?: (samples: Float32Array) => void,
): Promise<Listener> {
  const ac = audioContext();
  await ac.resume();
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  });
  const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
  await ac.audioWorklet.addModule(url);
  const source = ac.createMediaStreamSource(stream);
  const tap = new AudioWorkletNode(ac, 'lifeline-tap');
  source.connect(tap);
  const demod = createDemodulator({ sampleRateHz: ac.sampleRate });
  const listener: Listener = {
    demod,
    muted: false,
    stop() {
      tap.disconnect();
      source.disconnect();
      stream.getTracks().forEach((t) => t.stop());
    },
  };
  tap.port.onmessage = (e: MessageEvent<Float32Array>) => {
    onLevel?.(e.data);
    const nowMs = performance.now();
    if (listener.muted) return;
    let sum = 0;
    for (let i = 0; i < e.data.length; i++) sum += e.data[i]! * e.data[i]!;
    if (e.data.length && Math.sqrt(sum / e.data.length) > CARRIER_RMS) noteActivity(channel, nowMs);
    for (const f of demod.push(e.data)) if (acceptFrame(channel, nowMs)) onFrame(f);
  };
  return listener;
}
