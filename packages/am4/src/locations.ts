/**
 * AM4 preset-location addressing.
 *
 * The AM4 stores 104 presets across 26 banks (A..Z), 4 presets per bank.
 * Per the AM4 owner's manual, Fractal calls a stored preset's address its
 * "location" (e.g. "Use SELECT and ABCD to choose a location to save to").
 * On the wire, locations are a 0-based index 0..103:
 *   A01 = 0, A02 = 1, ..., A04 = 3, B01 = 4, ..., Z04 = 103.
 *
 * Accepts both "A1" and zero-padded "A01" on input; emits the 3-char form
 * on output. Users and the MCP surface always speak the letter form; the
 * wire only sees the index.
 *
 * Reserved terminology: the word "slot" is reserved for block (effect)
 * positions within a preset's signal chain — see buildSetBlockType. Do
 * NOT use "slot" for preset locations in new code or user-facing strings.
 */

const BANK_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const LOCATIONS_PER_BANK = 4;
export const TOTAL_LOCATIONS = BANK_LETTERS.length * LOCATIONS_PER_BANK;

/** Parse "A01".."Z04" (or "A1".."Z4") → 0..103 wire index. Throws on bad input. */
export function parseLocationCode(code: string): number {
  const m = /^([A-Za-z])0?(\d)$/.exec(code.trim());
  if (!m) {
    throw new Error(
      `Preset location must look like "A01".."Z04" (bank A..Z + sub-index 01..04), got "${code}".`,
    );
  }
  const bank = m[1].toUpperCase().charCodeAt(0) - 'A'.charCodeAt(0);
  const sub = parseInt(m[2], 10);
  if (sub < 1 || sub > LOCATIONS_PER_BANK) {
    throw new Error(`Preset sub-index must be 1..${LOCATIONS_PER_BANK}, got ${sub} in "${code}".`);
  }
  return bank * LOCATIONS_PER_BANK + (sub - 1);
}

/** Inverse: 0..103 → "A01".."Z04" (3-char canonical form for keys + safety comparisons). */
export function formatLocationCode(locationIndex: number): string {
  if (!Number.isInteger(locationIndex) || locationIndex < 0 || locationIndex >= TOTAL_LOCATIONS) {
    throw new Error(`Preset location index must be integer 0..${TOTAL_LOCATIONS - 1}, got ${locationIndex}.`);
  }
  const bank = Math.floor(locationIndex / LOCATIONS_PER_BANK);
  const sub = (locationIndex % LOCATIONS_PER_BANK) + 1;
  return `${BANK_LETTERS[bank]}${sub.toString().padStart(2, '0')}`;
}

/**
 * 0..103 → "A1".."Z4" — the unpadded form Fractal uses on the AM4 hardware
 * display and throughout the AM4 Owner's Manual ("preset A1", "C3", "W4",
 * etc.). Use this in user-facing tool output where the founder/user expects
 * to see what the device shows. `formatLocationCode` (zero-padded) stays as
 * the internal canonical form for safety comparisons (SCRATCH_LOCATION) and
 * fingerprint-table keys.
 */
export function formatLocationDisplay(locationIndex: number): string {
  if (!Number.isInteger(locationIndex) || locationIndex < 0 || locationIndex >= TOTAL_LOCATIONS) {
    throw new Error(`Preset location index must be integer 0..${TOTAL_LOCATIONS - 1}, got ${locationIndex}.`);
  }
  const bank = Math.floor(locationIndex / LOCATIONS_PER_BANK);
  const sub = (locationIndex % LOCATIONS_PER_BANK) + 1;
  return `${BANK_LETTERS[bank]}${sub}`;
}
