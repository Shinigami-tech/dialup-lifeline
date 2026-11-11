// Web Audio glue: speaker scheduler + microphone capture worklet.
import { modulate } from '../modem/afsk-tx';
import { createDemodulator, type Demodulator } from '../modem/afsk-rx';

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
  await new Promise<void>((resolve) => {
    src.onended = () => resolve();
    src.start();
  });
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
    if (listener.muted) return;
    for (const f of demod.push(e.data)) onFrame(f);
  };
  return listener;
}
