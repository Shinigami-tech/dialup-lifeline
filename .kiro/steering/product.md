---
inclusion: always
---
# Product: Dial-Up Lifeline

## One line
The 1990s modem screech, resurrected to save lives: phones send SOS messages to each other as sound when the internet, cell network and power are gone.

## Problem
In earthquakes, floods, wildfires and blackouts, cell towers and internet fail first, exactly when people most need to say "I'm alive" or "we're trapped, 3 people, need water". Existing offline tools need a special app installed in advance, Bluetooth pairing, or dedicated hardware.

## Solution
A web app (installable PWA, works fully offline once opened) that turns any phone or laptop into a 1200-baud acoustic modem, the same Bell 202 AFSK tones used by 1980s modems and still used today by ham-radio APRS.
- A person taps their status, the phone "screeches" a compact SOS packet (GPS, status, people count, short note).
- Every phone in earshot decodes it and relays it (store-and-forward mesh), so a message hops room to room, car to car, block to block.
- A rescuer opens Rescue Mode and sees every SOS heard, sorted by urgency, on an offline map.
- Optional Radio Bridge: hold the phone to a walkie-talkie and the packet travels kilometres.

## Audience
1. People in disaster zones (any phone, any language, no install).
2. Volunteer rescuers and community responders.
3. Schools, hospitals and neighbourhood groups preparing emergency plans.

## Principles
- Works with zero infrastructure: no internet, no SIM, no pairing, no account.
- Understandable in 5 seconds under stress: huge buttons, icons, 6+ languages, haptics.
- Honest about limits: show range and success rate, never claim a message reached rescuers unless an ACK was heard.
- The retro modem aesthetic is part of the story (green CRT terminal, BBS banners, CONNECT 1200), but never at the cost of readability.

## Kiroween category
Resurrection: bring dead technology (the dial-up modem) back to solve tomorrow's problem (resilient disaster communication).
