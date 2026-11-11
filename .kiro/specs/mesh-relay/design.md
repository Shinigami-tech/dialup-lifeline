# Design: Mesh Relay

Gossip with suppression (similar to Trickle / Meshtastic managed flooding), tuned for a half-duplex acoustic channel.

## Packet layout (bits)
| Field | Bits |
|---|---|
| version | 3 |
| type | 3 |
| hop | 3 |
| ttl | 3 |
| msgId | 32 |
| originMinutes (since 2026-01-01 UTC) | 24 |
| lat (×1e4 + 900000) | 21 |
| lon (×1e4 + 1800000) | 22 |
| accuracyClass | 3 |
| statusFlags | 8 |
| people | 4 |
| battery (×10%) | 4 |
| noteLength | 6 |
| note | 0-320 |
Total without note: 136 bits = 17 bytes.

## Relay state machine
`heard -> (unseen & hop<ttl) -> scheduled(delay 2-8 s) -> [same id heard?] -> suppressed | transmitted`
Persisted in IndexedDB `messages` store keyed by msgId; `seen` set kept 24 h.

## Channel access
Listen-before-talk: only transmit after 600 ms of channel silence; exponential backoff on busy channel.

## Simulation
`src/mesh/sim.ts` runs N virtual phones on a 2D grid with configurable range to visualise propagation in the demo and to property-test that every node within the connected component eventually stores each message exactly once.
