# Design: Modem Core

## Pipeline
```
TX: bytes -> crc16 append -> bit-stuff -> NRZI -> AFSK (phase accumulator) -> Float32 samples -> speaker
RX: mic -> gain normalize -> quadrature correlators @1200/2200 -> energy diff -> PLL bit clock
        -> NRZI decode -> flag detect / unstuff -> crc check -> payload
```

## Key decisions
| Decision | Choice | Why |
|---|---|---|
| Modulation | Bell 202 AFSK 1200 baud | Authentic modem/APRS sound; survives speakers and radios; reference implementations exist (Dire Wolf, multimon-ng) |
| Framing | HDLC + NRZI | Proven, self-synchronising, compatible with AX.25 for Radio Bridge |
| Error detection | CRC-16/X.25 | Standard for HDLC; 2 bytes |
| Redundancy | Each packet sent 2x with 400 ms gap; mesh relays add spatial diversity | Simple, beats FEC complexity for a 3-week build |
| Threading | AudioWorkletProcessor for RX | Never drop audio while UI animates |

## Modules
- `src/modem/crc.ts` crc16x25(bytes): number
- `src/modem/hdlc.ts` frame(bytes): bits, deframe(bits): bytes[] (stream, stateful object kept as plain data)
- `src/modem/nrzi.ts`
- `src/modem/afsk-tx.ts` modulate(bits, {sampleRateHz, baud, markHz, spaceHz}): Float32Array
- `src/modem/afsk-rx.ts` createDemodulator(opts) -> { push(samples): Uint8Array[] , stats }
- `src/modem/screech.ts` stylised handshake synth (V.22-like tones + noise burst)

## Error handling
Corrupted frames are dropped and counted. Demodulator state resets after 2 s of silence.

## Testing
- Unit: known APRS test vectors for CRC and HDLC.
- Property (fast-check): round trip over random payloads, sample rates, amplitudes, phase offsets, DC offset, added white noise at >=10 dB SNR, and ±2% clock skew.
