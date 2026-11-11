# Requirements: Modem Core (acoustic Bell 202 modem)

## Introduction
The modem turns bytes into sound and sound back into bytes, using the same 1200-baud AFSK tones as classic modems and ham-radio APRS, so it works through any phone speaker, microphone or walkie-talkie.

## Requirement 1: Transmit
**User story:** As a person in a disaster, I want my phone to turn my SOS into sound so nearby phones can hear it without any network.
1. WHEN the app is given a frame payload of up to 255 bytes THE SYSTEM SHALL produce continuous-phase AFSK audio at 1200 baud with mark 1200 Hz and space 2200 Hz.
2. THE SYSTEM SHALL wrap every payload in HDLC framing: a 300 ms flag preamble, bit-stuffed NRZI data, a CRC-16/X.25 frame check sequence and a 3-flag trailer.
3. WHEN transmission starts THE SYSTEM SHALL ramp amplitude in over 5 ms and out over 5 ms to avoid clicks.
4. WHERE "Classic screech" is enabled THE SYSTEM SHALL play a 1.5 s stylised dial-up handshake before the first frame (cosmetic, skippable, off in Silent mode).
5. WHERE Robust mode is selected THE SYSTEM SHALL transmit at 300 baud using the same framing.

## Requirement 2: Receive
**User story:** As anyone nearby, I want my phone to hear and decode SOS sounds automatically.
1. WHILE listening THE SYSTEM SHALL demodulate microphone audio in an AudioWorklet without blocking the UI thread.
2. THE SYSTEM SHALL recover bit timing with a digital PLL tolerant to ±2% clock difference between devices.
3. WHEN a frame's CRC is valid THE SYSTEM SHALL deliver the payload to the packet layer within 200 ms of the trailing flag.
4. IF a frame's CRC is invalid THEN THE SYSTEM SHALL discard it and increment a "corrupted frames" counter shown in diagnostics.
5. THE SYSTEM SHALL decode correctly at a signal-to-noise ratio of 10 dB on synthesized test audio (property-tested).

## Requirement 3: Testability
1. THE SYSTEM SHALL keep all DSP in pure TypeScript with no DOM dependencies.
2. THE SYSTEM SHALL satisfy the property: for any byte array b (0-255 bytes), any sample rate in {44100, 48000}, any phase offset and any amplitude in [0.1, 1], demodulate(modulate(b)) == b.
3. THE SYSTEM SHALL satisfy: crc16(x) appended to x always verifies, and any single-bit flip is detected.
