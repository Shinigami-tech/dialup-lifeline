/**
 * Modem mode presets.
 *
 * - standard: Bell 202 AFSK, 1200 baud, mark 1200 Hz / space 2200 Hz.
 * - robust:   300 baud fallback for noisy rooms (Bell 103-style rate).
 *
 * Tone choice for robust mode: we KEEP 1200/2200 Hz rather than the true
 * Bell 103 pairs (1270/1070 Hz or 2225/2025 Hz). Reasons:
 *   - Bell 103 tones are only 200 Hz apart; with a 1/300 s symbol window that
 *     is just 0.67 cycles of separation, so the correlators barely
 *     discriminate. 1000 Hz spacing gives 3.33 cycles, far better separation.
 *   - Same tones means phone speakers/mics and radio audio paths that already
 *     work in standard mode work in robust mode.
 *   - The 4x longer symbol window integrates 4x more energy per bit
 *     (~6 dB processing gain over standard mode).
 *
 * Framing (HDLC, NRZI, CRC-16/X.25) is identical in both modes.
 *
 * Req 1.5
 */

export type ModemMode = "standard" | "robust";

export interface ModePreset {
  readonly baudRate: number;
  readonly markHz: number;
  readonly spaceHz: number;
}

export const MODE_PRESETS: Readonly<Record<ModemMode, ModePreset>> = {
  standard: { baudRate: 1200, markHz: 1200, spaceHz: 2200 },
  robust: { baudRate: 300, markHz: 1200, spaceHz: 2200 },
};

export const DEFAULT_MODE: ModemMode = "standard";

/** Resolve a mode name to its preset (defaults to standard). */
export function getModePreset(mode: ModemMode = DEFAULT_MODE): ModePreset {
  return MODE_PRESETS[mode];
}
