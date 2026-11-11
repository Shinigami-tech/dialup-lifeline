# Design: Lifeline App

## Screens
1. **Home**: two giant buttons (HELP red, SAFE green), status line "LISTENING... 3 messages heard".
2. **SOS builder**: icon grid toggles, people stepper, note, SEND (hold 1 s to avoid accidental sends).
3. **Transmitting**: CRT screen, screech + waveform, "PACKET 1/2 SENT", repeating countdown, Stop.
4. **Inbox**: cards with status icons, distance/bearing arrow, hop count, "relayed by you" badge.
5. **Rescue Mode**: offline map (MapLibre + pre-cached vector tiles for a chosen region) + urgency list, case actions.
6. **Settings**: language, theme, relay on/off, robust mode, screech on/off, region download, Drill mode.
7. **Diagnostics**: SNR, frames ok/corrupt, clock offset, loopback self-test.

## Visual language
Phosphor green #33FF66 on #001a0a, amber accent for warnings, red only for SOS. Font: VT323 for headers, system sans for body text. Scanline and flicker effects disabled under prefers-reduced-motion.

## Demo setup (for judges)
- Three phones on a table: A sends SOS, B is across the room relaying, C in Rescue Mode shows the case and ACK returns to A.
- Mesh simulator page visualising 50 virtual phones spreading a message across a neighbourhood.
