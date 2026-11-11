# Kiro dev log (raw notes for the "How we used Kiro" write-up)

## Day 1 (2026-11-11)
- Wrote 3 specs (modem-core, mesh-relay, lifeline-app) in EARS format, 4 steering docs (product, tech, structure, modem-dsp with fileMatch on src/modem/**), 3 agent hooks.
- Migrated hooks to the new PostFileSave JSON format.
- Task 1 (CRC-16/X.25): Kiro implemented table-driven CRC + 12 tests incl. 2 fast-check properties (round trip, every single-bit flip detected, 2000 runs). The DSP hook fired on save and ran the suite. Kiro self-corrected the residue constant (0x0F47 vs 0xF0B8, byte-order) by writing a probe script. ~2.1 credits.
- Task 2 (HDLC + NRZI): the round-trip PROPERTY TEST found a real bug: the leading 0 of a closing 0x7E flag leaked into the payload. Kiro traced it bit by bit and redesigned the deframer with a `pendingZero` lookahead. 27 tests passing, 500-run round-trip properties over random 0-255-byte payloads. ~4.8 credits.
  -> Story for judges: PBT caught a bug unit tests with fixed vectors missed.
