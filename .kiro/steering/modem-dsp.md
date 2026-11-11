---
inclusion: fileMatch
fileMatchPattern: "src/modem/**"
---
# DSP guidance (loaded only when editing modem code)

- Sample rate is whatever the AudioContext gives (44100 or 48000). Never hardcode it; derive samplesPerBit = sampleRateHz / baud as a float and use a phase accumulator, not integer rounding.
- TX: continuous-phase FSK (no phase jumps between bits) to avoid clicks. Ramp amplitude in/out over 5 ms.
- Preamble: 300 ms of 0x7E flags so receivers can lock; trailer: 3 flags.
- RX: two Goertzel or quadrature correlators (1200/2200 Hz) over a one-bit sliding window, compare energies, then a digital PLL for clock recovery that nudges on every transition.
- Add an automatic gain normalizer before demod; phone mics apply AGC and noise suppression, so request getUserMedia with echoCancellation, noiseSuppression and autoGainControl all set to false.
- Always validate CRC before handing a frame to the packet layer; drop silently otherwise and count it in stats.
