# Requirements: Lifeline App (UI, offline, Rescue Mode)

## Requirement 1: Send SOS in 3 taps
**User story:** As a scared person with shaking hands, I want to send help requests instantly.
1. WHEN the app opens THE SYSTEM SHALL show two giant buttons, "I NEED HELP" and "I'M SAFE", usable with one thumb.
2. WHEN "I NEED HELP" is tapped THE SYSTEM SHALL show icon toggles (injured, trapped, water, medicine, fire, children, elderly) and a people counter, then a single SEND button.
3. WHEN SEND is tapped THE SYSTEM SHALL read GPS if permitted (works without internet), encode the packet and transmit, then repeat automatically every 60 s until stopped or acknowledged.
4. WHERE GPS is unavailable THE SYSTEM SHALL allow a typed landmark in the note.

## Requirement 2: Hear and help
1. WHILE the app is open THE SYSTEM SHALL listen continuously and list heard messages with status icons, distance and bearing (when both sides have GPS), age and hop count.
2. WHEN an SOS is heard THE SYSTEM SHALL vibrate and show an alert banner.

## Requirement 3: Rescue Mode
**User story:** As a volunteer rescuer, I want a live picture of who needs help.
1. WHEN Rescue Mode is enabled THE SYSTEM SHALL show all heard SOS on an offline map and a list sorted by urgency (trapped > injured > medical > others, then by people count and age).
2. THE SYSTEM SHALL let the rescuer mark a case "on the way" and "resolved", broadcasting an INFO packet.
3. THE SYSTEM SHALL export all cases as CSV/GeoJSON when a network is available.

## Requirement 4: Works offline, anywhere
1. THE SYSTEM SHALL be an installable PWA that fully functions with no network after the first visit.
2. THE SYSTEM SHALL support English, Russian, Kazakh, Spanish, Turkish and Japanese, auto-detected, switchable with flags.
3. THE SYSTEM SHALL meet WCAG AA contrast and support screen readers and reduced motion.

## Requirement 5: Retro but clear
1. THE SYSTEM SHALL present a green-phosphor CRT terminal theme with BBS-style banners and live "CONNECT 1200" / "CARRIER LOST" logs, plus a high-contrast plain theme.
2. WHILE transmitting or receiving THE SYSTEM SHALL show a live waveform/spectrum so people see the modem working.

## Requirement 6: Radio Bridge (stretch)
1. WHERE Radio Bridge is enabled THE SYSTEM SHALL format frames as AX.25 UI frames with APRS position reports so standard ham-radio APRS receivers can decode them, and SHALL warn that transmitting on amateur bands requires a licence.

## Requirement 7: Training mode
1. THE SYSTEM SHALL offer a Drill mode that tags packets as practice so schools and families can rehearse without causing alarm.
