---
inclusion: always
---
# Project structure

```
src/
  modem/      # pure DSP: afsk tx/rx, goertzel, nrzi, hdlc, crc  (no DOM)
  packet/     # binary packet schema, encode/decode, i18n-free
  mesh/       # dedup, relay scheduling, TTL, store (pure logic + IndexedDB adapter)
  audio/      # Web Audio glue: mic capture worklet, speaker scheduler
  ui/         # screens: Home(SOS), Status, Inbox, Rescue Mode, Settings, Radio Bridge
  i18n/       # en, ru, kk, es, tr, ja
  sw.ts       # service worker
tests/        # vitest + fast-check, synthesized-audio fixtures
docs/         # architecture diagram, kiro write-up, demo script
```
Specs live in `.kiro/specs/<feature>/` (requirements.md, design.md, tasks.md).
