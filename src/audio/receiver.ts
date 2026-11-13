/** Main-thread helper: mic capture -> AudioWorklet demodulator. Req 2.1 */
import { audioContext } from './io';
import workletUrl from './rx-worklet?worker&url';
import {
  dispatchReceiverMessage,
  type ReceiverHandlers,
  type ReceiverOutMessage,
} from './rx-protocol';

const RX_PROCESSOR_NAME = 'lifeline-rx';

export interface Receiver {
  stop(): void;
  /** Mute demodulation (e.g. while our own transmitter is playing). */
  setMuted(muted: boolean): void;
}

/** Request the mic with all browser voice processing disabled, per DSP guidance. */
export function requestRawMicrophone(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  });
}

export async function startReceiver(handlers: ReceiverHandlers): Promise<Receiver> {
  const ac = audioContext();
  await ac.resume();
  const stream = await requestRawMicrophone();
  await ac.audioWorklet.addModule(workletUrl);
  const source = ac.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ac, RX_PROCESSOR_NAME, {
    numberOfInputs: 1,
    numberOfOutputs: 0,
    channelCount: 1,
  });
  node.port.onmessage = (e: MessageEvent<ReceiverOutMessage>) =>
    dispatchReceiverMessage(e.data, handlers);
  source.connect(node);
  return {
    setMuted: (muted) => node.port.postMessage({ type: 'mute', muted }),
    stop() {
      source.disconnect();
      node.disconnect();
      node.port.onmessage = null;
      stream.getTracks().forEach((t) => t.stop());
    },
  };
}
