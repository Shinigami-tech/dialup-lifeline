# Devpost submission: Dial-Up Lifeline (Kiroween 2026, Resurrection)

## Tagline (max 200 chars)
The 1990s modem screech, resurrected to save lives: any phone sends an SOS to every phone nearby as sound. No internet, no cell network, no pairing, no install.

## Inspiration
In the first hours after an earthquake or flood, cell towers and the internet are the first things to fail, and that is exactly when people need to say "I'm alive" or "three of us are trapped, we need water".
Every phone still has a speaker and a microphone.
In the 1980s that was enough to connect the whole world: the Bell 202 modem at 1200 baud.
It's a dead technology everybody remembers by its screech. We brought it back from the dead to do the most important job a phone can do.

## What it does
- **One-tap SOS.** Pick what's happening (trapped, injured, fire, water, medicine, children, elderly), set the number of people and add a landmark. The phone screeches a packet with your GPS position. It repeats every 60 s until a rescuer answers.
- **Every phone is a receiver.** Phones in earshot decode the tones, show distance and direction to the caller, and save the message offline.
- **Rescue Mode.**
  - Rescuers see every call on a radar, sorted by urgency: trapped > injured > fire > medicine, then by number of people, then by time waiting.
  - An automatic ACK tells the sender "Rescuers heard you". The rescuer then broadcasts ON THE WAY / RESOLVED.
- **Honest by design.** The app never says a message was delivered unless it heard the reply.
- **6 languages** (English, Russian, Kazakh, Spanish, Turkish, Japanese), huge buttons, a high-contrast theme, and a **Drill mode** for schools to practise.
- **Installable PWA:** open it once, and it works with zero infrastructure.

## How we built it
- **The modem is written from scratch in TypeScript:**
  - Bell 202 AFSK with mark at 1200 Hz and space at 2200 Hz;
  - a continuous-phase modulator;
  - a delay-domain quadrature correlator demodulator;
  - a second-order PLL for clock recovery, which survives ±2% clock mismatch between two cheap phones.
- **Link layer:** HDLC framing with bit stuffing, NRZI and CRC-16/X.25. It is the same link layer as amateur-radio APRS, so a phone held to a walkie-talkie can carry the packet for kilometres.
- **App:**
  - an AudioWorklet microphone tap (echo cancellation, noise suppression and AGC turned off, because they destroy modem tones);
  - IndexedDB;
  - a service worker;
  - Vite, with no framework, to stay small and fast on old phones.

## How we used Kiro
Kiro was our engineering partner from the first line. See the `/.kiro` folder.

- **Spec-driven development.** We wrote three specs in EARS format (`modem-core`, `mesh-relay`, `lifeline-app`), each with requirements, design and a task list, and Kiro implemented the modem task by task.
  - Each task links back to its requirement. For example, CRC-16 maps to Req 3.3, and the PLL to Req 2.2.
- **Steering.**
  - `product.md`, `tech.md` and `structure.md` keep every session on-mission.
  - `modem-dsp.md` loads only when DSP files are open (`fileMatch: src/modem/**`). It carries the sample-rate, phase-continuity and clock-skew rules a modem engineer would insist on.
- **Agent hooks.**
  - `dsp-property-tests` re-runs the property-based tests every time a modem file is saved.
  - `i18n-sync` keeps the 6 languages in step when English strings change.
  - `a11y-review` checks every UI change for readability under stress.
- **Property-based testing (fast-check) caught real bugs that fixed unit tests missed:**
  1. The HDLC deframer leaked the leading 0 of a closing flag into the payload. The round-trip property failed. Kiro traced it bit by bit and redesigned the deframer with a `pendingZero` lookahead.
  2. Our first clock-skew property was vacuous: it cancelled its own skew. Once we corrected the model and fed the finding back to Kiro, a 56-case gain sweep exposed an inverted PLL integrator sign. After the fix, the PLL holds a lock at ±2% skew with noise.
  - Lesson: a property test is only as good as the model inside it. Kiro and a human reviewer together got the model right.
- **Result:** 57 tests green, including an end-to-end test that sends a real SOS through the modulator, a skewed and noisy channel, and the demodulator.

## Challenges we ran into
- Real phones never agree on their sample clock, so a naive demodulator loses bit sync within one packet. We needed a real PLL, and we needed a test that actually models the skew.
- Browsers "help" by running echo cancellation and noise suppression, and those treat modem tones as noise. We had to turn them off in the AudioWorklet capture.
- Wording for people in panic. Every screen had to be understandable in 5 seconds, in 6 languages.

## Accomplishments that we're proud of
- A working 1200-baud software modem in the browser, with property-based proof that it survives noise, offsets and clock skew.
- Rescue Mode triage and the ACK loop. The person calling for help learns that someone heard them, which is the moment panic turns into waiting.

## What we learned
- Old technology is not dead technology. Bell 202 is 50 years old and is still the most robust way to move bytes over a channel nobody designed for data.
- Spec-driven development with Kiro made a DSP project tractable: small, testable tasks, each traced to a requirement.

## What's next for Dial-Up Lifeline
- A compact 17-byte binary packet and a **store-and-forward mesh relay**, so phones re-broadcast what they hear and a message hops block to block. It has duplicate suppression and listen-before-talk. Specified in `.kiro/specs/mesh-relay`.
- A robust 300-baud mode for noisy rooms, and a Radio Bridge for walkie-talkies.
- Pilots with school emergency drills and volunteer rescue groups in Kazakhstan.

## Built with
typescript, vite, web-audio-api, audioworklet, indexeddb, pwa, service-worker, fast-check, vitest, kiro
