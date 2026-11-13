# Requirements: Mesh Relay (store-and-forward)

## Introduction
One phone's speaker reaches maybe 10-30 m. Relaying lets an SOS hop from phone to phone until it reaches a rescuer.

## Requirement 1: Packet format
**User story:** As a sender, I want my whole situation to fit in under one second of sound.
1. THE SYSTEM SHALL encode an SOS packet with: version, type (SOS, OK, ACK, INFO), 32-bit message id, origin time (minutes), hop count, TTL, latitude/longitude (~11 m precision), accuracy class, status flags (injured, trapped, needs water, needs medicine, fire, children, elderly, safe), people count (0-15), sender battery level, and an optional UTF-8 note of up to 40 bytes.
2. THE SYSTEM SHALL keep an SOS packet without note at 20 bytes or less.
3. THE SYSTEM SHALL satisfy the property decode(encode(p)) == p for every valid packet.

## Requirement 2: Relaying
**User story:** As a bystander, I want my phone to pass on messages it hears so they travel further.
1. WHEN a valid packet with an unseen id and hop count < TTL is received THE SYSTEM SHALL store it and schedule a rebroadcast after a random delay of 2-8 s.
2. IF the same id is heard again from another relay, meaning a copy whose hop count is greater than or equal to the hop count of our pending rebroadcast, before the scheduled rebroadcast THEN THE SYSTEM SHALL cancel its own rebroadcast (suppression, avoids flooding). A repeat at a lower hop count (for example the origin sending its packet twice) SHALL NOT cancel it.
3. THE SYSTEM SHALL never rebroadcast a packet more than once per device.
4. WHILE the device is transmitting THE SYSTEM SHALL pause its receiver to avoid hearing itself.
5. WHERE relaying is disabled by the user THE SYSTEM SHALL only listen and display.

## Requirement 3: Acknowledgement
**User story:** As a sender, I want to know if a rescuer received my SOS.
1. WHEN a device in Rescue Mode receives an SOS THE SYSTEM SHALL send an ACK packet referencing the SOS id.
2. WHEN the original sender hears an ACK for its message THE SYSTEM SHALL show "Rescuers heard you" with time and hop count, and vibrate.
3. THE SYSTEM SHALL NOT show a delivered state without a received ACK.
