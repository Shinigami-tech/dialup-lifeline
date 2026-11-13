/**
 * AudioWorkletProcessor: thin wrapper around the pure receiver core.
 * Runs off the main thread so demodulation never stalls (or is stalled by) the UI.
 * Loaded via `?worker&url` so Vite bundles its imports into one module.
 */
import { createReceiverCore, type ReceiverInMessage } from './rx-protocol';

// AudioWorkletGlobalScope declarations (not in lib.dom).
declare const sampleRate: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor();
}
declare function registerProcessor(name: string, ctor: new () => AudioWorkletProcessor): void;

export const RX_PROCESSOR_NAME = 'lifeline-rx';

class RxProcessor extends AudioWorkletProcessor {
  private readonly core = createReceiverCore({ sampleRateHz: sampleRate });

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent<ReceiverInMessage>) => this.core.handleMessage(e.data);
  }

  process(inputs: Float32Array[][]): boolean {
    const channel = inputs[0]?.[0];
    if (!channel) return true;
    for (const msg of this.core.process(channel)) {
      if (msg.type === 'frame') this.port.postMessage(msg, [msg.payload.buffer]);
      else this.port.postMessage(msg);
    }
    return true;
  }
}

registerProcessor(RX_PROCESSOR_NAME, RxProcessor);
