---
inclusion: always
---
# Tech stack and rules

- TypeScript (strict), Vite, no backend. Deployed as a static PWA on Vercel.
- Audio: Web Audio API. Transmit with an AudioWorklet or OscillatorNode schedule; receive with an AudioWorkletProcessor that runs the demodulator off the main thread.
- DSP is pure TypeScript in `src/modem/` with ZERO browser dependencies so it can be unit- and property-tested in Node.
- Modem: Bell 202 AFSK, 1200 baud, mark 1200 Hz, space 2200 Hz, NRZI + HDLC framing (0x7E flags, bit stuffing), CRC-16/X.25. Fallback "Robust" mode: Bell 103-style 300 baud for noisy rooms.
- Packets: compact binary format defined in `src/packet/` (see design.md). Every packet carries a 32-bit random message id, hop count and TTL.
- Testing: Vitest for unit tests, fast-check for property-based tests. Every encoder must have a round-trip property (decode(encode(x)) == x) and the demodulator must pass a noise/offset property test on synthesized audio.
- UI: vanilla TS + lit-html or Preact (small), CSS custom properties for the CRT theme, prefers-reduced-motion respected, all text from `src/i18n/`.
- Offline: service worker precaches the app shell, fonts and a vector map style; IndexedDB stores heard messages.
- No analytics, no network calls at runtime unless the user explicitly enables "Internet uplink".
- Code style: small pure functions, no classes in DSP code, explicit units in names (`sampleRateHz`, `durationMs`).
