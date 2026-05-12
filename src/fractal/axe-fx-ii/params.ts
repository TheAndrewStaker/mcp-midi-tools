/**
 * Axe-Fx II parameter registry (generated).
 *
 * Each entry describes one addressable parameter on the Axe-Fx II
 * family. Wire-side identity is `(effectId, paramId)` — `paramId` is
 * shared across every block instance in the same group (e.g. Amp 1 and
 * Amp 2 both expose `paramId: 1` for INPUT DRIVE), so the registry is
 * keyed by group + parameter, with `effectId` resolved at the tool
 * boundary via `./blockTypes.ts` `IDS_BY_GROUP`.
 *
 * Sources joined:
 *   • Fractal Audio Wiki "MIDI_SysEx" — wire-IDs + UPPERCASE name +
 *     control type + enum options + min/max/step (where present).
 *     Cached at `docs/_private/wiki-cache/axe-fx-ii-midi-sysex.html`.
 *   • Axe-Edit `__block_layout.xml` — symbolic `parameterName` (e.g.
 *     `DISTORT_DRIVE`) + Title-Case UI label + type-applicability
 *     gates. Catalogued at
 *     `samples/captured/decoded/labels/axe-edit-catalog.json`.
 *
 * **DO NOT EDIT BY HAND** — regenerate via:
 *   npx tsx scripts/extract-axe-fx-ii-params.ts
 *
 * Status: 🟢 hardware-verified on Quantum 8.02 (2026-05-10). The
 * 929-param wire encoder + paramId→knob resolution were exercised
 * end-to-end by HW-075 (Amp 1 Bass write, Reverb 1 bypass) + HW-077
 * (Amp 1 Bass read with device label echo) on the founder's XL+.
 * Wiki min/max/step are still populated only for the subset of
 * params the wiki documents — most knobs are blank in the wiki and
 * need hardware spotchecks (HW-079 calibration sweep) to anchor
 * display ranges. Until then, encoders treat absent ranges as
 * "wire 0..65534, display unknown" and pass the value through
 * verbatim — that's a display-layer gap, not a wire-encoding gap.
 *
 * Wire encoding (per wiki "MIDI SysEx: obtaining parameter values"):
 *   value range  : 0..65534 integer
 *   3-septet pack: [bits 6-0, bits 13-7, bits 14-15 in low 2 bits]
 *
 * Reference encoder lives in `./setParam.ts` (TBD when the encoder
 * lands in the multi-vendor refactor).
 */

export type AxeFxIIControlType = 'knob' | 'select' | 'switch' | 'unknown';

export interface AxeFxIIParam {
    /** Wiki block group (e.g. "AMP", "CPR", "GEQ"). */
    readonly groupCode: string;
    /** Block slug used in the registry key (e.g. "amp", "compressor"). */
    readonly block: string;
    /** Wire-side `paramId` within the block (0..255). */
    readonly paramId: number;
    /** Wiki "Name" column (UPPERCASE, e.g. "INPUT DRIVE"). */
    readonly wikiName: string;
    /** Snake-case key matching the registry suffix. */
    readonly name: string;
    /** Wiki control type. */
    readonly controlType: AxeFxIIControlType;
    /** Axe-Edit XML symbolic name when matched (e.g. "DISTORT_DRIVE"). */
    readonly parameterName?: string;
    /** Axe-Edit XML UI label when matched (e.g. "Input Drive"). */
    readonly xmlLabel?: string;
    /** Enum values for `select` controls (wire int → display name). */
    readonly enumValues?: Readonly<Record<number, string>>;
    /** Display min from wiki (when populated). */
    readonly displayMin?: number;
    /** Display max from wiki (when populated). */
    readonly displayMax?: number;
    /** Display step from wiki (when populated). */
    readonly step?: number;
    /**
     * Scale shape mapping wire 0..65534 to displayMin..displayMax.
     * Defaults to `'linear'` when omitted. `'log10'` is for frequency
     * knobs and similar log-perceptual scales (confirmed for Axe-Fx II
     * cab/amp filter frequencies via HW-090, 2026-05-11). Requires
     * positive displayMin/displayMax.
     */
    readonly displayScale?: 'linear' | 'log10';
    /** Whether a modifier can target this param. */
    readonly modifierAssignable?: boolean;
    /** Firmware version that introduced this param. */
    readonly fwAdded?: string;
    /** XML applicability gate: which other parameter controls visibility. */
    readonly gateOn?: string;
    /** XML gate values (comma-separated string of variant indices). */
    readonly gateValues?: string;
}

export const AMP_EFFECT_TYPE_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "59 BASSGUY",
    1: "65 BASSGUY NRML",
    2: "VIBRATO VERB",
    3: "DELUXE VERB VIB",
    4: "DOUBLE VERB VIB",
    5: "JR BLUES",
    6: "CLASS-A 15W TB",
    7: "CLASS-A 30W",
    8: "CLASS-A 30W TB",
    9: "BRIT JM45",
    10: "PLEXI 50W NRML",
    11: "PLEXI 50W HI 1",
    12: "1987X NORMAL",
    13: "1987X TREBLE",
    14: "BRIT 800",
    15: "BRIT SUPER",
    16: "HIPOWER NORMAL",
    17: "HIPOWER BRILLNT",
    18: "USA CLEAN",
    19: "USA PRE CLEAN",
    20: "USA RHYTHM",
    21: "USA IIC+",
    22: "USA IIC+ BRight",
    23: "USA LEAD",
    24: "USA LEAD BRT",
    25: "RECTO2 ORG VNTG",
    26: "RECTO2 ORG MDRN",
    27: "RECTO2 RED VNTG",
    28: "RECTO2 RED MDRN",
    29: "EURO BLUE",
    30: "EURO RED",
    31: "SHIVER CLEAN",
    32: "SHIVER LEAD",
    33: "EURO UBER",
    34: "SOLO 99 CLEAN",
    35: "SOLO 100 RHY",
    36: "SOLO 100 LEAD",
    37: "FRIEDMAN BE V1",
    38: "FRIEDMAN HBE V1",
    39: "PVH 6160 BLOCK",
    40: "MR Z MZ-38",
    41: "CA3+ RHY",
    42: "CA3+ LEAD",
    43: "WRECKER ROCKET",
    44: "CORNCOB M50",
    45: "CA OD-2",
    46: "FRYETTE D60 L",
    47: "FRYETTE D60 M",
    48: "BRIT BROWN",
    49: "CITRUS RV50",
    50: "JAZZ 120",
    51: "ENERGYBALL",
    52: "ODS-100 CLEAN",
    53: "ODS-100 HRM",
    54: "FAS RHYTHM",
    55: "FAS LEAD 1",
    56: "FAS LEAD 2",
    57: "FAS MODERN",
    58: "DAS METALL",
    59: "BRIT PRE",
    60: "BUTTERY",
    61: "BOUTIQUE 1",
    62: "BOUTIQUE 2",
    63: "CAMERON CCV 1A",
    64: "CAMERON CCV 2A",
    65: "SV BASS",
    66: "TUBE PRE",
    67: "FAS BROWN",
    68: "BIG HAIR",
    69: "SOLO 99 LEAD",
    70: "SUPERTWEED",
    71: "TX STAR LEAD",
    72: "FAS WRECK",
    73: "BRIT JVM OD1 OR",
    74: "BRIT JVM OD2 OR",
    75: "FAS 6160",
    76: "CALI LEGGY",
    77: "USA LEAD +",
    78: "USA LEAD BRT +",
    79: "PRINCE TONE",
    80: "BLANKNSHP LEEDS",
    81: "5153 100W GREEN",
    82: "5153 100W BLUE",
    83: "5153 100W RED",
    84: "SOLO 88 RHYTHM",
    85: "DIV/13 CJ",
    86: "HERBIE CH2-",
    87: "HERBIE CH2+",
    88: "HERBIE CH3",
    89: "DIRTY SHIRLEY 1",
    90: "DIZZY V4 BLUE 2",
    91: "DIZZY V4 BLUE 3",
    92: "DIZZY V4 BLUE 4",
    93: "SUHR BADGER 18",
    94: "SUHR BADGER 30",
    95: "PRINCE TONE NR",
    96: "SUPREMO TREM",
    97: "ATOMICA LOW",
    98: "ATOMICA HIGH",
    99: "DELUXE TWEED",
    100: "SPAWN ROD OD2-1",
    101: "SPAWN ROD OD2-2",
    102: "SPAWN ROD OD2-3",
    103: "BRIT SILVER",
    104: "SPAWN NITROUS 2",
    105: "FAS CRUNCH",
    106: "TWO STONE J35 1",
    107: "FOX ODS",
    108: "HOT KITTY",
    109: "BAND-COMMANDER",
    110: "SUPER VERB VIB",
    111: "VIBRA-KING",
    112: "GIBTONE SCOUT",
    113: "PVH 6160+ LD",
    114: "SOLO 100 CLEAN",
    115: "USA PRE LD2 GRN",
    116: "USA PRE LD2 YLW",
    117: "CA3+ CLEAN",
    118: "FOX ODS DEEP",
    119: "BRIT JVM OD1 GN",
    120: "BRIT JVM OD2 GN",
    121: "VIBRATO LUX",
    122: "BRIT 800 MOD",
    123: "NUCLEAR-TONE",
    124: "BLUDOJAI CLEAN",
    125: "BLUDOJAI LD PAB",
    126: "PLEXI 100W HIGH",
    127: "PLEXI 100W NRML",
    128: "RUBY ROCKET",
    129: "AC-20 EF86 B",
    130: "PRINCE TONE REV",
    131: "COMET CONCOURSE",
    132: "FAS MODERN II",
    133: "CA TRIPTIK MDRN",
    134: "CA TRIPTIK CLSC",
    135: "CA TRIPTIK CLN",
    136: "THORDENDAL VINT",
    137: "THORDENDAL MDRN",
    138: "ODS-100 HRM MID",
    139: "EURO BLUE MDRN",
    140: "EURO RED MDRN",
    141: "PLEXI 50W JUMP",
    142: "AC-20 EF86 T",
    143: "COMET 60",
    144: "HIPOWER JUMPED",
    145: "PLEXI 100W JUMP",
    146: "BRIT JM45 JUMP",
    147: "1987X JUMP",
    148: "RECTO1 ORG VNTG",
    149: "RECTO1 RED",
    150: "ODS-100 FORD 1",
    151: "BOGFISH STRATO",
    152: "BOGFISH BROWN",
    153: "5F1 TWEED",
    154: "WRECKER EXPRESS",
    155: "TWO STONE J35 2",
    156: "ODS-100 FORD 2",
    157: "MR Z MZ-8",
    158: "CAR ROAMER",
    159: "USA SUB BLUES",
    160: "WRECKER LVRPOOL",
    161: "CITRUS TERRIER",
    162: "CITRUS A30 CLN",
    163: "CITRUS A30 DRTY",
    164: "DIV/13 FT37 LO",
    165: "DIV/13 FT37 HI",
    166: "MATCHBOX D-30",
    167: "FAS CLASS-A",
    168: "USA BASS 400 1",
    169: "USA BASS 400 2",
    170: "CITRUS BASS 200",
    171: "FAS BASS",
    172: "TREMOLO LUX",
    173: "FAS BROOTALZ",
    174: "RECTO1 ORG MDRN",
    175: "ANGLE SEVERE 1",
    176: "ANGLE SEVERE 2",
    177: "USA PRE LD2 RED",
    178: "USA PRE LD1 RED",
    179: "TX STAR CLEAN",
    180: "AC-20 12AX7 T",
    181: "VIBRATO VERB AA",
    182: "VIBRATO VERB AB",
    183: "CA TUCANA LEAD",
    184: "JR BLUES FAT",
    185: "SOLO 88 LEAD",
    186: "BRIT AFS100 1",
    187: "BRIT AFS100 2",
    188: "CLASS-A 30W HOT",
    189: "DIZZY V4 SLVR 2",
    190: "DIZZY V4 SLVR 3",
    191: "DIZZY V4 SLVR 4",
    192: "1959SLP NORMAL",
    193: "1959SLP TREBLE",
    194: "1959SLP JUMP",
    195: "FAS MODERN III",
    196: "ODS-100 FORD MD",
    197: "MR Z HWY 66",
    198: "6G4 SUPER",
    199: "6G12 CONCERT",
    200: "65 BASSGUY BASS",
    201: "VIBRA-KING FAT",
    202: "SPAWN ROD OD1-1",
    203: "SPAWN ROD OD1-2",
    204: "SPAWN ROD OD1-3",
    205: "CA TUCANA CLN",
    206: "BRIT JVM OD1 RD",
    207: "BRIT JVM OD2 RD",
    208: "CAMERON CCV 1B",
    209: "CAMERON CCV 2B",
    210: "CAMERON CCV 2C",
    211: "CAMERON CCV 2D",
    212: "FRIEDMAN SM BOX",
    213: "5153 50W BLUE",
    214: "DIV/13 CJ BOOST",
    215: "USA IIC+ DEEP",
    216: "USA IIC+ BRT/DP",
    217: "5F8 TWEED",
    218: "DOUBLE VERB SF",
    219: "VIBRATO VERB CS",
    220: "JMPRE-1 OD1",
    221: "JMPRE-1 OD2",
    222: "JMPRE-1 OD1 BS",
    223: "JMPRE-1 OD2 BS",
    224: "DELUXE VERB NRM",
    225: "DOUBLE VERB NRM",
    226: "SUPER VERB NRM",
    227: "BLUDOJAI LD 2",
    228: "PLEXI 50W 6550",
    229: "FAS HOT ROD",
    230: "PVH 6160+ RHY B",
    231: "PVH 6160+ RHY",
    232: "SOLO 88 CLEAN",
    233: "CLASS-A 30W BRT",
    234: "PLEXI 50W HI 2",
    235: "SPAWN NITROUS 1",
    236: "RUBY ROCKET BRT",
    237: "AC-20 12AX7 B",
    238: "PLEXI 100W 1970",
    239: "JS410 LEAD OR",
    240: "JS410 LEAD RD",
    241: "JS410 CRUNCH OR",
    242: "JS410 CRUNCH RD",
    243: "FRIEDMAN BE V2",
    244: "FRIEDMAN HBE V2",
    245: "DWEEZIL'S B-MAN",
    246: "FRIEDMAN BE",
    247: "FRIEDMAN HBE",
    248: "USA IIC++",
    249: "LEGATO 100",
    250: "CAPT HOOK 2B",
    251: "CAPT HOOK 3B",
    252: "CAPT HOOK 2A",
    253: "CAPT HOOK 3A",
    254: "CAPT HOOK 1A",
    255: "CAPT HOOK 1B",
    256: "DIRTY SHIRLEY 2",
    257: "BRIT 800 #34",
    258: "5F1 TWEED EC",
});

export const AMP_TONE_LOCATION_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "PRE",
    1: "POST",
    2: "MID",
    3: "END",
});

export const AMP_INPUT_SELECT_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "Left",
    1: "Right",
    2: "SUM L+R",
});

export const AMP_BYPASS_MODE_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "Left",
    1: "Right",
    2: "SUM L+R",
});

export const AMP_TONE_STACK_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "ACTIVE",
    1: "DEFAULT",
    2: "BROWNFACE",
    3: "BLACKFACE",
    4: "BASSGUY",
    5: "TOP BOOST",
    6: "PLEXI",
    7: "BOUTIQUE",
    8: "HI POWER",
    9: "USA NORMAL",
    10: "USA FAT",
    11: "RECTO1 ORG",
    12: "RECTO1 RED",
    13: "SKYLINE",
    14: "GERMAN",
    15: "JR BLUES",
    16: "WRECKER 1",
    17: "NEUTRAL",
    18: "CA3+SE",
    19: "FREYER D60",
    20: "MR Z 38 SR",
    21: "EURO UBER",
    22: "PVH 6160",
    23: "SOLO 100",
    24: "CORNCOB",
    25: "XTC",
    26: "CAROLANN",
    27: "CITRUS",
    28: "BRIT JM45",
    29: "USA RHY",
    30: "RECTO2 ORG",
    31: "RECTO2 RED",
    32: "SHIVER CLN",
    33: "CAMERON",
    34: "BRIT JVM 0D1",
    35: "BRIT JVM 0D2",
    36: "5153 GREEN",
    37: "5153 BLUE",
    38: "5153 RED",
    39: "BRIT SUPER",
    40: "DIV13 CJ",
    41: "BADGER 18",
    42: "ATOMICA",
    43: "SPAWN",
    44: "BADGER 30",
    45: "BRIT SILVER",
    46: "SUPER VERB",
    47: "HOT KITTY",
    48: "VIBRATO-KING",
    49: "GIBTONE SCOUT",
    50: "CA3+SE CLEAN",
    51: "BF FIXED MID",
    52: "GERMAN V4",
    53: "VIBRATO-LUX",
    54: "DIRTY SHIRLEY",
    55: "PLEXI 100W",
    56: "RUBY ROCKET BRT",
    57: "CONCOURSE",
    58: "TRIPTIK LD",
    59: "TRIPTIK CLN",
    60: "JAZZ 120",
    61: "BOGFISH",
    62: "WRECKER 2",
    63: "SKYLINE DEEP",
    64: "USA SUB BLUES",
    65: "WRECKER LVRPOOL",
    66: "CITRUS A30 CLN",
    67: "CITRUS A30 DRT",
    68: "CAR ROAMER",
    69: "USA BASS",
    70: "CITRUS BASS",
    71: "STUDIO",
    72: "BRIT 800",
    73: "RECTO1 ORG MDRN",
    74: "ANGLE SEVERE 1",
    75: "ANGLE SEVERE 2",
    76: "USA PRE LD1 RED",
    77: "RECTO ORG BRT",
    78: "RECTO RED BRT",
    79: "VIBROVERB AA",
    80: "PVH 6160 II LD",
    81: "RUMBLE HRM",
    82: "MR Z HWY 66",
    83: "SUPER 6G4",
    84: "65 BASSMAN BASS",
    85: "FREIDMAN",
    86: "BAND-COMMANDER",
    87: "USA PRE CLEAN",
    88: "TUCANA CLEAN",
    89: "FRIEDMAN SM BOX",
    90: "TX STAR",
    91: "USA IIC+",
    92: "THORDENDAL",
    93: "SOLO 99",
    94: "BLUDOJAI",
    95: "HERBIE",
    96: "PVH 6160 II RHY",
    97: "SOLO 88 CLEAN",
    98: "JS410",
    99: "JS410 MIDSHIFT",
    100: "RUBY ROCKET",
    101: "USA IIC++",
    102: "LEGATO 100",
    103: "HOOK EDGE",
    104: "HOOK NO EDGE",
    105: "HOOK CLEAN 1",
    106: "HOOK CLEAN 2",
    107: "SOLO 88",
});

export const AMP_MV_LOCATION_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "PRE-PI",
    1: "POST-PI",
    2: "PRE-TRIODE",
});

export const AMP_SAT_SWITCH_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "OFF",
    1: "AUTH",
    2: "IDEAL",
});

export const AMP_PWR_AMP_TUBE_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "IDEAL TETRODE",
    1: "IDEAL PENTODE",
    2: "EL34/6CA7",
    3: "EL84/6BQ5",
    4: "6L6/5881",
    5: "6V6",
    6: "KT66",
    7: "KT88",
    8: "6550",
    9: "6973",
    10: "6AQ5",
    11: "300B",
});

export const AMP_PREAMP_TUBES_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "12AX7A SYL",
    1: "ECC83",
    2: "7025",
    3: "12AX7A JJ",
    4: "ECC803S",
    5: "EF86",
    6: "12AX7A RCA",
    7: "12AX7A",
    8: "12AX7B",
});

export const AMP_POWER_TYPE_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "AC",
    1: "DC",
});

export const AMP_EQ_TYPE_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "8 BAND VAR Q",
    1: "7 BAND VAR Q",
    2: "5 BAND (MARK)",
    3: "8 BAND CONST Q",
    4: "7 BAND CONST Q",
    5: "5 BAND CONST Q",
    6: "5 BAND PASSIVE",
    7: "4 BAND PASSIVE",
    8: "3 BAND PASSIVE",
    9: "3 BAND CONSOLE",
});

export const AMP_CHAR_TYPE_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "SHELVING",
    1: "PEAKING",
    2: "DYNAMIC",
});

export const AMP_OUT_COMP_TYPE_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "OUTPUT",
    1: "FEEDBACK",
});

export const AMP_EQ_LOCATION_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "POST P.A.",
    1: "PRE P.A.",
});

export const AMP_CF_COMP_TYPE_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "AUTHENTIC",
    1: "IDEAL",
});

export const CAB_MIC_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "None",
    1: "57 DYN",
    2: "58 DYN",
    3: "421 DYN",
    4: "87A COND",
    5: "U87 COND",
    6: "E609 DYN",
    7: "RE16 DYN",
    8: "R121 RIB",
    9: "D112 DYN",
    10: "67 COND",
    11: "NULL",
    12: "INVERT",
});

export const CAB_MIC_R_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "None",
    1: "57 DYN",
    2: "58 DYN",
    3: "421 DYN",
    4: "87A COND",
    5: "U87 COND",
    6: "E609 DYN",
    7: "RE16 DYN",
    8: "R121 RIB",
    9: "D112 DYN",
    10: "67 COND",
    11: "NULL",
    12: "INVERT",
});

export const CAB_BYPASS_MODE_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "THRU",
    1: "MUTE",
});

export const CAB_EFFECT_TYPE_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "HI-/ULTRA-RES",
    1: "NORMAL RES",
    2: "STEREO",
    3: "STEREO ULTRARES",
});

export const CAB_INPUT_SELECT_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "STEREO",
    1: "Left",
    2: "Right",
    3: "SUM L+R",
});

export const CAB_PREAMP_TYPE_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "None",
    1: "TUBE",
    2: "BIPOLAR",
    3: "FET I",
    4: "FET II",
    5: "TRANSFORMER",
    6: "TAPE 70us",
    7: "TAPE 50us",
    8: "TAPE 35us",
    9: "VINTAGE",
    10: "MODERN",
    11: "EXCITER",
});

export const CAB_PREAMP_MODE_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "ECONOMY",
    1: "HIGH QUALITY",
});

export const CAB_FILTER_SLOPE_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "6 dB/OCT",
    1: "12 dB/OCT",
});

export const CHORUS_EFFECT_TYPE_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "DIGITAL MONO",
    1: "DIGITAL STEREO",
    2: "ANALOG MONO",
    3: "ANALOG STEREO",
    4: "JAPan CE-2",
    5: "WARM STEREO",
    6: "80'S STYLE",
    7: "TRIANGLE CHORUS",
    8: "8-VOICE STEREO",
    9: "VINTAGE TAPE",
    10: "DIMENSION 1",
    11: "DIMENSION 2",
    12: "4-VOICE ANALOG",
});

export const CHORUS_LFO_TYPE_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "SINE",
    1: "TRIANGLE",
    2: "SQUARE",
    3: "SAW UP",
    4: "SAW DOWN",
    5: "RANDOM",
    6: "LOG",
    7: "EXP",
    8: "TRAPEZOID",
});

export const CHORUS_AUTO_DEPTH_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "OFF",
    1: "LOW",
    2: "HIGH",
});

export const CHORUS_BYPASS_MODE_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "THRU",
    1: "MUTE FX OUT",
    2: "MUTE OUT",
});

export const CHORUS_PHASE_REVERSE_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "None",
    1: "Right",
    2: "Left",
    3: "Both",
});

export const CHORUS_DIMENSION_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "OFF",
    1: "LOW",
    2: "MED",
    3: "HIGH",
});

export const COMPRESSOR_KNEE_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "HARD",
    1: "SOFT",
    2: "SOFTER",
    3: "SOFTEST",
});

export const COMPRESSOR_DETECT_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "RMS",
    1: "PEAK",
    2: "RMS+PEAK",
    3: "FAST RMS",
});

export const COMPRESSOR_SIDECHAIN_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "BLOCK L+R",
    1: "ROW 1",
    2: "ROW 2",
    3: "ROW 3",
    4: "ROW 4",
    5: "INPUT 1",
    6: "INPUT 2",
    7: "BLOCK L",
    8: "BLOCK R",
});

export const COMPRESSOR_EFFECT_TYPE_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "STUDIO COMP",
    1: "PEDAL COMP 1",
    2: "PEDAL COMP 2",
    3: "DYNAMICS",
    4: "OPTICAL 1",
    5: "OPTICAL 2",
});

export const COMPRESSOR_BYPASS_MODE_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "THRU",
    1: "MUTE FX OUT",
    2: "MUTE OUT",
});

export const COMPRESSOR_INPUT_LEVEL_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "INSTRUMENT",
    1: "LINE",
});

export const CONTROLLERS_LFO1_TYPE_RUN_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "SINE",
    1: "TRIANGLE",
    2: "SQUARE",
    3: "SAW UP",
    4: "SAW DOWN",
    5: "RANDOM",
    6: "LOG",
    7: "EXP",
    8: "TRAPEZOID",
});

export const CONTROLLERS_LFO2_TYPE_RUN_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "SINE",
    1: "TRIANGLE",
    2: "SQUARE",
    3: "SAW UP",
    4: "SAW DOWN",
    5: "RANDOM",
    6: "LOG",
    7: "EXP",
    8: "TRAPEZOID",
});

export const CONTROLLERS_MODE_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "ONCE",
    1: "LOOP",
    2: "SUST",
});

export const CONTROLLERS_TEMPO_SETTING_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "PRESET",
    1: "GLOBAL",
});

export const CONTROLLERS_STAGES_VALUES: Readonly<Record<number, string>> = Object.freeze({
    2: "2",
    3: "3",
    4: "4",
    5: "5",
    6: "6",
    7: "7",
    8: "8",
    9: "9",
    10: "10",
    11: "11",
    12: "12",
    13: "13",
    14: "14",
    15: "15",
    16: "16",
    17: "17",
    18: "18",
    19: "19",
    20: "20",
    21: "21",
    22: "22",
    23: "23",
    24: "24",
    25: "25",
    26: "26",
    27: "27",
    28: "28",
    29: "29",
    30: "30",
    31: "31",
    32: "32",
});

export const CONTROLLERS_QUANTIZE_VALUES: Readonly<Record<number, string>> = Object.freeze({
    1: "OFF",
    2: "2",
    3: "3",
    4: "4",
    5: "5",
    6: "6",
    7: "7",
    8: "8",
    9: "9",
    10: "10",
    11: "11",
    12: "12",
    13: "13",
    14: "14",
    15: "15",
    16: "16",
    17: "17",
    18: "18",
    19: "19",
    20: "20",
    21: "21",
    22: "22",
    23: "23",
    24: "24",
    25: "25",
    26: "26",
    27: "27",
    28: "28",
    29: "29",
    30: "30",
    31: "31",
    32: "32",
});

export const CROSSOVER_FREQ_MULTI_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "X 1",
    1: "X 10",
});

export const CROSSOVER_BYPASS_MODE_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "THRU",
    1: "MUTE",
});

export const DELAY_EFFECT_TYPE_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "DIGITAL MONO",
    1: "DIGITAL STEREO",
    2: "ANALOG MONO",
    3: "ANALOG STEREO",
    4: "MONO TAPE",
    5: "STEREO TAPE",
    6: "PING-PONG",
    7: "DUAL DELAY",
    8: "REVERSE DELAY",
    9: "SWEEP DELAY",
    10: "DUCKING DELAY",
    11: "VINTAGE DIGITAL",
    12: "2290 W/ MOD",
    13: "AMBIENT STEREO",
    14: "DELUXE MIND GUY",
    15: "MONO BBD",
    16: "STEREO BBD",
    17: "LO-FI TAPE",
});

export const DELAY_CONFIG_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "MONO",
    1: "STEREO",
    2: "PING-PONG",
    3: "DUAL",
    4: "REVERSE",
    5: "SWEEP",
    6: "TAPE",
});

export const DELAY_BYPASS_MODE_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "THRU",
    1: "MUTE FX OUT",
    2: "MUTE OUT",
    3: "MUTE FX IN",
    4: "MUTE IN",
});

export const DELAY_LFO1_TYPE_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "SINE",
    1: "TRIANGLE",
    2: "SQUARE",
    3: "SAW UP",
    4: "SAW DOWN",
    5: "RANDOM",
    6: "LOG",
    7: "EXP",
    8: "TRAPEZOID",
});

export const DELAY_LFO2_TYPE_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "SINE",
    1: "TRIANGLE",
    2: "SQUARE",
    3: "SAW UP",
    4: "SAW DOWN",
    5: "RANDOM",
    6: "LOG",
    7: "EXP",
    8: "TRAPEZOID",
});

export const DELAY_FILTER_SLOPE_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "6 dB/OCT",
    1: "12 dB/OCT",
    2: "24 dB/OCT",
    3: "36 dB/OCT",
    4: "48 dB/OCT",
});

export const DELAY_PHASE_REVERSE_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "None",
    1: "Right",
    2: "Left",
    3: "Both",
});

export const DELAY_LFO1_TARGET_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "Both",
    1: "Left",
    2: "Right",
});

export const DELAY_LFO2_TARGET_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "Both",
    1: "Left",
    2: "Right",
});

export const DELAY_SWEEP_TYPE_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "SINE",
    1: "TRIANGLE",
    2: "SQUARE",
    3: "SAW UP",
    4: "SAW DOWN",
    5: "RANDOM",
    6: "LOG",
    7: "EXP",
    8: "TRAPEZOID",
});

export const DELAY_LFO1_DEPTH_RANGE_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "LOW",
    1: "HIGH",
});

/**
 * Delay tempo-sync division enum — hardware-measured 2026-05-11 via
 * HW-091 (wire 0..8) and HW-093 (wire 9..32). Wire 33+ not yet
 * probed; the device likely saturates at wire 32 or rejects further.
 *
 * Pattern: wire 0 = NONE (disables sync); wires 1..21 are the
 * canonical musical-division ladder TRIP/straight/DOT in increasing
 * note-value; wires 22..24 are integer bar multiples; wires 25..26
 * are polymeter ratios (4/3, 5/4); wires 27..32 are odd-numerator
 * 64th-note ratios where 10/64 is parens-displayed as (5/32) — the
 * Axe-Fx II firmware's "reduced fraction" convention (parens =
 * computed value, same convention as tempo-gated `(375 ms)` on
 * delay.time).
 */
export const DELAY_TEMPO_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "NONE",
    1: "1/64 TRIP",
    2: "1/64",
    3: "1/64 DOT",
    4: "1/32 TRIP",
    5: "1/32",
    6: "1/32 DOT",
    7: "1/16 TRIP",
    8: "1/16",
    9: "1/16 DOT",
    10: "1/8 TRIP",
    11: "1/8",
    12: "1/8 DOT",
    13: "1/4 TRIP",
    14: "1/4",
    15: "1/4 DOT",
    16: "1/2 TRIP",
    17: "1/2",
    18: "1/2 DOT",
    19: "1 TRIP",
    20: "1",
    21: "1 DOT",
    22: "2",
    23: "3",
    24: "4",
    25: "4/3",
    26: "5/4",
    27: "5/64",
    28: "7/64",
    29: "9/64",
    30: "10/64 (5/32)",
    31: "11/64",
    32: "13/64",
});

export const DRIVE_EFFECT_TYPE_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "RAT DIST",
    1: "PI FUZZ",
    2: "TUBE DRV 3-KNOB",
    3: "SUPER OD",
    4: "TREBLE BOOST",
    5: "MID BOOST",
    6: "T808 OD",
    7: "FAT RAT",
    8: "T808 MOD",
    9: "OCTAVE DIST",
    10: "PLUS DIST",
    11: "HARD FUZZ",
    12: "FET BOOST",
    13: "TAPE DIST",
    14: "FULL OD",
    15: "BLUES OD",
    16: "SHRED DIST",
    17: "M-ZONE DIST",
    18: "BENDER FUZZ",
    19: "BB PRE",
    20: "MASTER FUZZ",
    21: "FACE FUZZ",
    22: "BIT CRUSHER",
    23: "ETERNAL LOVE",
    24: "ESOTERIC ACB",
    25: "ESOTERIC RCB",
    26: "ZEN MASTER",
    27: "TUBE DRV 4-KNOB",
    28: "FAS LED-DRIVE",
    29: "SDD PREAMP",
    30: "FET PREAMP",
    31: "RUCKUS",
    32: "MICRO BOOST",
    33: "FAS BOOST",
    34: "TIMOTHY",
    35: "SHIMMER DRIVE",
});

export const DRIVE_BYPASS_MODE_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "THRU",
    1: "MUTE",
});

export const DRIVE_CLIP_TYPE_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "LV TUBE",
    1: "HARD",
    2: "SOFT",
    3: "GERMANIUM",
    4: "FW RECT",
    5: "HV TUBE",
    6: "SILICON",
    7: "4558/DIODE",
    8: "LED",
    9: "FET",
    10: "OP-AMP",
    11: "VARIABLE",
    12: "NULL",
});

export const DRIVE_INPUT_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "L+R",
    1: "Left",
    2: "Right",
});

export const EFFECTSLOOP_BYPASS_MODE_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "THRU",
    1: "MUTE",
});

export const ENHANCER_EFFECT_TYPE_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "MODERN",
    1: "CLASSIC",
});

export const ENHANCER_INVERT_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "None",
    1: "Right",
    2: "Left",
    3: "Both",
});

export const FEEDBACKRETURN_BYPASS_MODE_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "THRU",
    1: "MUTE",
});

export const FILTER_EFFECT_TYPE_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "NULL",
    1: "LOWPASS",
    2: "BANDPASS",
    3: "HIGHPASS",
    4: "LOWSHELF",
    5: "HIGHSHLF",
    6: "PEAKING",
    7: "NOTCH",
    8: "TILT EQ",
    9: "LOWSHELF2",
    10: "HIGHSHLF2",
    11: "PEAKING2",
});

export const FILTER_BYPASS_MODE_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "THRU",
    1: "MUTE",
});

export const FILTER_ORDER_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "2nd",
    1: "4th",
});

export const FILTER_INVERT_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "None",
    1: "Right",
    2: "Left",
    3: "Both",
});

export const FLANGER_EFFECT_TYPE_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "DIGITAL MONO",
    1: "DIGITAL STEREO",
    2: "ANALOG MONO",
    3: "ANALOG STEREO",
    4: "THRU-ZERO",
    5: "STEREO JET",
    6: "ZERO FLANGER",
    7: "POP FLANGER",
});

export const FLANGER_LFO_TYPE_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "SINE",
    1: "TRIANGLE",
    2: "SQUARE",
    3: "SAW UP",
    4: "SAW DOWN",
    5: "RANDOM",
    6: "LOG",
    7: "EXP",
    8: "TRAPEZOID",
});

export const FLANGER_AUTO_DEPTH_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "OFF",
    1: "LOW",
    2: "MED",
    3: "HIGH",
});

export const FLANGER_BYPASS_MODE_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "THRU",
    1: "MUTE FX OUT",
    2: "MUTE OUT",
});

export const FLANGER_PHASE_REVERSE_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "None",
    1: "Right",
    2: "Left",
    3: "Both",
});

export const FORMANT_START_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "AAA",
    1: "EEE",
    2: "III",
    3: "OHH",
    4: "OOO",
    5: "EHH",
    6: "AHH",
    7: "AWW",
    8: "UHH",
    9: "ERR",
});

export const FORMANT_MID_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "AAA",
    1: "EEE",
    2: "III",
    3: "OHH",
    4: "OOO",
    5: "EHH",
    6: "AHH",
    7: "AWW",
    8: "UHH",
    9: "ERR",
});

export const FORMANT_END_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "AAA",
    1: "EEE",
    2: "III",
    3: "OHH",
    4: "OOO",
    5: "EHH",
    6: "AHH",
    7: "AWW",
    8: "UHH",
    9: "ERR",
});

export const FORMANT_BYPASS_MODE_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "THRU",
    1: "MUTE FX OUT",
    2: "MUTE OUT",
});

export const GATEEXPANDER_SIDECHAIN_SELECT_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "BLOCK L+R",
    1: "ROW 1",
    2: "ROW 2",
    3: "ROW 3",
    4: "ROW 4",
    5: "INPUT 1",
    6: "INPUT 2",
});

export const GATEEXPANDER_BYPASS_MODE_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "THRU",
    1: "MUTE",
});

export const GRAPHICEQ_BYPASS_MODE_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "THRU",
    1: "MUTE",
});

export const GRAPHICEQ_EFFECT_TYPE_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "10 BAND CONST Q",
    1: "8 BAND CONST Q",
    2: "7 BAND CONST Q",
    3: "5 BAND CONST Q",
    4: "10 BAND VAR Q",
    5: "8 BAND VAR Q",
    6: "7 BAND VAR Q",
    7: "5 BAND VAR Q",
    8: "5 BAND PASSIVE",
    9: "4 BAND PASSIVE",
    10: "3 BAND PASSIVE",
    11: "3 BAND CONSOLE",
});

export const INPUT_INPUT_Z_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "AUTO:",
    1: "1M",
    2: "1M+CAP",
    3: "230K",
    4: "230K+CAP",
    5: "90K",
    6: "90K+CAP",
    7: "70K",
    8: "70K+CAP",
    9: "32K",
    10: "32K+CAP",
    11: "22K",
    12: "22K+CAP",
});

export const INPUT_EFFECT_TYPE_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "CLASSIC",
    1: "INTELLIGENT",
});

export const LOOPER_BYPASS_MODE_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "THRU",
    1: "MUTE FX OUT",
    2: "MUTE OUT",
});

export const LOOPER_MODE_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "MONO",
    1: "STEREO",
    2: "MONO UNDO",
    3: "STEREO UNDO",
});

export const LOOPER_QUANTIZE_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "OFF",
    1: "QUARTER",
    2: "EIGTH",
    3: "SIXTEENTH",
});

export const MIXER_OUT_MODE_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "STEREO",
    1: "MONO",
});

export const MULTIBANDCOMP_DETECT_1_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "RMS",
    1: "PEAK",
    2: "FAST RMS",
});

export const MULTIBANDCOMP_DETECT_2_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "RMS",
    1: "PEAK",
    2: "FAST RMS",
});

export const MULTIBANDCOMP_DETECT_3_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "RMS",
    1: "PEAK",
    2: "FAST RMS",
});

export const MULTIBANDCOMP_BYPASS_MODE_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "THRU",
    1: "MUTE",
});

export const MULTIDELAY_BYPASS_MODE_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "THRU",
    1: "MUTE FX OUT",
    2: "MUTE OUT",
    3: "MUTE FX IN",
    4: "MUTE IN",
});

export const MULTIDELAY_EFFECT_TYPE_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "QUAD-TAP",
    1: "PLEX DELAY",
    2: "PLEX DETUNE",
    3: "PLEX SHIFT",
    4: "BAND DELAY",
    5: "QUAD-SERIES",
    6: "TEN-TAP DLY",
    7: "RHYTHM TAP",
    8: "DIFFUSOR",
    9: "QUAD TAPE DLY",
});

export const MULTIDELAY_DIRECTION_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "FORWARD",
    1: "REVERSE",
});

export const MULTIDELAY_FB_SEND_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "1",
    1: "2",
    2: "3",
    3: "4",
});

export const MULTIDELAY_FB_RETURN_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "1",
    1: "2",
    2: "3",
    3: "4",
});

export const MULTIDELAY_MONO_STEREO_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "MONO",
    1: "STEREO",
});

export const MULTIDELAY_PAN_SHAPE_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "CONSTANT",
    1: "INCREASING",
    2: "DECREASING",
    3: "UP / DOWN",
    4: "DOWN / UP",
    5: "SINE",
});

export const OUTPUT_BYPASS_MODE_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "THRU",
    1: "MUTE",
});

export const PANTREM_EFFECT_TYPE_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "TREMOLO",
    1: "PanNER",
});

export const PANTREM_LFO_TYPE_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "SINE",
    1: "TRIANGLE",
    2: "SQUARE",
    3: "SAW UP",
    4: "SAW DOWN",
    5: "RANDOM",
    6: "LOG",
    7: "EXP",
    8: "TRAPEZOID",
});

export const PANTREM_BYPASS_MODE_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "THRU",
    1: "MUTE",
});

export const PARAMETRICEQ_FREQ_TYPE_1_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "SHELVING",
    1: "PEAKING",
    2: "BLOCKING",
    3: "SHELVING2",
});

export const PARAMETRICEQ_FREQ_TYPE_5_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "SHELVING",
    1: "PEAKING",
    2: "BLOCKING",
    3: "SHELVING2",
});

export const PARAMETRICEQ_FREQ_TYPE_2_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "PEAKING",
    1: "SHELVING",
    2: "SHELVING2",
});

export const PARAMETRICEQ_FREQ_TYPE_4_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "PEAKING",
    1: "SHELVING",
    2: "SHELVING2",
});

export const PARAMETRICEQ_BYPASS_MODE_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "THRU",
    1: "MUTE",
});

export const PHASER_EFFECT_TYPE_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "DIGITAL MONO",
    1: "DIGITAL STEREO",
    2: "SCRIPT 45",
    3: "SCRIPT 90",
    4: "BLOCK 90",
    5: "CLASSIC VIBE",
    6: "STEREO 8-STAGE",
    7: "BARBERPOLE",
});

export const PHASER_ORDER_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "2",
    1: "4",
    2: "6",
    3: "8",
    4: "10",
    5: "12",
});

export const PHASER_LFO_TYPE_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "SINE",
    1: "TRIANGLE",
    2: "SQUARE",
    3: "SAW UP",
    4: "SAW DOWN",
    5: "RANDOM",
    6: "LOG",
    7: "EXP",
    8: "TRAPEZOID",
});

export const PHASER_BYPASS_MODE_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "THRU",
    1: "MUTE FX OUT",
    2: "MUTE OUT",
});

export const PHASER_MODE_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "NORMAL",
    1: "VIBE",
    2: "BARBERPOLE",
});

export const PHASER_DIRECTION_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "UP",
    1: "DOWN",
});

export const PHASER_LFO_BYPASS_RESET_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "OFF",
    1: "0 DEG",
    2: "90 DEG",
    3: "180 DEG",
    4: "270 DEG",
});

export const PITCH_EFFECT_TYPE_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "DETUNE",
    1: "FIXED HARM",
    2: "INTEL HARM",
    3: "CL. WHAMMY",
    4: "OCTAVE DIV",
    5: "CRYSTALS",
    6: "AD. WHAMMY",
    7: "ARPEGGIATOR",
    8: "CUST. SHIFT",
});

export const PITCH_MODE_VALUES: Readonly<Record<number, string>> = Object.freeze({
    5: "UP|DN 2 OCT",
});

export const PITCH_KEY_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "A",
    1: "Bb",
    2: "B",
    3: "C",
    4: "Db",
    5: "D",
    6: "Eb",
    7: "E",
    8: "F",
    9: "Gb",
    10: "G",
    11: "Ab",
});

export const PITCH_SCALE_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "IONIAN MAJ",
    1: "DORIAN",
    2: "PHRYGIAN",
    3: "LYDIAN",
    4: "MIXOLYDIAN",
    5: "AEOLIAN MIN",
    6: "LOCRIAN",
    7: "MEL. MINOR",
    8: "HARM. MINOR",
    9: "DIMINISHED",
    10: "WHOLE TONE",
    11: "DOM. SEVEN",
    12: "DIM. WHOLE",
    13: "PENTA. MAJ",
    14: "PENTA. MIN",
    15: "BLUES",
    16: "CHROMATIC",
    17: "CUSTOM",
});

export const PITCH_TRACK_MODE_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "SMOOTH",
    1: "STEPPED",
});

export const PITCH_PITCH_TRACK_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "OFF",
    1: "POLY",
    2: "MONO",
});

export const PITCH_BYPASS_MODE_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "THRU",
    1: "MUTE FX OUT",
    2: "MUTE OUT",
    3: "MUTE FX IN",
    4: "MUTE IN",
});

export const PITCH_FEEDBACK_TYPE_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "DUAL",
    1: "Both",
    2: "PING-PONG",
});

export const PITCH_NOTES_VALUES: Readonly<Record<number, string>> = Object.freeze({
    4: "4",
    5: "5",
    6: "6",
    7: "7",
    8: "8",
});

export const PITCH_REPEATS_VALUES: Readonly<Record<number, string>> = Object.freeze({
    1: "1",
    2: "2",
    3: "3",
    4: "4",
    5: "5",
    6: "6",
    7: "7",
    8: "8",
    9: "9",
    10: "10",
    11: "11",
    12: "12",
    13: "13",
    14: "14",
    15: "15",
    16: "16",
    17: "17",
    18: "18",
    19: "19",
    20: "20",
    21: "21",
    22: "22",
    23: "23",
    24: "24",
    25: "25",
    26: "26",
    27: "27",
    28: "28",
    29: "29",
    30: "30",
    31: "Infinite",
});

export const PITCH_AMPLITUBE_SHAPE_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "CONSTANT",
    1: "INCREASING",
    2: "DECREASING",
    3: "UP / DOWN",
    4: "DOWN / UP",
    5: "SINE",
});

export const PITCH_PAN_SHAPE_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "CONSTANT",
    1: "INCREASING",
    2: "DECREASING",
    3: "UP / DOWN",
    4: "DOWN / UP",
    5: "SINE",
});

export const PITCH_PITCH_SOURCE_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "GLOBAL",
    1: "LOCAL",
});

export const PITCH_INPUT_MODE_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "MONO",
    1: "STEREO",
});

export const REVERB_EFFECT_TYPE_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "SMALL ROOM",
    1: "MEDIUM ROOM",
    2: "LARGE ROOM",
    3: "SMALL HALL",
    4: "MEDIUM HALL",
    5: "LARGE HALL",
    6: "SMALL CHAMBER",
    7: "MEDIUM CHAMBER",
    8: "LARGE CHAMBER",
    9: "SMALL PLATE",
    10: "MEDIUM PLATE",
    11: "LARGE PLATE",
    12: "SMALL CATHEDRAL",
    13: "MED. CATHEDRAL",
    14: "LARGE CATHEDRAL",
    15: "SMALL SPRING",
    16: "MEDIUM SPRING",
    17: "LARGE SPRING",
    18: "CAVERN",
    19: "STONE QUARRY",
    20: "STUDIO",
    21: "AMBIENCE",
    22: "CONCERT HALL",
    23: "LARGE DEEP HALL",
    24: "REC STUDIO C",
    25: "NORTH CHURCH",
    26: "SOUTH CHURCH",
    27: "LONDON PLATE",
    28: "SUN PLATE",
    29: "HUGE ROOM",
    30: "DRUM ROOM",
    31: "HALLWAY",
    32: "TUNNEL",
    33: "DEEP CHAMBER",
    34: "LG WOODEN ROOM",
    35: "GYMNASIUM",
    36: "ASYLUM HALL",
    37: "DEEP SPACE",
    38: "REC STUDIO A",
    39: "LG TILED ROOM",
    40: "VOCAL PLATE",
    41: "WIDE HALL",
    42: "RICH HALL",
});

export const REVERB_BYPASS_MODE_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "THRU",
    1: "MUTE FX OUT",
    2: "MUTE OUT",
    3: "MUTE FX IN",
    4: "MUTE IN",
});

export const REVERB_QUALITY_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "NORMAL",
    1: "HIGH",
});

export const RINGMOD_BYPASS_MODE_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "THRU",
    1: "MUTE FX OUT",
    2: "MUTE OUT",
});

export const ROTARY_BYPASS_MODE_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "THRU",
    1: "MUTE FX OUT",
    2: "MUTE OUT",
});

export const SYNTH_TYPE_1_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "SINE",
    1: "TRIANGLE",
    2: "SQUARE",
    3: "SAWTOOTH",
    4: "RANDOM",
    5: "WHT NOISE",
    6: "PINK NOISE",
    7: "OFF",
});

export const SYNTH_TRACK_1_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "OFF",
    1: "ENV ONLY",
    2: "PITCH+ENV",
    3: "QUANTIZE",
});

export const SYNTH_TYPE_2_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "SINE",
    1: "TRIANGLE",
    2: "SQUARE",
    3: "SAWTOOTH",
    4: "RANDOM",
    5: "WHT NOISE",
    6: "PINK NOISE",
    7: "OFF",
});

export const SYNTH_TRACK_2_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "OFF",
    1: "ENV ONLY",
    2: "PITCH+ENV",
    3: "QUANTIZE",
});

export const SYNTH_BYPASS_MODE_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "THRU",
    1: "MUTE FX OUT",
    2: "MUTE OUT",
});

export const SYNTH_TYPE_3_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "SINE",
    1: "TRIANGLE",
    2: "SQUARE",
    3: "SAWTOOTH",
    4: "RANDOM",
    5: "WHT NOISE",
    6: "PINK NOISE",
    7: "OFF",
});

export const SYNTH_TRACK_3_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "OFF",
    1: "ENV ONLY",
    2: "PITCH+ENV",
    3: "QUANTIZE",
});

export const VOLPAN_VOLUME_TAPER_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "LINEAR",
    1: "LOG 30A",
    2: "LOG 20A",
    3: "LOG 15A",
    4: "LOG 10A",
    5: "LOG 5A",
});

export const VOLPAN_BYPASS_MODE_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "THRU",
    1: "MUTE",
});

export const VOLPAN_INPUT_SELECT_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "STEREO",
    1: "Left ONLY",
    2: "Right ONLY",
});

export const WAH_EFFECT_TYPE_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "FAS STANDARD",
    1: "CLYDE",
    2: "CRY BABE",
    3: "VX846",
    4: "COLOR-TONE",
    5: "FUNK",
    6: "MORTAL",
    7: "VX845",
});

export const WAH_BYPASS_MODE_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "THRU",
    1: "MUTE",
});

export const WAH_TAPER_VALUES: Readonly<Record<number, string>> = Object.freeze({
    0: "LINEAR",
    1: "LOG 30A",
    2: "LOG 20A",
    3: "LOG 15A",
    4: "LOG 10A",
    5: "LOG 5A",
});

export const KNOWN_PARAMS = {
    "amp.effect_type": { groupCode: "AMP", block: "amp", paramId: 0, wikiName: "EFFECT TYPE", name: "effect_type", controlType: "select", enumValues: AMP_EFFECT_TYPE_VALUES },
    // HW-079 calibration (2026-05-11): hardware sweep on Q8.02 confirmed
    // wire 0..65534 ↔ display 0.00..10.00 linear for these 5 amp params,
    // with quarter-scale anchors landing exactly at 2.50/5.00/7.50/10.00.
    // Conversion: display = wire / 65534 * 10. NOT regenerated from
    // wiki/XML — the wiki doesn't document display ranges for these.
    // If you regen this file via `scripts/extract-axe-fx-ii-params.ts`
    // and these displayMin/displayMax fields disappear, re-apply from
    // this commit. See `docs/_private/HARDWARE-TASKS-AXEFX2.md` HW-079.
    "amp.input_drive": { groupCode: "AMP", block: "amp", paramId: 1, wikiName: "INPUT DRIVE", name: "input_drive", controlType: "knob", parameterName: "DISTORT_DRIVE", xmlLabel: "Input Drive", modifierAssignable: true, gateOn: "DISTORT_DRIVETYPE", gateValues: "0,4,5", displayMin: 0, displayMax: 10 },
    "amp.bass": { groupCode: "AMP", block: "amp", paramId: 2, wikiName: "BASS", name: "bass", controlType: "knob", parameterName: "DISTORT_BASS", xmlLabel: "Bass", gateOn: "DISTORT_DRIVETYPE", gateValues: "0,4,5", displayMin: 0, displayMax: 10 },
    "amp.middle": { groupCode: "AMP", block: "amp", paramId: 3, wikiName: "MIDDLE", name: "middle", controlType: "knob", displayMin: 0, displayMax: 10 },
    "amp.treble": { groupCode: "AMP", block: "amp", paramId: 4, wikiName: "TREBLE", name: "treble", controlType: "knob", displayMin: 0, displayMax: 10 },
    "amp.master_volume": { groupCode: "AMP", block: "amp", paramId: 5, wikiName: "MASTER VOLUME", name: "master_volume", controlType: "knob", parameterName: "DISTORT_MASTER", xmlLabel: "Master Volume", modifierAssignable: true, gateOn: "DISTORT_DRIVETYPE", gateValues: "0,4,5", displayMin: 0, displayMax: 10 },
    // HW-092 calibration (2026-05-11): 10..1000 Hz log10 over 2 decades.
    "amp.preamp_low_cut": { groupCode: "AMP", block: "amp", paramId: 6, wikiName: "PREAMP LOW CUT", name: "preamp_low_cut", controlType: "knob", displayMin: 10, displayMax: 1000, displayScale: 'log10' },
    // HW-092 calibration (2026-05-11): 400..40000 Hz log10 over 2 decades.
    "amp.high_cut_freq": { groupCode: "AMP", block: "amp", paramId: 7, wikiName: "HIGH CUT FREQ", name: "high_cut_freq", controlType: "knob", displayMin: 400, displayMax: 40000, displayScale: 'log10' },
    "amp.tone_freq": { groupCode: "AMP", block: "amp", paramId: 8, wikiName: "TONE FREQ", name: "tone_freq", controlType: "knob", parameterName: "DISTORT_TONEFREQ", xmlLabel: "Tone Freq" },
    "amp.xformer_grind": { groupCode: "AMP", block: "amp", paramId: 9, wikiName: "XFORMER GRIND", name: "xformer_grind", controlType: "knob", parameterName: "DISTORT_XFRMRGRIND", xmlLabel: "XFormer Grind" },
    "amp.bright_cap": { groupCode: "AMP", block: "amp", paramId: 10, wikiName: "BRight CAP", name: "bright_cap", controlType: "knob", parameterName: "DISTORT_BRIGHTCAP", xmlLabel: "Bright Cap", gateOn: "DISTORT_DRIVETYPE", gateValues: "0,4,5" },
    "amp.xformer_low_freq": { groupCode: "AMP", block: "amp", paramId: 12, wikiName: "XFORMER LOW FREQ", name: "xformer_low_freq", controlType: "knob", parameterName: "DISTORT_XFHPF", xmlLabel: "XFormer Low Freq" },
    "amp.xformer_hi_freq": { groupCode: "AMP", block: "amp", paramId: 13, wikiName: "XFORMER HI FREQ", name: "xformer_hi_freq", controlType: "knob", parameterName: "DISTORT_XFLPF", xmlLabel: "XFormer Hi Freq" },
    "amp.tone_location": { groupCode: "AMP", block: "amp", paramId: 14, wikiName: "TONE LOCATION", name: "tone_location", controlType: "select", parameterName: "DISTORT_TONELOC", xmlLabel: "Tone Location", enumValues: AMP_TONE_LOCATION_VALUES },
    "amp.input_select": { groupCode: "AMP", block: "amp", paramId: 15, wikiName: "INPUT SELECT", name: "input_select", controlType: "select", parameterName: "DISTORT_INPUTSELECT", xmlLabel: "Input Select", enumValues: AMP_INPUT_SELECT_VALUES },
    "amp.depth": { groupCode: "AMP", block: "amp", paramId: 16, wikiName: "DEPTH", name: "depth", controlType: "knob", parameterName: "DISTORT_DEPTH", xmlLabel: "Depth", gateOn: "DISTORT_DRIVETYPE", gateValues: "0,4,5" },
    "amp.supply_sag": { groupCode: "AMP", block: "amp", paramId: 19, wikiName: "SUPPLY SAG", name: "supply_sag", controlType: "knob", parameterName: "DISTORT_SUPPLYSAG", xmlLabel: "Supply Sag" },
    "amp.presence": { groupCode: "AMP", block: "amp", paramId: 20, wikiName: "PRESENCE", name: "presence", controlType: "knob", parameterName: "DISTORT_PRESENCE", xmlLabel: "Presence", gateOn: "DISTORT_DRIVETYPE", gateValues: "0,4,5" },
    "amp.level": { groupCode: "AMP", block: "amp", paramId: 21, wikiName: "Level", name: "level", controlType: "knob", parameterName: "DISTORT_LEVEL", xmlLabel: "Level" },
    // HW-089 calibration (2026-05-11): wire 0..65534 ↔ -100..+100 bipolar linear (wire 32767 = 0.0).
    "amp.balance": { groupCode: "AMP", block: "amp", paramId: 22, wikiName: "Balance", name: "balance", controlType: "knob", parameterName: "DISTORT_PAN", xmlLabel: "Balance", modifierAssignable: true, displayMin: -100, displayMax: 100 },
    "amp.bypass_mode": { groupCode: "AMP", block: "amp", paramId: 23, wikiName: "BYPASS MODE", name: "bypass_mode", controlType: "select", parameterName: "DISTORT_BYPASSMODE", xmlLabel: "Bypass Mode", enumValues: AMP_BYPASS_MODE_VALUES, modifierAssignable: true },
    "amp.neg_feedback": { groupCode: "AMP", block: "amp", paramId: 24, wikiName: "NEG FEEDBACK", name: "neg_feedback", controlType: "knob" },
    "amp.presence_freq": { groupCode: "AMP", block: "amp", paramId: 25, wikiName: "PRESENCE FREQ", name: "presence_freq", controlType: "knob", parameterName: "DISTORT_PRESFREQ", xmlLabel: "Presence Freq" },
    "amp.low_res_freq": { groupCode: "AMP", block: "amp", paramId: 26, wikiName: "LOW RES FREQ", name: "low_res_freq", controlType: "knob", parameterName: "DISTORT_SPKRLFREQ", xmlLabel: "Low Res Freq" },
    "amp.low_res": { groupCode: "AMP", block: "amp", paramId: 27, wikiName: "LOW RES", name: "low_res", controlType: "knob" },
    "amp.depth_freq": { groupCode: "AMP", block: "amp", paramId: 29, wikiName: "DEPTH FREQ", name: "depth_freq", controlType: "knob", parameterName: "DISTORT_DEPTHFREQ", xmlLabel: "Depth Freq" },
    "amp.mv_cap": { groupCode: "AMP", block: "amp", paramId: 31, wikiName: "MV CAP", name: "mv_cap", controlType: "knob", parameterName: "DISTORT_MVCAP", xmlLabel: "MV Cap" },
    "amp.harmonics": { groupCode: "AMP", block: "amp", paramId: 33, wikiName: "HARMONICS", name: "harmonics", controlType: "knob", parameterName: "DISTORT_CFCLIP", xmlLabel: "Harmonics" },
    "amp.tone_stack": { groupCode: "AMP", block: "amp", paramId: 34, wikiName: "TONE STACK", name: "tone_stack", controlType: "select", enumValues: AMP_TONE_STACK_VALUES },
    "amp.b_time_const": { groupCode: "AMP", block: "amp", paramId: 35, wikiName: "B+ TIME CONST", name: "b_time_const", controlType: "knob" },
    "amp.tube_grid_bias": { groupCode: "AMP", block: "amp", paramId: 36, wikiName: "TUBE GRID BIAS", name: "tube_grid_bias", controlType: "knob" },
    "amp.bright_switch": { groupCode: "AMP", block: "amp", paramId: 39, wikiName: "BRight SWITCH", name: "bright_switch", controlType: "switch", parameterName: "DISTORT_BRIGHT", xmlLabel: "Bright Switch", modifierAssignable: true, gateOn: "DISTORT_DRIVETYPE", gateValues: "0,4,5" },
    "amp.boost": { groupCode: "AMP", block: "amp", paramId: 40, wikiName: "BOOST", name: "boost", controlType: "switch", parameterName: "DISTORT_BOOST", xmlLabel: "Boost", modifierAssignable: true, gateOn: "DISTORT_DRIVETYPE", gateValues: "0,4,5" },
    "amp.low_res_q": { groupCode: "AMP", block: "amp", paramId: 41, wikiName: "LOW RES Q", name: "low_res_q", controlType: "knob", parameterName: "DISTORT_SPKRLFQ", xmlLabel: "Low Res Q" },
    "amp.preamp_bias": { groupCode: "AMP", block: "amp", paramId: 42, wikiName: "PREAMP BIAS", name: "preamp_bias", controlType: "knob", parameterName: "DISTORT_OFFSET2", xmlLabel: "Preamp Bias" },
    "amp.hi_freq": { groupCode: "AMP", block: "amp", paramId: 43, wikiName: "HI FREQ", name: "hi_freq", controlType: "knob", parameterName: "DISTORT_SPKRHFREQ", xmlLabel: "Hi Freq" },
    "amp.hi_resonance": { groupCode: "AMP", block: "amp", paramId: 44, wikiName: "HI RESONANCE", name: "hi_resonance", controlType: "knob", parameterName: "DISTORT_SPKRHFGAIN", xmlLabel: "Hi Resonance" },
    "amp.cut": { groupCode: "AMP", block: "amp", paramId: 45, wikiName: "CUT", name: "cut", controlType: "switch", parameterName: "DISTORT_CUT", xmlLabel: "Cut", gateOn: "DISTORT_DRIVETYPE", gateValues: "0,4,5" },
    "amp.xformer_drive": { groupCode: "AMP", block: "amp", paramId: 46, wikiName: "XFORMER DRIVE", name: "xformer_drive", controlType: "knob", parameterName: "DISTORT_XDRIVE", xmlLabel: "XFormer Drive" },
    "amp.input_trim": { groupCode: "AMP", block: "amp", paramId: 47, wikiName: "INPUT TRIM", name: "input_trim", controlType: "knob", parameterName: "DISTORT_TRIM", xmlLabel: "Input Trim", modifierAssignable: true, gateOn: "DISTORT_DRIVETYPE", gateValues: "0,4,5" },
    "amp.preamp_hardness": { groupCode: "AMP", block: "amp", paramId: 48, wikiName: "PREAMP HARDNESS", name: "preamp_hardness", controlType: "knob", parameterName: "DISTORT_HARDNESS2", xmlLabel: "Preamp Hardness" },
    "amp.mv_location": { groupCode: "AMP", block: "amp", paramId: 49, wikiName: "MV LOCATION", name: "mv_location", controlType: "select", parameterName: "DISTORT_MVPOSITION", xmlLabel: "MV Location", enumValues: AMP_MV_LOCATION_VALUES },
    "amp.speaker_drive": { groupCode: "AMP", block: "amp", paramId: 50, wikiName: "SPEAKER DRIVE", name: "speaker_drive", controlType: "knob", parameterName: "DISTORT_SPKRDRIVE", xmlLabel: "Speaker\nDrive" },
    "amp.xformer_match": { groupCode: "AMP", block: "amp", paramId: 51, wikiName: "XFORMER MATCH", name: "xformer_match", controlType: "knob", parameterName: "DISTORT_GAINDIST", xmlLabel: "XFormer Match" },
    "amp.sat_switch": { groupCode: "AMP", block: "amp", paramId: 54, wikiName: "SAT SWITCH", name: "sat_switch", controlType: "select", enumValues: AMP_SAT_SWITCH_VALUES },
    "amp.geq_band_1": { groupCode: "AMP", block: "amp", paramId: 55, wikiName: "GEQ BAND 1", name: "geq_band_1", controlType: "unknown" },
    "amp.geq_band_2": { groupCode: "AMP", block: "amp", paramId: 56, wikiName: "GEQ BAND 2", name: "geq_band_2", controlType: "unknown" },
    "amp.geq_band_3": { groupCode: "AMP", block: "amp", paramId: 57, wikiName: "GEQ BAND 3", name: "geq_band_3", controlType: "unknown" },
    "amp.geq_band_4": { groupCode: "AMP", block: "amp", paramId: 58, wikiName: "GEQ BAND 4", name: "geq_band_4", controlType: "unknown" },
    "amp.geq_band_5": { groupCode: "AMP", block: "amp", paramId: 59, wikiName: "GEQ BAND 5", name: "geq_band_5", controlType: "unknown" },
    "amp.geq_band_6": { groupCode: "AMP", block: "amp", paramId: 60, wikiName: "GEQ BAND 6", name: "geq_band_6", controlType: "unknown" },
    "amp.geq_band_7": { groupCode: "AMP", block: "amp", paramId: 61, wikiName: "GEQ BAND 7", name: "geq_band_7", controlType: "unknown" },
    "amp.geq_band_8": { groupCode: "AMP", block: "amp", paramId: 62, wikiName: "GEQ BAND 8", name: "geq_band_8", controlType: "unknown" },
    "amp.bias_excursion": { groupCode: "AMP", block: "amp", paramId: 63, wikiName: "BIAS EXCURSION", name: "bias_excursion", controlType: "knob", parameterName: "DISTORT_BIASEXCURSION", xmlLabel: "Bias Excursion" },
    "amp.triode_2_plate_freq": { groupCode: "AMP", block: "amp", paramId: 66, wikiName: "TRIODE 2 PLATE FREQ", name: "triode_2_plate_freq", controlType: "knob", parameterName: "DISTORT_FEEDFWDFREQ2", xmlLabel: "Triode 2 Plate Freq" },
    "amp.triode_1_plate_freq": { groupCode: "AMP", block: "amp", paramId: 67, wikiName: "TRIODE 1 PLATE FREQ", name: "triode_1_plate_freq", controlType: "knob", parameterName: "DISTORT_FEEDFWDFREQ1", xmlLabel: "Triode 1 Plate Freq" },
    "amp.pwr_amp_tube": { groupCode: "AMP", block: "amp", paramId: 68, wikiName: "PWR AMP TUBE", name: "pwr_amp_tube", controlType: "select", enumValues: AMP_PWR_AMP_TUBE_VALUES },
    "amp.preamp_tubes": { groupCode: "AMP", block: "amp", paramId: 69, wikiName: "PREAMP TUBES", name: "preamp_tubes", controlType: "select", enumValues: AMP_PREAMP_TUBES_VALUES },
    "amp.out_comp_clarity": { groupCode: "AMP", block: "amp", paramId: 70, wikiName: "OUT COMP CLARITY", name: "out_comp_clarity", controlType: "knob", parameterName: "DISTORT_CLARITY", xmlLabel: "Out Comp\nClarity" },
    "amp.character_q": { groupCode: "AMP", block: "amp", paramId: 71, wikiName: "CHARACTER Q", name: "character_q", controlType: "knob", parameterName: "DISTORT_HMQ", xmlLabel: "Character\nQ" },
    "amp.character_freq": { groupCode: "AMP", block: "amp", paramId: 72, wikiName: "CHARACTER FREQ", name: "character_freq", controlType: "knob", parameterName: "DISTORT_HMFREQ", xmlLabel: "Character\nFreq" },
    "amp.character_amt": { groupCode: "AMP", block: "amp", paramId: 73, wikiName: "CHARACTER AMT", name: "character_amt", controlType: "knob", parameterName: "DISTORT_HMRATIO", xmlLabel: "Character\nAmt" },
    "amp.overdrive": { groupCode: "AMP", block: "amp", paramId: 74, wikiName: "OVERDRIVE", name: "overdrive", controlType: "knob", parameterName: "DISTORT_DRIVE2", xmlLabel: "Overdrive", gateOn: "DISTORT_DRIVETYPE", gateValues: "1" },
    "amp.out_comp_amount": { groupCode: "AMP", block: "amp", paramId: 75, wikiName: "OUT COMP AMOUNT", name: "out_comp_amount", controlType: "knob", parameterName: "DISTORT_COMPRESSION", xmlLabel: "Out Comp\nAmount", modifierAssignable: true },
    "amp.out_comp_threshold": { groupCode: "AMP", block: "amp", paramId: 76, wikiName: "OUT COMP THRESHOLD", name: "out_comp_threshold", controlType: "knob", parameterName: "DISTORT_THRESHOLD", xmlLabel: "Out Comp\nThreshold" },
    "amp.master_trim": { groupCode: "AMP", block: "amp", paramId: 77, wikiName: "MASTER TRIM", name: "master_trim", controlType: "knob", modifierAssignable: true },
    "amp.fat": { groupCode: "AMP", block: "amp", paramId: 78, wikiName: "FAT", name: "fat", controlType: "switch", parameterName: "DISTORT_FAT", xmlLabel: "Fat", gateOn: "DISTORT_DRIVETYPE", gateValues: "0,4,5" },
    "amp.definition": { groupCode: "AMP", block: "amp", paramId: 79, wikiName: "DEFINITION", name: "definition", controlType: "knob", parameterName: "DISTORT_DEFINITION", xmlLabel: "Definition" },
    "amp.preamp_cf_compress": { groupCode: "AMP", block: "amp", paramId: 80, wikiName: "PREAMP CF COMPRESS", name: "preamp_cf_compress", controlType: "knob", parameterName: "DISTORT_CFTHRESH", xmlLabel: "Preamp CF\nCompress" },
    "amp.preamp_cf_time": { groupCode: "AMP", block: "amp", paramId: 81, wikiName: "PREAMP CF TIME", name: "preamp_cf_time", controlType: "knob", parameterName: "DISTORT_CFTIME", xmlLabel: "Preamp CF\nTime" },
    "amp.dynamic_presence": { groupCode: "AMP", block: "amp", paramId: 84, wikiName: "DYNAMIC PRESENCE", name: "dynamic_presence", controlType: "knob", parameterName: "DISTORT_DYNPRES", xmlLabel: "Dynamic Presence" },
    "amp.dynamic_depth": { groupCode: "AMP", block: "amp", paramId: 85, wikiName: "DYNAMIC DEPTH", name: "dynamic_depth", controlType: "knob", parameterName: "DISTORT_DYNDEPTH", xmlLabel: "Dynamic Depth" },
    "amp.power_type": { groupCode: "AMP", block: "amp", paramId: 86, wikiName: "POWER TYPE", name: "power_type", controlType: "select", parameterName: "DISTORT_SUPPLYTYPE", xmlLabel: "Power Type", enumValues: AMP_POWER_TYPE_VALUES },
    "amp.ac_line_freq": { groupCode: "AMP", block: "amp", paramId: 87, wikiName: "AC LINE FREQ", name: "ac_line_freq", controlType: "knob", parameterName: "DISTORT_LINEFREQ", xmlLabel: "AC Line Freq" },
    "amp.pwr_amp_hardness": { groupCode: "AMP", block: "amp", paramId: 88, wikiName: "PWR AMP HARDNESS", name: "pwr_amp_hardness", controlType: "knob", parameterName: "DISTORT_PAHARDNESS", xmlLabel: "Pwr Amp Hardness" },
    "amp.preamp_cf_ratio": { groupCode: "AMP", block: "amp", paramId: 91, wikiName: "PREAMP CF RATIO", name: "preamp_cf_ratio", controlType: "knob", parameterName: "DISTORT_CFRATIO", xmlLabel: "Preamp CF\nRatio" },
    "amp.eq_type": { groupCode: "AMP", block: "amp", paramId: 92, wikiName: "EQ TYPE", name: "eq_type", controlType: "select", parameterName: "DISTORT_EQTYPE", xmlLabel: "EQ Type", enumValues: AMP_EQ_TYPE_VALUES },
    "amp.cathode_resist": { groupCode: "AMP", block: "amp", paramId: 93, wikiName: "CATHODE RESIST", name: "cathode_resist", controlType: "knob" },
    "amp.preamp_sag": { groupCode: "AMP", block: "amp", paramId: 96, wikiName: "PREAMP SAG", name: "preamp_sag", controlType: "switch", parameterName: "DISTORT_PRESAG", xmlLabel: "Preamp Sag" },
    "amp.bright": { groupCode: "AMP", block: "amp", paramId: 97, wikiName: "BRight", name: "bright", controlType: "knob", parameterName: "DISTORT_HITREBLE", xmlLabel: "Bright", gateOn: "DISTORT_DRIVETYPE", gateValues: "0,4,5" },
    "amp.pwr_amp_bias": { groupCode: "AMP", block: "amp", paramId: 98, wikiName: "PWR AMP BIAS", name: "pwr_amp_bias", controlType: "knob", parameterName: "DISTORT_PAOFFSET", xmlLabel: "Pwr Amp Bias" },
    "amp.preamp_dynamics": { groupCode: "AMP", block: "amp", paramId: 99, wikiName: "PREAMP DYNAMICS", name: "preamp_dynamics", controlType: "knob", parameterName: "DISTORT_INDYNAMICS", xmlLabel: "Preamp Dynamics" },
    "amp.hi_freq_slope": { groupCode: "AMP", block: "amp", paramId: 100, wikiName: "HI FREQ SLOPE", name: "hi_freq_slope", controlType: "knob", parameterName: "DISTORT_SPKRHFQ", xmlLabel: "Hi Freq Slope" },
    "amp.variac": { groupCode: "AMP", block: "amp", paramId: 101, wikiName: "VARIAC", name: "variac", controlType: "knob", parameterName: "DISTORT_VARIAC", xmlLabel: "Variac" },
    "amp.char_type": { groupCode: "AMP", block: "amp", paramId: 102, wikiName: "CHAR TYPE", name: "char_type", controlType: "select", enumValues: AMP_CHAR_TYPE_VALUES },
    "amp.presence_shift": { groupCode: "AMP", block: "amp", paramId: 104, wikiName: "PRESENCE SHIFT", name: "presence_shift", controlType: "switch", parameterName: "DISTORT_PRESSHIFT", xmlLabel: "Presence Shift", gateOn: "DISTORT_TYPE" },
    "amp.saturation_drive": { groupCode: "AMP", block: "amp", paramId: 105, wikiName: "SATURATION DRIVE", name: "saturation_drive", controlType: "knob", parameterName: "DISTORT_SATDRIVE", xmlLabel: "Saturation Drive", modifierAssignable: true, gateOn: "DISTORT_DRIVETYPE", gateValues: "0,4,5" },
    "amp.crunch": { groupCode: "AMP", block: "amp", paramId: 106, wikiName: "CRUNCH", name: "crunch", controlType: "knob", parameterName: "DISTORT_TRIODE2RATIO", xmlLabel: "Crunch" },
    "amp.out_comp_type": { groupCode: "AMP", block: "amp", paramId: 109, wikiName: "OUT COMP TYPE", name: "out_comp_type", controlType: "select", parameterName: "DISTORT_COMPTYPE", xmlLabel: "Out Comp\nType", enumValues: AMP_OUT_COMP_TYPE_VALUES },
    "amp.eq_location": { groupCode: "AMP", block: "amp", paramId: 110, wikiName: "EQ LOCATION", name: "eq_location", controlType: "select", parameterName: "DISTORT_EQPOSITION", xmlLabel: "EQ Location", enumValues: AMP_EQ_LOCATION_VALUES },
    "amp.cf_comp_type": { groupCode: "AMP", block: "amp", paramId: 111, wikiName: "CF COMP TYPE", name: "cf_comp_type", controlType: "select", enumValues: AMP_CF_COMP_TYPE_VALUES },
    "amp.preamp_cf_hardness": { groupCode: "AMP", block: "amp", paramId: 113, wikiName: "PREAMP CF HARDNESS", name: "preamp_cf_hardness", controlType: "knob", parameterName: "DISTORT_CFHARDNESS", xmlLabel: "Preamp CF\nHardness" },
    "amp.pi_bias_shift": { groupCode: "AMP", block: "amp", paramId: 114, wikiName: "PI BIAS SHIFT", name: "pi_bias_shift", controlType: "knob", parameterName: "DISTORT_PIEXCURSION", xmlLabel: "PI Bias Shift" },
    "amp.motor_drive": { groupCode: "AMP", block: "amp", paramId: 115, wikiName: "MOTOR DRIVE", name: "motor_drive", controlType: "knob", fwAdded: "Since Quantum 7.02" },
    "amp.motor_time_const": { groupCode: "AMP", block: "amp", paramId: 116, wikiName: "MOTOR TIME CONST", name: "motor_time_const", controlType: "knob", parameterName: "DISTORT_MDTIME", xmlLabel: "Motor Time Const", fwAdded: "Since Quantum 7.02" },
    "cab.cab": { groupCode: "CAB", block: "cab", paramId: 0, wikiName: "CAB", name: "cab", controlType: "select", parameterName: "CABINET_TYPEL", xmlLabel: "Cab" },
    "cab.mic": { groupCode: "CAB", block: "cab", paramId: 1, wikiName: "MIC", name: "mic", controlType: "select", parameterName: "CABINET_MICL", xmlLabel: "Mic", enumValues: CAB_MIC_VALUES },
    "cab.cab_r": { groupCode: "CAB", block: "cab", paramId: 2, wikiName: "CAB R", name: "cab_r", controlType: "select", parameterName: "CABINET_TYPER", xmlLabel: "Cab R" },
    "cab.mic_r": { groupCode: "CAB", block: "cab", paramId: 3, wikiName: "MIC R", name: "mic_r", controlType: "select", parameterName: "CABINET_MICR", xmlLabel: "Mic R", enumValues: CAB_MIC_R_VALUES },
    "cab.link": { groupCode: "CAB", block: "cab", paramId: 4, wikiName: "LINK", name: "link", controlType: "switch", parameterName: "CABINET_LINK", xmlLabel: "Link" },
    "cab.level_l": { groupCode: "CAB", block: "cab", paramId: 5, wikiName: "Level L", name: "level_l", controlType: "knob", parameterName: "CABINET_LEVELL", xmlLabel: "Level L" },
    "cab.level_r": { groupCode: "CAB", block: "cab", paramId: 6, wikiName: "Level R", name: "level_r", controlType: "knob", parameterName: "CABINET_LEVELR", xmlLabel: "Level R" },
    // HW-089 calibration (2026-05-11): wire 0..65534 ↔ -100..+100 bipolar linear.
    "cab.pan_l": { groupCode: "CAB", block: "cab", paramId: 7, wikiName: "Pan L", name: "pan_l", controlType: "knob", parameterName: "CABINET_PANL", xmlLabel: "Pan L", displayMin: -100, displayMax: 100 },
    "cab.pan_r": { groupCode: "CAB", block: "cab", paramId: 8, wikiName: "Pan R", name: "pan_r", controlType: "knob", parameterName: "CABINET_PANR", xmlLabel: "Pan R" },
    // HW-088 calibration (2026-05-11): wire 0..65534 ↔ -80..+20 dB linear.
    "cab.level": { groupCode: "CAB", block: "cab", paramId: 9, wikiName: "Level", name: "level", controlType: "knob", parameterName: "CABINET_LEVEL", xmlLabel: "Level", modifierAssignable: true, displayMin: -80, displayMax: 20 },
    "cab.balance": { groupCode: "CAB", block: "cab", paramId: 10, wikiName: "Balance", name: "balance", controlType: "knob", parameterName: "CABINET_PAN", xmlLabel: "Balance", modifierAssignable: true },
    "cab.bypass_mode": { groupCode: "CAB", block: "cab", paramId: 11, wikiName: "BYPASS MODE", name: "bypass_mode", controlType: "select", parameterName: "CABINET_BYPASSMODE", xmlLabel: "Bypass Mode", enumValues: CAB_BYPASS_MODE_VALUES, modifierAssignable: true },
    "cab.effect_type": { groupCode: "CAB", block: "cab", paramId: 12, wikiName: "EFFECT TYPE", name: "effect_type", controlType: "select", enumValues: CAB_EFFECT_TYPE_VALUES },
    "cab.drive": { groupCode: "CAB", block: "cab", paramId: 14, wikiName: "DRIVE", name: "drive", controlType: "knob", parameterName: "CABINET_DRIVE", xmlLabel: "Drive" },
    "cab.saturation": { groupCode: "CAB", block: "cab", paramId: 15, wikiName: "SATURATION", name: "saturation", controlType: "knob", parameterName: "CABINET_BIAS", xmlLabel: "Saturation" },
    "cab.room_level": { groupCode: "CAB", block: "cab", paramId: 16, wikiName: "ROOM Level", name: "room_level", controlType: "knob", parameterName: "CABINET_ROOMMIX", xmlLabel: "Room Level" },
    "cab.room_size": { groupCode: "CAB", block: "cab", paramId: 17, wikiName: "ROOM SIZE", name: "room_size", controlType: "knob", parameterName: "CABINET_ROOMSIZE", xmlLabel: "Room Size" },
    "cab.mic_spacing": { groupCode: "CAB", block: "cab", paramId: 18, wikiName: "MIC SPACING", name: "mic_spacing", controlType: "knob", parameterName: "CABINET_MICSPACE", xmlLabel: "Mic Spacing" },
    // HW-090 calibration (2026-05-11): wire 0..65534 ↔ 20..2000 Hz log10
    // (2 decades). Verified at all 9 anchors against displayHz =
    // 20 × 100^(wire/65534): wire 32767 → 200 Hz (geometric mean) ✓.
    "cab.low_cut": { groupCode: "CAB", block: "cab", paramId: 19, wikiName: "LOW CUT", name: "low_cut", controlType: "knob", parameterName: "CABINET_LOCUT", xmlLabel: "Low Cut", displayMin: 20, displayMax: 2000, displayScale: 'log10' },
    // HW-090 calibration (2026-05-11): wire 0..65534 ↔ 200..20000 Hz
    // log10 (2 decades). Verified at all 9 anchors.
    "cab.high_cut": { groupCode: "CAB", block: "cab", paramId: 20, wikiName: "HIGH CUT", name: "high_cut", controlType: "knob", parameterName: "CABINET_HICUT", xmlLabel: "High Cut", displayMin: 200, displayMax: 20000, displayScale: 'log10' },
    "cab.speaker_size": { groupCode: "CAB", block: "cab", paramId: 21, wikiName: "SPEAKER SIZE", name: "speaker_size", controlType: "knob", parameterName: "CABINET_WARP", xmlLabel: "Speaker Size" },
    "cab.proximity": { groupCode: "CAB", block: "cab", paramId: 22, wikiName: "PROXIMITY", name: "proximity", controlType: "knob", parameterName: "CABINET_PROXIMITYL", xmlLabel: "Proximity" },
    "cab.air": { groupCode: "CAB", block: "cab", paramId: 23, wikiName: "AIR", name: "air", controlType: "knob", parameterName: "CABINET_DIRECT", xmlLabel: "Air" },
    "cab.motor_drive": { groupCode: "CAB", block: "cab", paramId: 24, wikiName: "MOTOR DRIVE", name: "motor_drive", controlType: "knob", parameterName: "CABINET_DYNAMICS", xmlLabel: "Motor Drive" },
    "cab.air_freq": { groupCode: "CAB", block: "cab", paramId: 25, wikiName: "AIR FREQ", name: "air_freq", controlType: "knob" },
    "cab.delay_l": { groupCode: "CAB", block: "cab", paramId: 26, wikiName: "DELAY L", name: "delay_l", controlType: "knob" },
    "cab.delay_r": { groupCode: "CAB", block: "cab", paramId: 27, wikiName: "DELAY R", name: "delay_r", controlType: "knob", parameterName: "CABINET_DELAYR", xmlLabel: "Delay R" },
    "cab.proximity_r": { groupCode: "CAB", block: "cab", paramId: 28, wikiName: "PROXIMITY R", name: "proximity_r", controlType: "knob", parameterName: "CABINET_PROXIMITYR", xmlLabel: "Proximity R" },
    "cab.prox_freq": { groupCode: "CAB", block: "cab", paramId: 29, wikiName: "PROX. FREQ.", name: "prox_freq", controlType: "knob" },
    "cab.input_select": { groupCode: "CAB", block: "cab", paramId: 30, wikiName: "INPUT SELECT", name: "input_select", controlType: "select", parameterName: "CABINET_INPUTSEL", xmlLabel: "Input Select", enumValues: CAB_INPUT_SELECT_VALUES },
    "cab.preamp_type": { groupCode: "CAB", block: "cab", paramId: 31, wikiName: "PREAMP TYPE", name: "preamp_type", controlType: "select", parameterName: "CABINET_PRETYPE", xmlLabel: "Preamp Type", enumValues: CAB_PREAMP_TYPE_VALUES },
    "cab.bass": { groupCode: "CAB", block: "cab", paramId: 32, wikiName: "BASS", name: "bass", controlType: "knob", parameterName: "CABINET_BASS", xmlLabel: "Bass" },
    "cab.mid": { groupCode: "CAB", block: "cab", paramId: 33, wikiName: "MID", name: "mid", controlType: "knob", parameterName: "CABINET_MID", xmlLabel: "Mid" },
    "cab.treble": { groupCode: "CAB", block: "cab", paramId: 34, wikiName: "TREBLE", name: "treble", controlType: "knob", parameterName: "CABINET_TREBLE", xmlLabel: "Treble" },
    "cab.preamp_mode": { groupCode: "CAB", block: "cab", paramId: 35, wikiName: "PREAMP MODE", name: "preamp_mode", controlType: "select", parameterName: "CABINET_OVERSAMPLE", xmlLabel: "Preamp Mode", enumValues: CAB_PREAMP_MODE_VALUES },
    "cab.dephase": { groupCode: "CAB", block: "cab", paramId: 36, wikiName: "DEPHASE", name: "dephase", controlType: "knob", parameterName: "CABINET_SMOOTH", xmlLabel: "Dephase" },
    "cab.filter_slope": { groupCode: "CAB", block: "cab", paramId: 37, wikiName: "FILTER SLOPE", name: "filter_slope", controlType: "select", parameterName: "CABINET_ORDER", xmlLabel: "Filter Slope", enumValues: CAB_FILTER_SLOPE_VALUES },
    "cab.motor_time_constant": { groupCode: "CAB", block: "cab", paramId: 38, wikiName: "MOTOR TIME CONSTANT", name: "motor_time_constant", controlType: "knob" },
    "chorus.effect_type": { groupCode: "CHO", block: "chorus", paramId: 0, wikiName: "EFFECT TYPE", name: "effect_type", controlType: "select", enumValues: CHORUS_EFFECT_TYPE_VALUES },
    "chorus.voices": { groupCode: "CHO", block: "chorus", paramId: 1, wikiName: "VOICES", name: "voices", controlType: "unknown", parameterName: "CHORUS_VOICES", xmlLabel: "Voices", displayMin: 1, displayMax: 4, step: 1 },
    "chorus.rate": { groupCode: "CHO", block: "chorus", paramId: 2, wikiName: "RATE", name: "rate", controlType: "knob", parameterName: "CHORUS_RATE", xmlLabel: "Rate", modifierAssignable: true },
    "chorus.tempo": { groupCode: "CHO", block: "chorus", paramId: 3, wikiName: "Tempo", name: "tempo", controlType: "select", parameterName: "CHORUS_TEMPO", xmlLabel: "Tempo" },
    "chorus.depth": { groupCode: "CHO", block: "chorus", paramId: 4, wikiName: "DEPTH", name: "depth", controlType: "knob", parameterName: "CHORUS_DEPTH", xmlLabel: "Depth", modifierAssignable: true },
    "chorus.high_cut": { groupCode: "CHO", block: "chorus", paramId: 5, wikiName: "HIGH CUT", name: "high_cut", controlType: "knob" },
    "chorus.delay_time": { groupCode: "CHO", block: "chorus", paramId: 6, wikiName: "DELAY TIME", name: "delay_time", controlType: "knob", parameterName: "CHORUS_DELAYTIME", xmlLabel: "Delay Time" },
    "chorus.lfo_phase": { groupCode: "CHO", block: "chorus", paramId: 7, wikiName: "LFO PHASE", name: "lfo_phase", controlType: "knob", parameterName: "CHORUS_LFOPHASE", xmlLabel: "LFO Phase" },
    "chorus.lfo_type": { groupCode: "CHO", block: "chorus", paramId: 8, wikiName: "LFO TYPE", name: "lfo_type", controlType: "select", parameterName: "CHORUS_LFOTYPE", xmlLabel: "LFO Type", enumValues: CHORUS_LFO_TYPE_VALUES },
    "chorus.auto_depth": { groupCode: "CHO", block: "chorus", paramId: 9, wikiName: "AUTO DEPTH", name: "auto_depth", controlType: "select", parameterName: "CHORUS_AUTO", xmlLabel: "Auto Depth", enumValues: CHORUS_AUTO_DEPTH_VALUES },
    // HW-088 calibration (2026-05-11): wire 0..65534 ↔ 0..100% linear.
    "chorus.mix": { groupCode: "CHO", block: "chorus", paramId: 10, wikiName: "MIX", name: "mix", controlType: "knob", parameterName: "CHORUS_MIX", xmlLabel: "Mix", modifierAssignable: true, displayMin: 0, displayMax: 100 },
    "chorus.level": { groupCode: "CHO", block: "chorus", paramId: 11, wikiName: "Level", name: "level", controlType: "knob", parameterName: "CHORUS_LEVEL", xmlLabel: "Level", modifierAssignable: true },
    "chorus.balance": { groupCode: "CHO", block: "chorus", paramId: 12, wikiName: "Balance", name: "balance", controlType: "knob", parameterName: "CHORUS_PAN", xmlLabel: "Balance", modifierAssignable: true },
    "chorus.bypass_mode": { groupCode: "CHO", block: "chorus", paramId: 13, wikiName: "BYPASS MODE", name: "bypass_mode", controlType: "select", parameterName: "CHORUS_BYPASSMODE", xmlLabel: "Bypass Mode", enumValues: CHORUS_BYPASS_MODE_VALUES, modifierAssignable: true },
    "chorus.global": { groupCode: "CHO", block: "chorus", paramId: 14, wikiName: "GLOBAL", name: "global", controlType: "switch" },
    "chorus.phase_reverse": { groupCode: "CHO", block: "chorus", paramId: 16, wikiName: "PHASE REVERSE", name: "phase_reverse", controlType: "select", parameterName: "CHORUS_PHASEREV", xmlLabel: "Phase Reverse", enumValues: CHORUS_PHASE_REVERSE_VALUES },
    "chorus.width": { groupCode: "CHO", block: "chorus", paramId: 17, wikiName: "WIDTH", name: "width", controlType: "knob", parameterName: "CHORUS_WIDTH", xmlLabel: "Width" },
    "chorus.lfo_2_rate": { groupCode: "CHO", block: "chorus", paramId: 18, wikiName: "LFO 2 RATE", name: "lfo_2_rate", controlType: "knob" },
    "chorus.lfo_2_depth": { groupCode: "CHO", block: "chorus", paramId: 19, wikiName: "LFO 2 DEPTH", name: "lfo_2_depth", controlType: "knob" },
    "chorus.drive": { groupCode: "CHO", block: "chorus", paramId: 20, wikiName: "DRIVE", name: "drive", controlType: "knob", parameterName: "CHORUS_DRIVE", xmlLabel: "Drive" },
    "chorus.low_cut": { groupCode: "CHO", block: "chorus", paramId: 21, wikiName: "LOW CUT", name: "low_cut", controlType: "knob", parameterName: "CHORUS_LOWCUT", xmlLabel: "Low Cut" },
    "chorus.spread": { groupCode: "CHO", block: "chorus", paramId: 22, wikiName: "SPREAD", name: "spread", controlType: "knob", parameterName: "CHORUS_SPREAD", xmlLabel: "Spread" },
    "chorus.dimension": { groupCode: "CHO", block: "chorus", paramId: 23, wikiName: "DIMENSION", name: "dimension", controlType: "select", enumValues: CHORUS_DIMENSION_VALUES },
    "compressor.treshold": { groupCode: "CPR", block: "compressor", paramId: 0, wikiName: "TRESHOLD", name: "treshold", controlType: "knob" },
    "compressor.ratio": { groupCode: "CPR", block: "compressor", paramId: 1, wikiName: "RATIO", name: "ratio", controlType: "knob", parameterName: "COMP_RATIO", xmlLabel: "Ratio" },
    "compressor.attack": { groupCode: "CPR", block: "compressor", paramId: 2, wikiName: "ATTACK", name: "attack", controlType: "knob", parameterName: "COMP_ATTACK", xmlLabel: "Attack" },
    "compressor.release": { groupCode: "CPR", block: "compressor", paramId: 3, wikiName: "RELEASE", name: "release", controlType: "knob", parameterName: "COMP_RELEASE", xmlLabel: "Release" },
    "compressor.level": { groupCode: "CPR", block: "compressor", paramId: 4, wikiName: "Level", name: "level", controlType: "knob", parameterName: "COMP_LEVEL", xmlLabel: "Level", modifierAssignable: true },
    "compressor.knee": { groupCode: "CPR", block: "compressor", paramId: 5, wikiName: "KNEE", name: "knee", controlType: "select", parameterName: "COMP_KNEE", xmlLabel: "Knee", enumValues: COMPRESSOR_KNEE_VALUES },
    "compressor.makeup": { groupCode: "CPR", block: "compressor", paramId: 6, wikiName: "MAKEUP", name: "makeup", controlType: "switch", parameterName: "COMP_AUTO", xmlLabel: "Makeup" },
    "compressor.detect": { groupCode: "CPR", block: "compressor", paramId: 7, wikiName: "DETECT", name: "detect", controlType: "select", parameterName: "COMP_PEAKRMS", xmlLabel: "Detect", enumValues: COMPRESSOR_DETECT_VALUES },
    "compressor.filter": { groupCode: "CPR", block: "compressor", paramId: 8, wikiName: "FILTER", name: "filter", controlType: "knob", parameterName: "COMP_CONTOUR", xmlLabel: "Filter" },
    "compressor.sidechain": { groupCode: "CPR", block: "compressor", paramId: 10, wikiName: "SIDECHAIN", name: "sidechain", controlType: "select", enumValues: COMPRESSOR_SIDECHAIN_VALUES },
    "compressor.mix": { groupCode: "CPR", block: "compressor", paramId: 11, wikiName: "MIX", name: "mix", controlType: "knob", parameterName: "COMP_MIX", xmlLabel: "Mix", modifierAssignable: true },
    "compressor.effect_type": { groupCode: "CPR", block: "compressor", paramId: 12, wikiName: "EFFECT TYPE", name: "effect_type", controlType: "select", enumValues: COMPRESSOR_EFFECT_TYPE_VALUES },
    "compressor.comp": { groupCode: "CPR", block: "compressor", paramId: 13, wikiName: "COMP", name: "comp", controlType: "knob", parameterName: "COMP_SUSTAIN", xmlLabel: "Comp" },
    "compressor.bypass_mode": { groupCode: "CPR", block: "compressor", paramId: 14, wikiName: "BYPASS MODE", name: "bypass_mode", controlType: "select", parameterName: "COMP_BYPASSMODE", xmlLabel: "Bypass Mode", enumValues: COMPRESSOR_BYPASS_MODE_VALUES, modifierAssignable: true },
    "compressor.look_ahead": { groupCode: "CPR", block: "compressor", paramId: 15, wikiName: "LOOK AHEAD", name: "look_ahead", controlType: "knob", parameterName: "COMP_DELAYTIME", xmlLabel: "Look Ahead" },
    "compressor.auto": { groupCode: "CPR", block: "compressor", paramId: 16, wikiName: "AUTO", name: "auto", controlType: "switch", parameterName: "COMP_AUTOMODE", xmlLabel: "Auto" },
    "compressor.emphasis": { groupCode: "CPR", block: "compressor", paramId: 17, wikiName: "EMPHASIS", name: "emphasis", controlType: "knob", parameterName: "COMP_EMPHASIS", xmlLabel: "Emphasis" },
    "compressor.dynamics": { groupCode: "CPR", block: "compressor", paramId: 18, wikiName: "DYNAMICS", name: "dynamics", controlType: "knob", parameterName: "COMP_DYNAMICS", xmlLabel: "Dynamics" },
    "compressor.input_level": { groupCode: "CPR", block: "compressor", paramId: 19, wikiName: "INPUT Level", name: "input_level", controlType: "select", parameterName: "COMP_INPUTLEVEL", xmlLabel: "Input Level", enumValues: COMPRESSOR_INPUT_LEVEL_VALUES, fwAdded: "Since Quantum 7.01" },
    "controllers.lfo1_type_run": { groupCode: "CONTROLLERS", block: "controllers", paramId: 0, wikiName: "LFO1 TYPE [RUN]", name: "lfo1_type_run", controlType: "select", parameterName: "CONTROLLERS_LFO1TYPE", xmlLabel: "LFO1 Type [Run]", enumValues: CONTROLLERS_LFO1_TYPE_RUN_VALUES, modifierAssignable: true },
    "controllers.lfo1_rate": { groupCode: "CONTROLLERS", block: "controllers", paramId: 1, wikiName: "LFO1 RATE", name: "lfo1_rate", controlType: "knob", parameterName: "CONTROLLERS_LFO1FREQ", xmlLabel: "LFO1 Rate", modifierAssignable: true },
    "controllers.lfo1_depth": { groupCode: "CONTROLLERS", block: "controllers", paramId: 2, wikiName: "LFO1 DEPTH", name: "lfo1_depth", controlType: "knob", parameterName: "CONTROLLERS_LFO1DEPTH", xmlLabel: "LFO1 Depth", modifierAssignable: true },
    "controllers.lfo1_duty": { groupCode: "CONTROLLERS", block: "controllers", paramId: 3, wikiName: "LFO1 DUTY", name: "lfo1_duty", controlType: "knob", parameterName: "CONTROLLERS_LFO1DUTY", xmlLabel: "LFO1 Duty", modifierAssignable: true },
    "controllers.output_b_phase": { groupCode: "CONTROLLERS", block: "controllers", paramId: 4, wikiName: "OUTPUT B PHASE", name: "output_b_phase", controlType: "knob", parameterName: "CONTROLLERS_LFO1PHASE", xmlLabel: "Output B Phase" },
    "controllers.lfo1_tempo": { groupCode: "CONTROLLERS", block: "controllers", paramId: 5, wikiName: "LFO1 Tempo", name: "lfo1_tempo", controlType: "select", parameterName: "CONTROLLERS_LFO1TEMPO", xmlLabel: "LFO1 Tempo" },
    "controllers.lfo2_type_run": { groupCode: "CONTROLLERS", block: "controllers", paramId: 6, wikiName: "LFO2 TYPE [RUN]", name: "lfo2_type_run", controlType: "select", parameterName: "CONTROLLERS_LFO2TYPE", xmlLabel: "LFO2 Type [Run]", enumValues: CONTROLLERS_LFO2_TYPE_RUN_VALUES, modifierAssignable: true },
    "controllers.lfo2_rate": { groupCode: "CONTROLLERS", block: "controllers", paramId: 7, wikiName: "LFO2 RATE", name: "lfo2_rate", controlType: "knob", parameterName: "CONTROLLERS_LFO2FREQ", xmlLabel: "LFO2 Rate", modifierAssignable: true },
    "controllers.lfo2_depth": { groupCode: "CONTROLLERS", block: "controllers", paramId: 8, wikiName: "LFO2 DEPTH", name: "lfo2_depth", controlType: "knob", parameterName: "CONTROLLERS_LFO2DEPTH", xmlLabel: "LFO2 Depth", modifierAssignable: true },
    "controllers.lfo2_duty": { groupCode: "CONTROLLERS", block: "controllers", paramId: 9, wikiName: "LFO2 DUTY", name: "lfo2_duty", controlType: "knob", parameterName: "CONTROLLERS_LFO2DUTY", xmlLabel: "LFO2 Duty", modifierAssignable: true },
    "controllers.lfo2_tempo": { groupCode: "CONTROLLERS", block: "controllers", paramId: 11, wikiName: "LFO2 Tempo", name: "lfo2_tempo", controlType: "select", parameterName: "CONTROLLERS_LFO2TEMPO", xmlLabel: "LFO2 Tempo" },
    "controllers.mode": { groupCode: "CONTROLLERS", block: "controllers", paramId: 12, wikiName: "MODE", name: "mode", controlType: "select", parameterName: "CONTROLLERS_ADSR1MODE", xmlLabel: "Mode", enumValues: CONTROLLERS_MODE_VALUES },
    "controllers.retrig": { groupCode: "CONTROLLERS", block: "controllers", paramId: 13, wikiName: "RETRIG", name: "retrig", controlType: "switch", parameterName: "CONTROLLERS_ADSR1RETRIG", xmlLabel: "Retrig" },
    "controllers.attack": { groupCode: "CONTROLLERS", block: "controllers", paramId: 14, wikiName: "ATTACK", name: "attack", controlType: "knob", parameterName: "CONTROLLERS_ADSR1ATTACK", xmlLabel: "Attack" },
    "controllers.decay": { groupCode: "CONTROLLERS", block: "controllers", paramId: 15, wikiName: "DECAY", name: "decay", controlType: "knob", parameterName: "CONTROLLERS_ADSR1DECAY", xmlLabel: "Decay" },
    "controllers.sustain": { groupCode: "CONTROLLERS", block: "controllers", paramId: 16, wikiName: "SUSTAIN", name: "sustain", controlType: "knob", parameterName: "CONTROLLERS_ADSR1SUSTAIN", xmlLabel: "Sustain" },
    "controllers.level": { groupCode: "CONTROLLERS", block: "controllers", paramId: 17, wikiName: "Level", name: "level", controlType: "knob", parameterName: "CONTROLLERS_ADSR1LEVEL", xmlLabel: "Level" },
    "controllers.release": { groupCode: "CONTROLLERS", block: "controllers", paramId: 18, wikiName: "RELEASE", name: "release", controlType: "knob", parameterName: "CONTROLLERS_ADSR1RELEASE", xmlLabel: "Release" },
    "controllers.threshold": { groupCode: "CONTROLLERS", block: "controllers", paramId: 19, wikiName: "THRESHOLD", name: "threshold", controlType: "knob", parameterName: "CONTROLLERS_ADSR1THRESH", xmlLabel: "Threshold" },
    "controllers.gain": { groupCode: "CONTROLLERS", block: "controllers", paramId: 31, wikiName: "GAIN", name: "gain", controlType: "knob", parameterName: "CONTROLLERS_ENVGAIN", xmlLabel: "Gain" },
    "controllers.tap_tempo": { groupCode: "CONTROLLERS", block: "controllers", paramId: 32, wikiName: "TAP Tempo", name: "tap_tempo", controlType: "unknown", displayMin: 30, displayMax: 250, step: 1 },
    "controllers.tempo_setting": { groupCode: "CONTROLLERS", block: "controllers", paramId: 33, wikiName: "Tempo SETTING", name: "tempo_setting", controlType: "select", enumValues: CONTROLLERS_TEMPO_SETTING_VALUES },
    "controllers.rate": { groupCode: "CONTROLLERS", block: "controllers", paramId: 34, wikiName: "RATE", name: "rate", controlType: "knob", parameterName: "CONTROLLERS_SEQFREQ", xmlLabel: "Rate", modifierAssignable: true },
    "controllers.tempo": { groupCode: "CONTROLLERS", block: "controllers", paramId: 35, wikiName: "Tempo", name: "tempo", controlType: "select", parameterName: "CONTROLLERS_SEQTEMPO", xmlLabel: "Tempo" },
    "controllers.stages": { groupCode: "CONTROLLERS", block: "controllers", paramId: 36, wikiName: "STAGES", name: "stages", controlType: "select", parameterName: "CONTROLLERS_SEQSTAGES", xmlLabel: "Stages", enumValues: CONTROLLERS_STAGES_VALUES, displayMin: 2 },
    "controllers.1": { groupCode: "CONTROLLERS", block: "controllers", paramId: 37, wikiName: "1", name: "1", controlType: "unknown", parameterName: "CONTROLLERS_SEQ1", xmlLabel: "1" },
    "controllers.2": { groupCode: "CONTROLLERS", block: "controllers", paramId: 38, wikiName: "2", name: "2", controlType: "unknown" },
    "controllers.3": { groupCode: "CONTROLLERS", block: "controllers", paramId: 39, wikiName: "3", name: "3", controlType: "unknown" },
    "controllers.4": { groupCode: "CONTROLLERS", block: "controllers", paramId: 40, wikiName: "4", name: "4", controlType: "unknown" },
    "controllers.5": { groupCode: "CONTROLLERS", block: "controllers", paramId: 41, wikiName: "5", name: "5", controlType: "unknown" },
    "controllers.6": { groupCode: "CONTROLLERS", block: "controllers", paramId: 42, wikiName: "6", name: "6", controlType: "unknown" },
    "controllers.7": { groupCode: "CONTROLLERS", block: "controllers", paramId: 43, wikiName: "7", name: "7", controlType: "unknown" },
    "controllers.8": { groupCode: "CONTROLLERS", block: "controllers", paramId: 44, wikiName: "8", name: "8", controlType: "unknown" },
    "controllers.9": { groupCode: "CONTROLLERS", block: "controllers", paramId: 45, wikiName: "9", name: "9", controlType: "unknown" },
    "controllers.10": { groupCode: "CONTROLLERS", block: "controllers", paramId: 46, wikiName: "10", name: "10", controlType: "unknown" },
    "controllers.11": { groupCode: "CONTROLLERS", block: "controllers", paramId: 47, wikiName: "11", name: "11", controlType: "unknown" },
    "controllers.12": { groupCode: "CONTROLLERS", block: "controllers", paramId: 48, wikiName: "12", name: "12", controlType: "unknown" },
    "controllers.13": { groupCode: "CONTROLLERS", block: "controllers", paramId: 49, wikiName: "13", name: "13", controlType: "unknown" },
    "controllers.14": { groupCode: "CONTROLLERS", block: "controllers", paramId: 50, wikiName: "14", name: "14", controlType: "unknown" },
    "controllers.15": { groupCode: "CONTROLLERS", block: "controllers", paramId: 51, wikiName: "15", name: "15", controlType: "unknown" },
    "controllers.16": { groupCode: "CONTROLLERS", block: "controllers", paramId: 52, wikiName: "16", name: "16", controlType: "unknown" },
    "controllers.run": { groupCode: "CONTROLLERS", block: "controllers", paramId: 54, wikiName: "RUN", name: "run", controlType: "switch", parameterName: "CONTROLLERS_SEQRUN", xmlLabel: "Run", modifierAssignable: true },
    "controllers.a": { groupCode: "CONTROLLERS", block: "controllers", paramId: 55, wikiName: "A", name: "a", controlType: "knob" },
    "controllers.b": { groupCode: "CONTROLLERS", block: "controllers", paramId: 56, wikiName: "B", name: "b", controlType: "knob" },
    "controllers.c": { groupCode: "CONTROLLERS", block: "controllers", paramId: 57, wikiName: "C", name: "c", controlType: "knob" },
    "controllers.d": { groupCode: "CONTROLLERS", block: "controllers", paramId: 58, wikiName: "D", name: "d", controlType: "knob" },
    "controllers.17": { groupCode: "CONTROLLERS", block: "controllers", paramId: 59, wikiName: "17", name: "17", controlType: "unknown" },
    "controllers.18": { groupCode: "CONTROLLERS", block: "controllers", paramId: 60, wikiName: "18", name: "18", controlType: "unknown" },
    "controllers.19": { groupCode: "CONTROLLERS", block: "controllers", paramId: 61, wikiName: "19", name: "19", controlType: "unknown" },
    "controllers.20": { groupCode: "CONTROLLERS", block: "controllers", paramId: 62, wikiName: "20", name: "20", controlType: "unknown" },
    "controllers.21": { groupCode: "CONTROLLERS", block: "controllers", paramId: 63, wikiName: "21", name: "21", controlType: "unknown" },
    "controllers.22": { groupCode: "CONTROLLERS", block: "controllers", paramId: 64, wikiName: "22", name: "22", controlType: "unknown" },
    "controllers.23": { groupCode: "CONTROLLERS", block: "controllers", paramId: 65, wikiName: "23", name: "23", controlType: "unknown" },
    "controllers.24": { groupCode: "CONTROLLERS", block: "controllers", paramId: 66, wikiName: "24", name: "24", controlType: "unknown" },
    "controllers.25": { groupCode: "CONTROLLERS", block: "controllers", paramId: 67, wikiName: "25", name: "25", controlType: "unknown" },
    "controllers.26": { groupCode: "CONTROLLERS", block: "controllers", paramId: 68, wikiName: "26", name: "26", controlType: "unknown" },
    "controllers.27": { groupCode: "CONTROLLERS", block: "controllers", paramId: 69, wikiName: "27", name: "27", controlType: "unknown" },
    "controllers.28": { groupCode: "CONTROLLERS", block: "controllers", paramId: 70, wikiName: "28", name: "28", controlType: "unknown" },
    "controllers.29": { groupCode: "CONTROLLERS", block: "controllers", paramId: 71, wikiName: "29", name: "29", controlType: "unknown" },
    "controllers.30": { groupCode: "CONTROLLERS", block: "controllers", paramId: 72, wikiName: "30", name: "30", controlType: "unknown" },
    "controllers.31": { groupCode: "CONTROLLERS", block: "controllers", paramId: 73, wikiName: "31", name: "31", controlType: "unknown" },
    "controllers.32": { groupCode: "CONTROLLERS", block: "controllers", paramId: 74, wikiName: "32", name: "32", controlType: "unknown" },
    "controllers.scene_1": { groupCode: "CONTROLLERS", block: "controllers", paramId: 78, wikiName: "SCENE 1", name: "scene_1", controlType: "knob", parameterName: "CONTROLLERS_SCENE1_VAL1", xmlLabel: "Scene 1" },
    "controllers.scene_2": { groupCode: "CONTROLLERS", block: "controllers", paramId: 79, wikiName: "SCENE 2", name: "scene_2", controlType: "knob", parameterName: "CONTROLLERS_SCENE1_VAL2", xmlLabel: "Scene 2" },
    "controllers.scene_3": { groupCode: "CONTROLLERS", block: "controllers", paramId: 80, wikiName: "SCENE 3", name: "scene_3", controlType: "knob", parameterName: "CONTROLLERS_SCENE1_VAL3", xmlLabel: "Scene 3" },
    "controllers.scene_4": { groupCode: "CONTROLLERS", block: "controllers", paramId: 81, wikiName: "SCENE 4", name: "scene_4", controlType: "knob", parameterName: "CONTROLLERS_SCENE1_VAL4", xmlLabel: "Scene 4" },
    "controllers.scene_5": { groupCode: "CONTROLLERS", block: "controllers", paramId: 82, wikiName: "SCENE 5", name: "scene_5", controlType: "knob", parameterName: "CONTROLLERS_SCENE1_VAL5", xmlLabel: "Scene 5" },
    "controllers.scene_6": { groupCode: "CONTROLLERS", block: "controllers", paramId: 83, wikiName: "SCENE 6", name: "scene_6", controlType: "knob", parameterName: "CONTROLLERS_SCENE1_VAL6", xmlLabel: "Scene 6" },
    "controllers.scene_7": { groupCode: "CONTROLLERS", block: "controllers", paramId: 84, wikiName: "SCENE 7", name: "scene_7", controlType: "knob", parameterName: "CONTROLLERS_SCENE1_VAL7", xmlLabel: "Scene 7" },
    "controllers.scene_8": { groupCode: "CONTROLLERS", block: "controllers", paramId: 85, wikiName: "SCENE 8", name: "scene_8", controlType: "knob", parameterName: "CONTROLLERS_SCENE1_VAL8", xmlLabel: "Scene 8" },
    "controllers.quantize": { groupCode: "CONTROLLERS", block: "controllers", paramId: 94, wikiName: "QUANTIZE", name: "quantize", controlType: "select", enumValues: CONTROLLERS_QUANTIZE_VALUES, displayMin: 1 },
    "crossover.freq": { groupCode: "XVR", block: "crossover", paramId: 0, wikiName: "Freq", name: "freq", controlType: "knob", parameterName: "CROSSOVER_FREQ", xmlLabel: "Freq", modifierAssignable: true },
    "crossover.freq_multi": { groupCode: "XVR", block: "crossover", paramId: 1, wikiName: "Freq Multi.", name: "freq_multi", controlType: "select", enumValues: CROSSOVER_FREQ_MULTI_VALUES },
    "crossover.lo_level_l": { groupCode: "XVR", block: "crossover", paramId: 2, wikiName: "Lo Level L", name: "lo_level_l", controlType: "knob", parameterName: "CROSSOVER_LOWGAINL", xmlLabel: "Lo Level L" },
    "crossover.hi_level_l": { groupCode: "XVR", block: "crossover", paramId: 3, wikiName: "Hi Level L", name: "hi_level_l", controlType: "knob", parameterName: "CROSSOVER_HIGAINL", xmlLabel: "Hi level L" },
    "crossover.lo_level_r": { groupCode: "XVR", block: "crossover", paramId: 4, wikiName: "Lo Level R", name: "lo_level_r", controlType: "knob", parameterName: "CROSSOVER_LOWGAINR", xmlLabel: "Lo Level R" },
    "crossover.hi_level_r": { groupCode: "XVR", block: "crossover", paramId: 5, wikiName: "Hi Level R", name: "hi_level_r", controlType: "knob", parameterName: "CROSSOVER_HIGAINR", xmlLabel: "Hi Level R" },
    "crossover.lo_pan_l": { groupCode: "XVR", block: "crossover", paramId: 6, wikiName: "Lo Pan L", name: "lo_pan_l", controlType: "knob", parameterName: "CROSSOVER_LOWPANL", xmlLabel: "Lo Pan L" },
    "crossover.hi_pan_l": { groupCode: "XVR", block: "crossover", paramId: 7, wikiName: "Hi Pan L", name: "hi_pan_l", controlType: "knob", parameterName: "CROSSOVER_HIPANL", xmlLabel: "Hi Pan L" },
    "crossover.lo_pan_r": { groupCode: "XVR", block: "crossover", paramId: 8, wikiName: "Lo Pan R", name: "lo_pan_r", controlType: "knob", parameterName: "CROSSOVER_LOWPANR", xmlLabel: "Lo Pan R" },
    "crossover.hi_pan_r": { groupCode: "XVR", block: "crossover", paramId: 9, wikiName: "Hi Pan R", name: "hi_pan_r", controlType: "knob", parameterName: "CROSSOVER_HIPANR", xmlLabel: "Hi Pan R" },
    "crossover.level": { groupCode: "XVR", block: "crossover", paramId: 11, wikiName: "Level", name: "level", controlType: "knob", parameterName: "CROSSOVER_LEVEL", xmlLabel: "Level", modifierAssignable: true },
    "crossover.balance": { groupCode: "XVR", block: "crossover", paramId: 12, wikiName: "Balance", name: "balance", controlType: "knob", parameterName: "CROSSOVER_PAN", xmlLabel: "Balance", modifierAssignable: true },
    "crossover.bypass_mode": { groupCode: "XVR", block: "crossover", paramId: 13, wikiName: "BYPASS MODE", name: "bypass_mode", controlType: "select", parameterName: "CROSSOVER_BYPASSMODE", xmlLabel: "Bypass Mode", enumValues: CROSSOVER_BYPASS_MODE_VALUES, modifierAssignable: true },
    "delay.effect_type": { groupCode: "DLY", block: "delay", paramId: 0, wikiName: "EFFECT TYPE", name: "effect_type", controlType: "select", enumValues: DELAY_EFFECT_TYPE_VALUES },
    "delay.config": { groupCode: "DLY", block: "delay", paramId: 1, wikiName: "CONFIG", name: "config", controlType: "select", parameterName: "DELAY_TYPE", xmlLabel: "Config", enumValues: DELAY_CONFIG_VALUES },
    // HW-091 calibration (2026-05-11, tempo sync DISABLED): wire 0..65534
    // ↔ 1..8000 ms linear. NOTE: when `delay.tempo` is set to a non-NONE
    // sync value, the device IGNORES manual `delay.time` writes and shows
    // the tempo-derived time in parens (e.g. "(375 ms)"). Caller should
    // set `delay.tempo` to wire 0 (NONE) before setting `delay.time`
    // manually, OR accept that the time write will be silently overridden.
    "delay.time": { groupCode: "DLY", block: "delay", paramId: 2, wikiName: "TIME", name: "time", controlType: "knob", parameterName: "DELAY_TIME", xmlLabel: "Time", modifierAssignable: true, displayMin: 1, displayMax: 8000 },
    "delay.ratio": { groupCode: "DLY", block: "delay", paramId: 3, wikiName: "RATIO", name: "ratio", controlType: "knob", parameterName: "DELAY_RATIO", xmlLabel: "Ratio", modifierAssignable: true },
    // HW-088 calibration (2026-05-11): wire 0..65534 ↔ -100..+100% bipolar linear (wire 32767 = exact zero crossing).
    "delay.feedback": { groupCode: "DLY", block: "delay", paramId: 4, wikiName: "FEEDBACK", name: "feedback", controlType: "knob", parameterName: "DELAY_FEED", xmlLabel: "Feedback", modifierAssignable: true, displayMin: -100, displayMax: 100 },
    "delay.feedback_r": { groupCode: "DLY", block: "delay", paramId: 6, wikiName: "FEEDBACK R", name: "feedback_r", controlType: "knob", parameterName: "DELAY_FEEDR", xmlLabel: "Feedback R", modifierAssignable: true },
    "delay.echo_pan": { groupCode: "DLY", block: "delay", paramId: 7, wikiName: "ECHO Pan", name: "echo_pan", controlType: "knob", parameterName: "DELAY_DELAYPAN", xmlLabel: "Echo Pan", modifierAssignable: true },
    "delay.spread": { groupCode: "DLY", block: "delay", paramId: 8, wikiName: "SPREAD", name: "spread", controlType: "knob", modifierAssignable: true },
    // HW-091 + HW-093 enum table (2026-05-11): 33 entries mapped wire 0..32.
    "delay.tempo": { groupCode: "DLY", block: "delay", paramId: 9, wikiName: "Tempo", name: "tempo", controlType: "select", parameterName: "DELAY_TEMPO", xmlLabel: "Tempo", enumValues: DELAY_TEMPO_VALUES },
    "delay.low_cut": { groupCode: "DLY", block: "delay", paramId: 10, wikiName: "LOW CUT", name: "low_cut", controlType: "knob", parameterName: "DELAY_LOCUT", xmlLabel: "Low Cut" },
    "delay.high_cut": { groupCode: "DLY", block: "delay", paramId: 11, wikiName: "HIGH CUT", name: "high_cut", controlType: "knob", parameterName: "DELAY_HICUT", xmlLabel: "High Cut" },
    "delay.lfo1_rate": { groupCode: "DLY", block: "delay", paramId: 12, wikiName: "LFO1 RATE", name: "lfo1_rate", controlType: "knob", parameterName: "DELAY_RATE1", xmlLabel: "LFO1 Rate", modifierAssignable: true },
    "delay.lfo2_rate": { groupCode: "DLY", block: "delay", paramId: 13, wikiName: "LFO2 RATE", name: "lfo2_rate", controlType: "knob", parameterName: "DELAY_RATE2", xmlLabel: "LFO2 Rate", modifierAssignable: true },
    "delay.lfo1_depth": { groupCode: "DLY", block: "delay", paramId: 14, wikiName: "LFO1 DEPTH", name: "lfo1_depth", controlType: "knob", parameterName: "DELAY_DEPTH1", xmlLabel: "LFO1 Depth", modifierAssignable: true },
    "delay.lfo2_depth": { groupCode: "DLY", block: "delay", paramId: 15, wikiName: "LFO2 DEPTH", name: "lfo2_depth", controlType: "knob", parameterName: "DELAY_DEPTH2", xmlLabel: "LFO2 Depth", modifierAssignable: true },
    "delay.drive": { groupCode: "DLY", block: "delay", paramId: 16, wikiName: "DRIVE", name: "drive", controlType: "knob", parameterName: "DELAY_DRIVE", xmlLabel: "Drive", modifierAssignable: true },
    "delay.mix": { groupCode: "DLY", block: "delay", paramId: 17, wikiName: "MIX", name: "mix", controlType: "knob", parameterName: "DELAY_MIX", xmlLabel: "Mix", modifierAssignable: true },
    "delay.level": { groupCode: "DLY", block: "delay", paramId: 18, wikiName: "Level", name: "level", controlType: "knob", parameterName: "DELAY_LEVEL", xmlLabel: "Level", modifierAssignable: true },
    "delay.balance": { groupCode: "DLY", block: "delay", paramId: 19, wikiName: "Balance", name: "balance", controlType: "knob", parameterName: "DELAY_PAN", xmlLabel: "Balance", modifierAssignable: true },
    "delay.bypass_mode": { groupCode: "DLY", block: "delay", paramId: 20, wikiName: "BYPASS MODE", name: "bypass_mode", controlType: "select", parameterName: "DELAY_BYPASSMODE", xmlLabel: "Bypass Mode", enumValues: DELAY_BYPASS_MODE_VALUES, modifierAssignable: true },
    "delay.global": { groupCode: "DLY", block: "delay", paramId: 21, wikiName: "GLOBAL", name: "global", controlType: "switch" },
    "delay.input_gain": { groupCode: "DLY", block: "delay", paramId: 23, wikiName: "INPUT GAIN", name: "input_gain", controlType: "knob", parameterName: "DELAY_GAIN", xmlLabel: "Input Gain", modifierAssignable: true },
    "delay.lfo1_type": { groupCode: "DLY", block: "delay", paramId: 24, wikiName: "LFO1 TYPE", name: "lfo1_type", controlType: "select", parameterName: "DELAY_LFO1TYPE", xmlLabel: "LFO1 Type", enumValues: DELAY_LFO1_TYPE_VALUES },
    "delay.lfo2_type": { groupCode: "DLY", block: "delay", paramId: 25, wikiName: "LFO2 TYPE", name: "lfo2_type", controlType: "select", parameterName: "DELAY_LFO2TYPE", xmlLabel: "LFO2 Type", enumValues: DELAY_LFO2_TYPE_VALUES },
    "delay.time_r": { groupCode: "DLY", block: "delay", paramId: 26, wikiName: "TIME R", name: "time_r", controlType: "knob", parameterName: "DELAY_TIMER", xmlLabel: "Time R", modifierAssignable: true },
    "delay.repeat_hold": { groupCode: "DLY", block: "delay", paramId: 27, wikiName: "REPEAT HOLD", name: "repeat_hold", controlType: "switch", parameterName: "DELAY_HOLD", xmlLabel: "Repeat Hold", modifierAssignable: true },
    "delay.master_feedback": { groupCode: "DLY", block: "delay", paramId: 28, wikiName: "MASTER FEEDBACK", name: "master_feedback", controlType: "knob", parameterName: "DELAY_MSTRFDBK", xmlLabel: "Master Feedback", modifierAssignable: true },
    "delay.tempo_r": { groupCode: "DLY", block: "delay", paramId: 29, wikiName: "Tempo R", name: "tempo_r", controlType: "select", parameterName: "DELAY_TEMPOR", xmlLabel: "Tempo R" },
    "delay.feedback_l_r": { groupCode: "DLY", block: "delay", paramId: 30, wikiName: "FEEDBACK L>R", name: "feedback_l_r", controlType: "knob" },
    "delay.feedback_r_l": { groupCode: "DLY", block: "delay", paramId: 31, wikiName: "FEEDBACK R>L", name: "feedback_r_l", controlType: "knob" },
    "delay.level_1": { groupCode: "DLY", block: "delay", paramId: 32, wikiName: "Level 1", name: "level_1", controlType: "knob", modifierAssignable: true },
    "delay.level_2": { groupCode: "DLY", block: "delay", paramId: 33, wikiName: "Level 2", name: "level_2", controlType: "knob", modifierAssignable: true },
    "delay.pan_1": { groupCode: "DLY", block: "delay", paramId: 34, wikiName: "Pan 1", name: "pan_1", controlType: "knob" },
    "delay.pan_2": { groupCode: "DLY", block: "delay", paramId: 35, wikiName: "Pan 2", name: "pan_2", controlType: "knob" },
    "delay.lfo1_phase": { groupCode: "DLY", block: "delay", paramId: 36, wikiName: "LFO1 PHASE", name: "lfo1_phase", controlType: "knob", parameterName: "DELAY_LFO1PHASE", xmlLabel: "LFO1 Phase", modifierAssignable: true },
    "delay.lfo2_phase": { groupCode: "DLY", block: "delay", paramId: 37, wikiName: "LFO2 PHASE", name: "lfo2_phase", controlType: "knob", parameterName: "DELAY_LFO2PHASE", xmlLabel: "LFO2 Phase", modifierAssignable: true },
    "delay.x_fade_time": { groupCode: "DLY", block: "delay", paramId: 38, wikiName: "X FADE TIME", name: "x_fade_time", controlType: "knob" },
    "delay.run": { groupCode: "DLY", block: "delay", paramId: 39, wikiName: "RUN", name: "run", controlType: "switch", parameterName: "DELAY_RUN", xmlLabel: "Run" },
    "delay.trigger_restart": { groupCode: "DLY", block: "delay", paramId: 40, wikiName: "TRIGGER RESTART", name: "trigger_restart", controlType: "switch", parameterName: "DELAY_MODE", xmlLabel: "Trigger Restart" },
    "delay.filter_slope": { groupCode: "DLY", block: "delay", paramId: 41, wikiName: "FILTER SLOPE", name: "filter_slope", controlType: "select", parameterName: "DELAY_FILTORDER", xmlLabel: "Filter Slope", enumValues: DELAY_FILTER_SLOPE_VALUES },
    "delay.duck_attn": { groupCode: "DLY", block: "delay", paramId: 42, wikiName: "DUCK ATTN", name: "duck_attn", controlType: "knob", modifierAssignable: true },
    "delay.duck_thres": { groupCode: "DLY", block: "delay", paramId: 43, wikiName: "DUCK THRES", name: "duck_thres", controlType: "knob" },
    "delay.duck_release": { groupCode: "DLY", block: "delay", paramId: 44, wikiName: "DUCK RELEASE", name: "duck_release", controlType: "knob" },
    "delay.diffusion": { groupCode: "DLY", block: "delay", paramId: 45, wikiName: "DIFFUSION", name: "diffusion", controlType: "knob", parameterName: "DELAY_DIFFUSE", xmlLabel: "Diffusion", modifierAssignable: true },
    "delay.diff_time": { groupCode: "DLY", block: "delay", paramId: 46, wikiName: "DIFF TIME", name: "diff_time", controlType: "knob", parameterName: "DELAY_DIFFTIME", xmlLabel: "Diff Time" },
    "delay.phase_reverse": { groupCode: "DLY", block: "delay", paramId: 47, wikiName: "PHASE REVERSE", name: "phase_reverse", controlType: "select", parameterName: "DELAY_PHASEREV", xmlLabel: "Phase Reverse", enumValues: DELAY_PHASE_REVERSE_VALUES },
    "delay.lfo1_target": { groupCode: "DLY", block: "delay", paramId: 48, wikiName: "LFO1 TARGET", name: "lfo1_target", controlType: "select", parameterName: "DELAY_LFO1TARGET", xmlLabel: "LFO1 Target", enumValues: DELAY_LFO1_TARGET_VALUES },
    "delay.lfo2_target": { groupCode: "DLY", block: "delay", paramId: 49, wikiName: "LFO2 TARGET", name: "lfo2_target", controlType: "select", parameterName: "DELAY_LFO2TARGET", xmlLabel: "LFO2 Target", enumValues: DELAY_LFO2_TARGET_VALUES },
    "delay.lfo1_tempo": { groupCode: "DLY", block: "delay", paramId: 50, wikiName: "LFO1 Tempo", name: "lfo1_tempo", controlType: "select", parameterName: "DELAY_LFO1TEMPO", xmlLabel: "LFO1 Tempo" },
    "delay.lfo2_tempo": { groupCode: "DLY", block: "delay", paramId: 51, wikiName: "LFO2 Tempo", name: "lfo2_tempo", controlType: "select", parameterName: "DELAY_LFO2TEMPO", xmlLabel: "LFO2 Tempo" },
    "delay.sweep_rate": { groupCode: "DLY", block: "delay", paramId: 52, wikiName: "SWEEP RATE", name: "sweep_rate", controlType: "knob", parameterName: "DELAY_RATE3", xmlLabel: "Sweep Rate" },
    "delay.sweep_type": { groupCode: "DLY", block: "delay", paramId: 53, wikiName: "SWEEP TYPE", name: "sweep_type", controlType: "select", parameterName: "DELAY_LFO3TYPE", xmlLabel: "Sweep Type", enumValues: DELAY_SWEEP_TYPE_VALUES },
    "delay.sweep_phase": { groupCode: "DLY", block: "delay", paramId: 54, wikiName: "SWEEP PHASE", name: "sweep_phase", controlType: "knob", parameterName: "DELAY_LFO3PHASE", xmlLabel: "Sweep Phase" },
    "delay.sweep_tempo": { groupCode: "DLY", block: "delay", paramId: 55, wikiName: "SWEEP Tempo", name: "sweep_tempo", controlType: "select", parameterName: "DELAY_LFO3TEMPO", xmlLabel: "Sweep Tempo" },
    "delay.start_freq": { groupCode: "DLY", block: "delay", paramId: 56, wikiName: "START FREQ", name: "start_freq", controlType: "knob", parameterName: "DELAY_FSTART", xmlLabel: "Start Freq" },
    "delay.stop_freq": { groupCode: "DLY", block: "delay", paramId: 57, wikiName: "STOP FREQ", name: "stop_freq", controlType: "knob", parameterName: "DELAY_FSTOP", xmlLabel: "Stop Freq" },
    "delay.resonance": { groupCode: "DLY", block: "delay", paramId: 58, wikiName: "RESONANCE", name: "resonance", controlType: "knob", parameterName: "DELAY_Q", xmlLabel: "Resonance" },
    "delay.q": { groupCode: "DLY", block: "delay", paramId: 59, wikiName: "Q", name: "q", controlType: "knob", parameterName: "DELAY_FILTERQ", xmlLabel: "Q" },
    "delay.bit_reduction": { groupCode: "DLY", block: "delay", paramId: 60, wikiName: "BIT REDUCTION", name: "bit_reduction", controlType: "unknown", parameterName: "DELAY_BITREDUCE", xmlLabel: "Bit Reduction", displayMin: 0, displayMax: 24, step: 1, modifierAssignable: true },
    "delay.freq_1": { groupCode: "DLY", block: "delay", paramId: 61, wikiName: "FREQ 1", name: "freq_1", controlType: "knob", parameterName: "DELAY_FREQ1", xmlLabel: "Freq 1" },
    "delay.freq_2": { groupCode: "DLY", block: "delay", paramId: 62, wikiName: "FREQ 2", name: "freq_2", controlType: "knob", parameterName: "DELAY_FREQ2", xmlLabel: "Freq 2" },
    "delay.q_1": { groupCode: "DLY", block: "delay", paramId: 63, wikiName: "Q 1", name: "q_1", controlType: "knob", parameterName: "DELAY_Q1", xmlLabel: "Q 1" },
    "delay.q_2": { groupCode: "DLY", block: "delay", paramId: 64, wikiName: "Q 2", name: "q_2", controlType: "knob", parameterName: "DELAY_Q2", xmlLabel: "Q 2" },
    "delay.gain_1": { groupCode: "DLY", block: "delay", paramId: 65, wikiName: "GAIN 1", name: "gain_1", controlType: "knob", parameterName: "DELAY_GAIN1", xmlLabel: "Gain 1" },
    "delay.gain_2": { groupCode: "DLY", block: "delay", paramId: 66, wikiName: "GAIN 2", name: "gain_2", controlType: "knob", parameterName: "DELAY_GAIN2", xmlLabel: "Gain 2" },
    "delay.lfo1_depth_range": { groupCode: "DLY", block: "delay", paramId: 67, wikiName: "LFO1 DEPTH RANGE", name: "lfo1_depth_range", controlType: "select", enumValues: DELAY_LFO1_DEPTH_RANGE_VALUES, modifierAssignable: true },
    "delay.motor_speed": { groupCode: "DLY", block: "delay", paramId: 68, wikiName: "MOTOR SPEED", name: "motor_speed", controlType: "knob", parameterName: "DELAY_SPEED", xmlLabel: "Motor Speed", modifierAssignable: true },
    "delay.right_post_delay": { groupCode: "DLY", block: "delay", paramId: 69, wikiName: "Right POST DELAY", name: "right_post_delay", controlType: "knob", parameterName: "DELAY_OFFSET", xmlLabel: "Right Post Delay" },
    "drive.effect_type": { groupCode: "DRV", block: "drive", paramId: 0, wikiName: "EFFECT TYPE", name: "effect_type", controlType: "select", enumValues: DRIVE_EFFECT_TYPE_VALUES },
    // HW-092 calibration (2026-05-11): 0..10 linear, same as AMP first-page knobs.
    "drive.gain": { groupCode: "DRV", block: "drive", paramId: 1, wikiName: "GAIN", name: "gain", controlType: "knob", modifierAssignable: true, displayMin: 0, displayMax: 10 },
    "drive.tone": { groupCode: "DRV", block: "drive", paramId: 2, wikiName: "TONE", name: "tone", controlType: "knob", parameterName: "FUZZ_TONE", xmlLabel: "Tone", modifierAssignable: true },
    "drive.volume": { groupCode: "DRV", block: "drive", paramId: 3, wikiName: "VOLUME", name: "volume", controlType: "knob", modifierAssignable: true },
    "drive.mix": { groupCode: "DRV", block: "drive", paramId: 4, wikiName: "MIX", name: "mix", controlType: "knob", parameterName: "FUZZ_MIX", xmlLabel: "Mix", modifierAssignable: true },
    "drive.bypass_mode": { groupCode: "DRV", block: "drive", paramId: 5, wikiName: "BYPASS MODE", name: "bypass_mode", controlType: "select", parameterName: "FUZZ_BYPASSMODE", xmlLabel: "Bypass Mode", enumValues: DRIVE_BYPASS_MODE_VALUES, modifierAssignable: true },
    "drive.slew_limit": { groupCode: "DRV", block: "drive", paramId: 6, wikiName: "SLEW LIMIT", name: "slew_limit", controlType: "knob", parameterName: "FUZZ_SLEW", xmlLabel: "Slew Limit" },
    "drive.lo_cut": { groupCode: "DRV", block: "drive", paramId: 8, wikiName: "LO CUT", name: "lo_cut", controlType: "knob" },
    "drive.hi_cut": { groupCode: "DRV", block: "drive", paramId: 9, wikiName: "HI CUT", name: "hi_cut", controlType: "knob" },
    "drive.clip_type": { groupCode: "DRV", block: "drive", paramId: 10, wikiName: "CLIP TYPE", name: "clip_type", controlType: "select", parameterName: "FUZZ_CLIPTYPE", xmlLabel: "Clip Type", enumValues: DRIVE_CLIP_TYPE_VALUES },
    "drive.bias": { groupCode: "DRV", block: "drive", paramId: 11, wikiName: "BIAS", name: "bias", controlType: "knob", parameterName: "FUZZ_BIAS", xmlLabel: "Bias" },
    "drive.bass": { groupCode: "DRV", block: "drive", paramId: 12, wikiName: "BASS", name: "bass", controlType: "knob", parameterName: "FUZZ_BASS", xmlLabel: "Bass" },
    "drive.middle": { groupCode: "DRV", block: "drive", paramId: 13, wikiName: "MIDDLE", name: "middle", controlType: "knob" },
    "drive.mid_freq": { groupCode: "DRV", block: "drive", paramId: 14, wikiName: "MID FREQ", name: "mid_freq", controlType: "knob", parameterName: "FUZZ_MIDFREQ", xmlLabel: "Mid Freq" },
    "drive.treble": { groupCode: "DRV", block: "drive", paramId: 15, wikiName: "TREBLE", name: "treble", controlType: "knob", parameterName: "FUZZ_TREBLE", xmlLabel: "Treble" },
    "drive.bit_reduce": { groupCode: "DRV", block: "drive", paramId: 16, wikiName: "BIT REDUCE", name: "bit_reduce", controlType: "unknown", parameterName: "FUZZ_BITREDUCE", xmlLabel: "Bit Reduce", displayMin: 0, displayMax: 24, step: 1, modifierAssignable: true },
    "drive.input": { groupCode: "DRV", block: "drive", paramId: 17, wikiName: "INPUT", name: "input", controlType: "select", enumValues: DRIVE_INPUT_VALUES },
    "drive.balance": { groupCode: "DRV", block: "drive", paramId: 18, wikiName: "Balance", name: "balance", controlType: "knob", parameterName: "FUZZ_PAN", xmlLabel: "Balance", modifierAssignable: true },
    "drive.sample_rate": { groupCode: "DRV", block: "drive", paramId: 19, wikiName: "SAMPLE RATE", name: "sample_rate", controlType: "knob", parameterName: "FUZZ_RESAMPLE", xmlLabel: "Sample Rate", modifierAssignable: true },
    "effectsloop.level_1": { groupCode: "FXL", block: "effectsloop", paramId: 0, wikiName: "Level 1", name: "level_1", controlType: "knob", parameterName: "OUTPUT_LEVEL1", xmlLabel: "Level 1" },
    "effectsloop.level_2": { groupCode: "FXL", block: "effectsloop", paramId: 1, wikiName: "Level 2", name: "level_2", controlType: "knob", parameterName: "OUTPUT_LEVEL2", xmlLabel: "Level 2" },
    "effectsloop.level_3": { groupCode: "FXL", block: "effectsloop", paramId: 2, wikiName: "Level 3", name: "level_3", controlType: "knob", parameterName: "OUTPUT_LEVEL3", xmlLabel: "Level 3" },
    "effectsloop.level_4": { groupCode: "FXL", block: "effectsloop", paramId: 3, wikiName: "Level 4", name: "level_4", controlType: "knob", parameterName: "OUTPUT_LEVEL4", xmlLabel: "Level 4" },
    "effectsloop.pan_1": { groupCode: "FXL", block: "effectsloop", paramId: 4, wikiName: "Pan 1", name: "pan_1", controlType: "knob", parameterName: "OUTPUT_PAN1", xmlLabel: "Pan 1" },
    "effectsloop.pan_2": { groupCode: "FXL", block: "effectsloop", paramId: 5, wikiName: "Pan 2", name: "pan_2", controlType: "knob", parameterName: "OUTPUT_PAN2", xmlLabel: "Pan 2" },
    "effectsloop.pan_3": { groupCode: "FXL", block: "effectsloop", paramId: 6, wikiName: "Pan 3", name: "pan_3", controlType: "knob", parameterName: "OUTPUT_PAN3", xmlLabel: "Pan 3" },
    "effectsloop.pan_4": { groupCode: "FXL", block: "effectsloop", paramId: 7, wikiName: "Pan 4", name: "pan_4", controlType: "knob", parameterName: "OUTPUT_PAN4", xmlLabel: "Pan 4" },
    "effectsloop.scene_1": { groupCode: "FXL", block: "effectsloop", paramId: 8, wikiName: "SCENE 1", name: "scene_1", controlType: "unknown" },
    "effectsloop.scene_2": { groupCode: "FXL", block: "effectsloop", paramId: 9, wikiName: "SCENE 2", name: "scene_2", controlType: "unknown" },
    "effectsloop.scene_3": { groupCode: "FXL", block: "effectsloop", paramId: 10, wikiName: "SCENE 3", name: "scene_3", controlType: "unknown" },
    "effectsloop.scene_4": { groupCode: "FXL", block: "effectsloop", paramId: 11, wikiName: "SCENE 4", name: "scene_4", controlType: "unknown" },
    "effectsloop.scene_5": { groupCode: "FXL", block: "effectsloop", paramId: 12, wikiName: "SCENE 5", name: "scene_5", controlType: "unknown" },
    "effectsloop.scene_6": { groupCode: "FXL", block: "effectsloop", paramId: 13, wikiName: "SCENE 6", name: "scene_6", controlType: "unknown" },
    "effectsloop.scene_7": { groupCode: "FXL", block: "effectsloop", paramId: 14, wikiName: "SCENE 7", name: "scene_7", controlType: "unknown" },
    "effectsloop.scene_8": { groupCode: "FXL", block: "effectsloop", paramId: 15, wikiName: "SCENE 8", name: "scene_8", controlType: "unknown" },
    "effectsloop.level": { groupCode: "FXL", block: "effectsloop", paramId: 16, wikiName: "Level", name: "level", controlType: "knob", parameterName: "OUTPUT_LEVEL", xmlLabel: "Level", modifierAssignable: true },
    "effectsloop.balance": { groupCode: "FXL", block: "effectsloop", paramId: 17, wikiName: "Balance", name: "balance", controlType: "knob", parameterName: "OUTPUT_PAN", xmlLabel: "Balance", modifierAssignable: true },
    "effectsloop.bypass_mode": { groupCode: "FXL", block: "effectsloop", paramId: 18, wikiName: "BYPASS MODE", name: "bypass_mode", controlType: "select", parameterName: "OUTPUT_BYPASSMODE", xmlLabel: "Bypass Mode", enumValues: EFFECTSLOOP_BYPASS_MODE_VALUES, modifierAssignable: true },
    "enhancer.width": { groupCode: "ENH", block: "enhancer", paramId: 0, wikiName: "WIDTH", name: "width", controlType: "knob", parameterName: "ENHANCER_WIDTH", xmlLabel: "Width" },
    "enhancer.depth": { groupCode: "ENH", block: "enhancer", paramId: 1, wikiName: "DEPTH", name: "depth", controlType: "knob", parameterName: "ENHANCER_DEPTH", xmlLabel: "Depth" },
    "enhancer.low_cut": { groupCode: "ENH", block: "enhancer", paramId: 2, wikiName: "LOW CUT", name: "low_cut", controlType: "knob", parameterName: "ENHANCER_LOWCUT", xmlLabel: "Low Cut" },
    "enhancer.high_cut": { groupCode: "ENH", block: "enhancer", paramId: 3, wikiName: "HIGH CUT", name: "high_cut", controlType: "knob", parameterName: "ENHANCER_HICUT", xmlLabel: "High Cut" },
    "enhancer.level": { groupCode: "ENH", block: "enhancer", paramId: 4, wikiName: "Level", name: "level", controlType: "knob", parameterName: "ENHANCER_LEVEL", xmlLabel: "Level" },
    "enhancer.effect_type": { groupCode: "ENH", block: "enhancer", paramId: 6, wikiName: "EFFECT TYPE", name: "effect_type", controlType: "select", enumValues: ENHANCER_EFFECT_TYPE_VALUES },
    "enhancer.invert": { groupCode: "ENH", block: "enhancer", paramId: 7, wikiName: "INVERT", name: "invert", controlType: "select", parameterName: "ENHANCER_PHASE", xmlLabel: "Invert", enumValues: ENHANCER_INVERT_VALUES },
    "enhancer.pan_left": { groupCode: "ENH", block: "enhancer", paramId: 8, wikiName: "Pan Left", name: "pan_left", controlType: "knob", parameterName: "ENHANCER_PANL", xmlLabel: "Pan Left" },
    "enhancer.pan_right": { groupCode: "ENH", block: "enhancer", paramId: 9, wikiName: "Pan Right", name: "pan_right", controlType: "knob", parameterName: "ENHANCER_PANR", xmlLabel: "Pan Right" },
    "enhancer.balance": { groupCode: "ENH", block: "enhancer", paramId: 10, wikiName: "Balance", name: "balance", controlType: "knob", parameterName: "ENHANCER_PAN", xmlLabel: "Balance" },
    "feedbackreturn.mix": { groupCode: "RTN", block: "feedbackreturn", paramId: 0, wikiName: "Mix", name: "mix", controlType: "knob", parameterName: "FDBKRET_MIX", xmlLabel: "Mix", modifierAssignable: true },
    "feedbackreturn.level": { groupCode: "RTN", block: "feedbackreturn", paramId: 1, wikiName: "Level", name: "level", controlType: "knob", parameterName: "FDBKRET_LEVEL", xmlLabel: "Level", modifierAssignable: true },
    "feedbackreturn.balance": { groupCode: "RTN", block: "feedbackreturn", paramId: 2, wikiName: "Balance", name: "balance", controlType: "knob", parameterName: "FDBKRET_PAN", xmlLabel: "Balance", modifierAssignable: true },
    "feedbackreturn.bypass_mode": { groupCode: "RTN", block: "feedbackreturn", paramId: 3, wikiName: "Bypass Mode", name: "bypass_mode", controlType: "select", parameterName: "FDBKRET_BYPASSMODE", xmlLabel: "Bypass Mode", enumValues: FEEDBACKRETURN_BYPASS_MODE_VALUES, modifierAssignable: true },
    "feedbackreturn.global_mix": { groupCode: "RTN", block: "feedbackreturn", paramId: 4, wikiName: "Global Mix", name: "global_mix", controlType: "switch" },
    "feedbacksend.send_level": { groupCode: "SND", block: "feedbacksend", paramId: 0, wikiName: "Send Level", name: "send_level", controlType: "knob", parameterName: "FDBKSEND_SENDLEVEL", xmlLabel: "Send Level" },
    "feedbacksend.out_level": { groupCode: "SND", block: "feedbacksend", paramId: 1, wikiName: "Out Level", name: "out_level", controlType: "knob" },
    "filter.effect_type": { groupCode: "FIL", block: "filter", paramId: 0, wikiName: "EFFECT TYPE", name: "effect_type", controlType: "select", enumValues: FILTER_EFFECT_TYPE_VALUES },
    "filter.frequency": { groupCode: "FIL", block: "filter", paramId: 1, wikiName: "FREQUENCY", name: "frequency", controlType: "knob", parameterName: "FILTER_FREQ", xmlLabel: "Frequency", modifierAssignable: true },
    "filter.q": { groupCode: "FIL", block: "filter", paramId: 2, wikiName: "Q", name: "q", controlType: "knob", parameterName: "FILTER_Q", xmlLabel: "Q", modifierAssignable: true },
    "filter.gain": { groupCode: "FIL", block: "filter", paramId: 3, wikiName: "GAIN", name: "gain", controlType: "knob", parameterName: "FILTER_GAIN", xmlLabel: "Gain", modifierAssignable: true },
    "filter.level": { groupCode: "FIL", block: "filter", paramId: 4, wikiName: "Level", name: "level", controlType: "knob", parameterName: "FILTER_LEVEL", xmlLabel: "Level", modifierAssignable: true },
    "filter.balance": { groupCode: "FIL", block: "filter", paramId: 5, wikiName: "Balance", name: "balance", controlType: "knob", parameterName: "FILTER_BAL", xmlLabel: "Balance", modifierAssignable: true },
    "filter.bypass_mode": { groupCode: "FIL", block: "filter", paramId: 6, wikiName: "BYPASS MODE", name: "bypass_mode", controlType: "select", parameterName: "FILTER_BYPASSMODE", xmlLabel: "Bypass Mode", enumValues: FILTER_BYPASS_MODE_VALUES, modifierAssignable: true },
    "filter.order": { groupCode: "FIL", block: "filter", paramId: 7, wikiName: "ORDER", name: "order", controlType: "select", parameterName: "FILTER_ORDER", xmlLabel: "Order", enumValues: FILTER_ORDER_VALUES },
    "filter.pan_left": { groupCode: "FIL", block: "filter", paramId: 9, wikiName: "Pan Left", name: "pan_left", controlType: "knob", parameterName: "FILTER_PANL", xmlLabel: "Pan Left" },
    "filter.pan_right": { groupCode: "FIL", block: "filter", paramId: 10, wikiName: "Pan Right", name: "pan_right", controlType: "knob", parameterName: "FILTER_PANR", xmlLabel: "Pan Right" },
    "filter.invert": { groupCode: "FIL", block: "filter", paramId: 11, wikiName: "INVERT", name: "invert", controlType: "select", parameterName: "FILTER_PHASE", xmlLabel: "Invert", enumValues: FILTER_INVERT_VALUES },
    "filter.low_cut": { groupCode: "FIL", block: "filter", paramId: 12, wikiName: "LOW CUT", name: "low_cut", controlType: "knob" },
    "filter.hi_cut": { groupCode: "FIL", block: "filter", paramId: 13, wikiName: "HI CUT", name: "hi_cut", controlType: "knob" },
    "flanger.effect_type": { groupCode: "FLG", block: "flanger", paramId: 0, wikiName: "EFFECT TYPE", name: "effect_type", controlType: "select", enumValues: FLANGER_EFFECT_TYPE_VALUES },
    "flanger.rate": { groupCode: "FLG", block: "flanger", paramId: 1, wikiName: "RATE", name: "rate", controlType: "knob", parameterName: "FLANGER_RATE", xmlLabel: "Rate", modifierAssignable: true },
    "flanger.tempo": { groupCode: "FLG", block: "flanger", paramId: 2, wikiName: "Tempo", name: "tempo", controlType: "select", parameterName: "FLANGER_TEMPO", xmlLabel: "Tempo" },
    "flanger.depth": { groupCode: "FLG", block: "flanger", paramId: 3, wikiName: "DEPTH", name: "depth", controlType: "knob", parameterName: "FLANGER_DEPTH", xmlLabel: "Depth", modifierAssignable: true },
    "flanger.feedback": { groupCode: "FLG", block: "flanger", paramId: 4, wikiName: "FEEDBACK", name: "feedback", controlType: "knob", parameterName: "FLANGER_FEEDBACK", xmlLabel: "Feedback", modifierAssignable: true },
    "flanger.delay_time": { groupCode: "FLG", block: "flanger", paramId: 5, wikiName: "DELAY TIME", name: "delay_time", controlType: "knob", parameterName: "FLANGER_DELAYTIME", xmlLabel: "Delay Time", modifierAssignable: true },
    "flanger.dry_delay_shift": { groupCode: "FLG", block: "flanger", paramId: 6, wikiName: "DRY DELAY SHIFT", name: "dry_delay_shift", controlType: "knob" },
    "flanger.lfo_phase": { groupCode: "FLG", block: "flanger", paramId: 7, wikiName: "LFO PHASE", name: "lfo_phase", controlType: "knob", parameterName: "FLANGER_LFOPHASE", xmlLabel: "LFO Phase" },
    "flanger.lfo_type": { groupCode: "FLG", block: "flanger", paramId: 8, wikiName: "LFO TYPE", name: "lfo_type", controlType: "select", parameterName: "FLANGER_LFOTYPE", xmlLabel: "LFO Type", enumValues: FLANGER_LFO_TYPE_VALUES },
    "flanger.lfo_highcut": { groupCode: "FLG", block: "flanger", paramId: 9, wikiName: "LFO HIGHCUT", name: "lfo_highcut", controlType: "knob" },
    "flanger.auto_depth": { groupCode: "FLG", block: "flanger", paramId: 10, wikiName: "AUTO DEPTH", name: "auto_depth", controlType: "select", parameterName: "FLANGER_AUTO", xmlLabel: "Auto depth", enumValues: FLANGER_AUTO_DEPTH_VALUES },
    "flanger.mix": { groupCode: "FLG", block: "flanger", paramId: 11, wikiName: "MIX", name: "mix", controlType: "knob", parameterName: "FLANGER_MIX", xmlLabel: "Mix", modifierAssignable: true },
    "flanger.level": { groupCode: "FLG", block: "flanger", paramId: 12, wikiName: "Level", name: "level", controlType: "knob", parameterName: "FLANGER_LEVEL", xmlLabel: "Level", modifierAssignable: true },
    "flanger.balance": { groupCode: "FLG", block: "flanger", paramId: 13, wikiName: "Balance", name: "balance", controlType: "knob", parameterName: "FLANGER_PAN", xmlLabel: "Balance", modifierAssignable: true },
    "flanger.bypass_mode": { groupCode: "FLG", block: "flanger", paramId: 14, wikiName: "BYPASS MODE", name: "bypass_mode", controlType: "select", parameterName: "FLANGER_BYPASSMODE", xmlLabel: "Bypass Mode", enumValues: FLANGER_BYPASS_MODE_VALUES, modifierAssignable: true },
    "flanger.global": { groupCode: "FLG", block: "flanger", paramId: 15, wikiName: "GLOBAL", name: "global", controlType: "switch" },
    "flanger.phase_reverse": { groupCode: "FLG", block: "flanger", paramId: 17, wikiName: "PHASE REVERSE", name: "phase_reverse", controlType: "select", parameterName: "FLANGER_PHASEREV", xmlLabel: "Phase Reverse", enumValues: FLANGER_PHASE_REVERSE_VALUES },
    "flanger.thru_zero": { groupCode: "FLG", block: "flanger", paramId: 18, wikiName: "THRU ZERO", name: "thru_zero", controlType: "switch", parameterName: "FLANGER_THRUZERO", xmlLabel: "Thru-Zero" },
    "flanger.high_cut": { groupCode: "FLG", block: "flanger", paramId: 19, wikiName: "HIGH CUT", name: "high_cut", controlType: "knob" },
    "flanger.drive": { groupCode: "FLG", block: "flanger", paramId: 20, wikiName: "DRIVE", name: "drive", controlType: "knob", parameterName: "FLANGER_DRIVE", xmlLabel: "Drive" },
    "flanger.low_cut": { groupCode: "FLG", block: "flanger", paramId: 21, wikiName: "LOW CUT", name: "low_cut", controlType: "knob", parameterName: "FLANGER_LOWCUT", xmlLabel: "Low Cut" },
    "flanger.spread": { groupCode: "FLG", block: "flanger", paramId: 22, wikiName: "SPREAD", name: "spread", controlType: "knob", parameterName: "FLANGER_SPREAD", xmlLabel: "Spread" },
    "formant.start": { groupCode: "FRM", block: "formant", paramId: 0, wikiName: "START", name: "start", controlType: "select", parameterName: "FORMANT_FSTART", xmlLabel: "Start", enumValues: FORMANT_START_VALUES },
    "formant.mid": { groupCode: "FRM", block: "formant", paramId: 1, wikiName: "MID", name: "mid", controlType: "select", parameterName: "FORMANT_FMID", xmlLabel: "Mid", enumValues: FORMANT_MID_VALUES },
    "formant.end": { groupCode: "FRM", block: "formant", paramId: 2, wikiName: "END", name: "end", controlType: "select", parameterName: "FORMANT_FEND", xmlLabel: "End", enumValues: FORMANT_END_VALUES },
    "formant.resonance": { groupCode: "FRM", block: "formant", paramId: 3, wikiName: "RESONANCE", name: "resonance", controlType: "knob", parameterName: "FORMANT_Q", xmlLabel: "Resonance", modifierAssignable: true },
    "formant.control": { groupCode: "FRM", block: "formant", paramId: 4, wikiName: "CONTROL", name: "control", controlType: "knob", parameterName: "FORMANT_CTRL", xmlLabel: "Control", modifierAssignable: true },
    "formant.mix": { groupCode: "FRM", block: "formant", paramId: 5, wikiName: "MIX", name: "mix", controlType: "knob", parameterName: "FORMANT_MIX", xmlLabel: "Mix", modifierAssignable: true },
    "formant.level": { groupCode: "FRM", block: "formant", paramId: 6, wikiName: "Level", name: "level", controlType: "knob", parameterName: "FORMANT_LEVEL", xmlLabel: "Level", modifierAssignable: true },
    "formant.balance": { groupCode: "FRM", block: "formant", paramId: 7, wikiName: "Balance", name: "balance", controlType: "knob", parameterName: "FORMANT_PAN", xmlLabel: "Balance", modifierAssignable: true },
    "formant.bypass_mode": { groupCode: "FRM", block: "formant", paramId: 8, wikiName: "BYPASS MODE", name: "bypass_mode", controlType: "select", parameterName: "FORMANT_BYPASSMODE", xmlLabel: "Bypass Mode", enumValues: FORMANT_BYPASS_MODE_VALUES, modifierAssignable: true },
    "formant.global": { groupCode: "FRM", block: "formant", paramId: 9, wikiName: "GLOBAL", name: "global", controlType: "switch" },
    "gateexpander.threshold": { groupCode: "GTE", block: "gateexpander", paramId: 0, wikiName: "THRESHOLD", name: "threshold", controlType: "knob", parameterName: "GATE_THRESH", xmlLabel: "Threshold", modifierAssignable: true },
    "gateexpander.attack": { groupCode: "GTE", block: "gateexpander", paramId: 1, wikiName: "ATTACK", name: "attack", controlType: "knob", parameterName: "GATE_ATTACK", xmlLabel: "Attack" },
    "gateexpander.hold": { groupCode: "GTE", block: "gateexpander", paramId: 2, wikiName: "HOLD", name: "hold", controlType: "knob", parameterName: "GATE_HOLD", xmlLabel: "Hold" },
    "gateexpander.release": { groupCode: "GTE", block: "gateexpander", paramId: 3, wikiName: "RELEASE", name: "release", controlType: "knob", parameterName: "GATE_RELEASE", xmlLabel: "Release" },
    "gateexpander.ratio": { groupCode: "GTE", block: "gateexpander", paramId: 4, wikiName: "RATIO", name: "ratio", controlType: "knob", parameterName: "GATE_RATIO", xmlLabel: "Ratio", modifierAssignable: true },
    "gateexpander.sidechain_select": { groupCode: "GTE", block: "gateexpander", paramId: 5, wikiName: "SIDECHAIN SELECT", name: "sidechain_select", controlType: "select", parameterName: "GATE_KEY", xmlLabel: "Sidechain Select", enumValues: GATEEXPANDER_SIDECHAIN_SELECT_VALUES },
    "gateexpander.low_cut": { groupCode: "GTE", block: "gateexpander", paramId: 6, wikiName: "LOW CUT", name: "low_cut", controlType: "knob", parameterName: "GATE_LOWCUT", xmlLabel: "Low Cut" },
    "gateexpander.high_cut": { groupCode: "GTE", block: "gateexpander", paramId: 7, wikiName: "HIGH CUT", name: "high_cut", controlType: "knob", parameterName: "GATE_HICUT", xmlLabel: "High Cut" },
    "gateexpander.level": { groupCode: "GTE", block: "gateexpander", paramId: 9, wikiName: "Level", name: "level", controlType: "knob", parameterName: "GATE_LEVEL", xmlLabel: "Level", modifierAssignable: true },
    "gateexpander.balance": { groupCode: "GTE", block: "gateexpander", paramId: 10, wikiName: "Balance", name: "balance", controlType: "knob", parameterName: "GATE_PAN", xmlLabel: "Balance", modifierAssignable: true },
    "gateexpander.bypass_mode": { groupCode: "GTE", block: "gateexpander", paramId: 11, wikiName: "BYPASS MODE", name: "bypass_mode", controlType: "select", parameterName: "GATE_BYPASSMODE", xmlLabel: "Bypass Mode", enumValues: GATEEXPANDER_BYPASS_MODE_VALUES, modifierAssignable: true },
    "graphiceq.31": { groupCode: "GEQ", block: "graphiceq", paramId: 0, wikiName: "31", name: "31", controlType: "unknown", parameterName: "GEQ_GAIN1", xmlLabel: "31", gateOn: "GEQ_TYPE" },
    "graphiceq.63": { groupCode: "GEQ", block: "graphiceq", paramId: 1, wikiName: "63", name: "63", controlType: "unknown", parameterName: "GEQ_GAIN2", xmlLabel: "63", gateOn: "GEQ_TYPE" },
    "graphiceq.125": { groupCode: "GEQ", block: "graphiceq", paramId: 2, wikiName: "125", name: "125", controlType: "unknown", parameterName: "GEQ_GAIN3", xmlLabel: "125", gateOn: "GEQ_TYPE" },
    "graphiceq.250": { groupCode: "GEQ", block: "graphiceq", paramId: 3, wikiName: "250", name: "250", controlType: "unknown", parameterName: "GEQ_GAIN4", xmlLabel: "250", gateOn: "GEQ_TYPE" },
    "graphiceq.500": { groupCode: "GEQ", block: "graphiceq", paramId: 4, wikiName: "500", name: "500", controlType: "unknown", parameterName: "GEQ_GAIN5", xmlLabel: "500", gateOn: "GEQ_TYPE" },
    "graphiceq.1k": { groupCode: "GEQ", block: "graphiceq", paramId: 5, wikiName: "1K", name: "1k", controlType: "unknown", parameterName: "GEQ_GAIN6", xmlLabel: "1k", gateOn: "GEQ_TYPE" },
    "graphiceq.2k": { groupCode: "GEQ", block: "graphiceq", paramId: 6, wikiName: "2K", name: "2k", controlType: "unknown", parameterName: "GEQ_GAIN7", xmlLabel: "2k", gateOn: "GEQ_TYPE" },
    "graphiceq.4k": { groupCode: "GEQ", block: "graphiceq", paramId: 7, wikiName: "4K", name: "4k", controlType: "unknown", parameterName: "GEQ_GAIN8", xmlLabel: "4k", gateOn: "GEQ_TYPE" },
    "graphiceq.8k": { groupCode: "GEQ", block: "graphiceq", paramId: 8, wikiName: "8K", name: "8k", controlType: "unknown", parameterName: "GEQ_GAIN9", xmlLabel: "8k", gateOn: "GEQ_TYPE" },
    "graphiceq.16k": { groupCode: "GEQ", block: "graphiceq", paramId: 9, wikiName: "16K", name: "16k", controlType: "unknown", parameterName: "GEQ_GAIN10", xmlLabel: "16k", gateOn: "GEQ_TYPE" },
    "graphiceq.level": { groupCode: "GEQ", block: "graphiceq", paramId: 11, wikiName: "Level", name: "level", controlType: "knob", parameterName: "GEQ_LEVEL", xmlLabel: "Level", modifierAssignable: true },
    "graphiceq.balance": { groupCode: "GEQ", block: "graphiceq", paramId: 12, wikiName: "Balance", name: "balance", controlType: "knob", parameterName: "GEQ_PAN", xmlLabel: "Balance", modifierAssignable: true },
    "graphiceq.bypass_mode": { groupCode: "GEQ", block: "graphiceq", paramId: 13, wikiName: "BYPASS MODE", name: "bypass_mode", controlType: "select", parameterName: "GEQ_BYPASSMODE", xmlLabel: "Bypass Mode", enumValues: GRAPHICEQ_BYPASS_MODE_VALUES, modifierAssignable: true },
    "graphiceq.effect_type": { groupCode: "GEQ", block: "graphiceq", paramId: 15, wikiName: "EFFECT TYPE", name: "effect_type", controlType: "select", enumValues: GRAPHICEQ_EFFECT_TYPE_VALUES },
    "graphiceq.master_q": { groupCode: "GEQ", block: "graphiceq", paramId: 16, wikiName: "MASTER Q", name: "master_q", controlType: "knob", parameterName: "GEQ_MASTERQ", xmlLabel: "Master Q" },
    "input.threshold": { groupCode: "INPUT", block: "input", paramId: 0, wikiName: "THRESHOLD", name: "threshold", controlType: "knob", modifierAssignable: true },
    "input.ratio": { groupCode: "INPUT", block: "input", paramId: 1, wikiName: "RATIO", name: "ratio", controlType: "knob", modifierAssignable: true },
    "input.release": { groupCode: "INPUT", block: "input", paramId: 2, wikiName: "RELEASE", name: "release", controlType: "knob" },
    "input.attack": { groupCode: "INPUT", block: "input", paramId: 3, wikiName: "ATTACK", name: "attack", controlType: "knob" },
    "input.input_z": { groupCode: "INPUT", block: "input", paramId: 4, wikiName: "INPUT Z", name: "input_z", controlType: "select", enumValues: INPUT_INPUT_Z_VALUES },
    "input.level": { groupCode: "INPUT", block: "input", paramId: 5, wikiName: "Level", name: "level", controlType: "knob" },
    "input.effect_type": { groupCode: "INPUT", block: "input", paramId: 7, wikiName: "EFFECT TYPE", name: "effect_type", controlType: "select", enumValues: INPUT_EFFECT_TYPE_VALUES },
    "looper.mix": { groupCode: "LPR", block: "looper", paramId: 0, wikiName: "MIX", name: "mix", controlType: "knob", parameterName: "LOOPER_MIX", xmlLabel: "Mix", modifierAssignable: true },
    "looper.level": { groupCode: "LPR", block: "looper", paramId: 1, wikiName: "Level", name: "level", controlType: "knob", parameterName: "LOOPER_LEVEL", xmlLabel: "Level", modifierAssignable: true },
    "looper.balance": { groupCode: "LPR", block: "looper", paramId: 2, wikiName: "Balance", name: "balance", controlType: "knob", parameterName: "LOOPER_PAN", xmlLabel: "Balance", modifierAssignable: true },
    "looper.bypass_mode": { groupCode: "LPR", block: "looper", paramId: 3, wikiName: "BYPASS MODE", name: "bypass_mode", controlType: "select", parameterName: "LOOPER_BYPASSMODE", xmlLabel: "Bypass Mode", enumValues: LOOPER_BYPASS_MODE_VALUES, modifierAssignable: true },
    "looper.dub_mix": { groupCode: "LPR", block: "looper", paramId: 5, wikiName: "DUB MIX", name: "dub_mix", controlType: "knob", parameterName: "LOOPER_OVERDUBMIX", xmlLabel: "Dub Mix", modifierAssignable: true },
    "looper.threshold": { groupCode: "LPR", block: "looper", paramId: 6, wikiName: "THRESHOLD", name: "threshold", controlType: "switch", parameterName: "LOOPER_THRESH", xmlLabel: "Threshold" },
    "looper.thres_level": { groupCode: "LPR", block: "looper", paramId: 7, wikiName: "THRES Level", name: "thres_level", controlType: "knob" },
    "looper.mode": { groupCode: "LPR", block: "looper", paramId: 8, wikiName: "MODE", name: "mode", controlType: "select", parameterName: "LOOPER_MODE", xmlLabel: "Mode", enumValues: LOOPER_MODE_VALUES },
    "looper.quantize": { groupCode: "LPR", block: "looper", paramId: 9, wikiName: "QUANTIZE", name: "quantize", controlType: "select", parameterName: "LOOPER_QUANTIZE", xmlLabel: "Quantize", enumValues: LOOPER_QUANTIZE_VALUES },
    "looper.trim_stop": { groupCode: "LPR", block: "looper", paramId: 10, wikiName: "TRIM STOP", name: "trim_stop", controlType: "knob", parameterName: "LOOPER_STOP", xmlLabel: "Trim Stop", modifierAssignable: true },
    "looper.trim_start": { groupCode: "LPR", block: "looper", paramId: 11, wikiName: "TRIM START", name: "trim_start", controlType: "knob", parameterName: "LOOPER_START", xmlLabel: "Trim Start", modifierAssignable: true },
    "looper.immediate_play": { groupCode: "LPR", block: "looper", paramId: 12, wikiName: "IMMEDIATE PLAY", name: "immediate_play", controlType: "switch", parameterName: "LOOPER_PLAYIMMEDIATE", xmlLabel: "Immediate Play" },
    "looper.record_beats": { groupCode: "LPR", block: "looper", paramId: 13, wikiName: "RECORD BEATS", name: "record_beats", controlType: "unknown", parameterName: "LOOPER_RECORDBEATS", xmlLabel: "Record Beats", displayMin: 0, displayMax: 16, step: 1 },
    "megatap.in_gain": { groupCode: "MGT", block: "megatap", paramId: 0, wikiName: "In Gain", name: "in_gain", controlType: "knob", parameterName: "MEGATAP_INGAIN", xmlLabel: "In Gain", modifierAssignable: true },
    "megatap.master_level": { groupCode: "MGT", block: "megatap", paramId: 1, wikiName: "Master Level", name: "master_level", controlType: "knob", parameterName: "MEGATAP_MASTERLVL", xmlLabel: "Master level", modifierAssignable: true },
    "megatap.time": { groupCode: "MGT", block: "megatap", paramId: 2, wikiName: "Time", name: "time", controlType: "knob", parameterName: "MEGATAP_TIME", xmlLabel: "Time", modifierAssignable: true },
    "mixer.gain_1": { groupCode: "MIX", block: "mixer", paramId: 0, wikiName: "Gain 1", name: "gain_1", controlType: "unknown", parameterName: "MIXER_GAIN1", xmlLabel: "Gain 1", modifierAssignable: true },
    "mixer.gain_2": { groupCode: "MIX", block: "mixer", paramId: 1, wikiName: "Gain 2", name: "gain_2", controlType: "unknown", parameterName: "MIXER_GAIN2", xmlLabel: "Gain 2", modifierAssignable: true },
    "mixer.gain_3": { groupCode: "MIX", block: "mixer", paramId: 2, wikiName: "Gain 3", name: "gain_3", controlType: "unknown", parameterName: "MIXER_GAIN3", xmlLabel: "Gain 3", modifierAssignable: true },
    "mixer.gain_4": { groupCode: "MIX", block: "mixer", paramId: 3, wikiName: "Gain 4", name: "gain_4", controlType: "unknown", parameterName: "MIXER_GAIN4", xmlLabel: "Gain 4", modifierAssignable: true },
    "mixer.balance_1": { groupCode: "MIX", block: "mixer", paramId: 4, wikiName: "Balance 1", name: "balance_1", controlType: "knob", parameterName: "MIXER_PAN1", xmlLabel: "Balance 1", modifierAssignable: true },
    "mixer.balance_2": { groupCode: "MIX", block: "mixer", paramId: 5, wikiName: "Balance 2", name: "balance_2", controlType: "knob", parameterName: "MIXER_PAN2", xmlLabel: "Balance 2", modifierAssignable: true },
    "mixer.balance_3": { groupCode: "MIX", block: "mixer", paramId: 6, wikiName: "Balance 3", name: "balance_3", controlType: "knob", parameterName: "MIXER_PAN3", xmlLabel: "Balance 3", modifierAssignable: true },
    "mixer.balance_4": { groupCode: "MIX", block: "mixer", paramId: 7, wikiName: "Balance 4", name: "balance_4", controlType: "knob", parameterName: "MIXER_PAN4", xmlLabel: "Balance 4", modifierAssignable: true },
    "mixer.master": { groupCode: "MIX", block: "mixer", paramId: 8, wikiName: "Master", name: "master", controlType: "knob", modifierAssignable: true },
    "mixer.out_mode": { groupCode: "MIX", block: "mixer", paramId: 9, wikiName: "Out Mode", name: "out_mode", controlType: "select", enumValues: MIXER_OUT_MODE_VALUES, modifierAssignable: true },
    "multibandcomp.freq_1": { groupCode: "MBC", block: "multibandcomp", paramId: 0, wikiName: "Freq 1", name: "freq_1", controlType: "knob", parameterName: "MULTICOMP_FREQ1", xmlLabel: "Freq 1" },
    "multibandcomp.freq_2": { groupCode: "MBC", block: "multibandcomp", paramId: 1, wikiName: "Freq 2", name: "freq_2", controlType: "knob", parameterName: "MULTICOMP_FREQ2", xmlLabel: "Freq 2" },
    "multibandcomp.threshold_1": { groupCode: "MBC", block: "multibandcomp", paramId: 2, wikiName: "Threshold 1", name: "threshold_1", controlType: "knob" },
    "multibandcomp.ratio_1": { groupCode: "MBC", block: "multibandcomp", paramId: 3, wikiName: "Ratio 1", name: "ratio_1", controlType: "knob", parameterName: "MULTICOMP_RATIO1", xmlLabel: "Ratio 1" },
    "multibandcomp.attack_1": { groupCode: "MBC", block: "multibandcomp", paramId: 4, wikiName: "Attack 1", name: "attack_1", controlType: "knob", parameterName: "MULTICOMP_ATTACK1", xmlLabel: "Attack 1" },
    "multibandcomp.release_1": { groupCode: "MBC", block: "multibandcomp", paramId: 5, wikiName: "Release 1", name: "release_1", controlType: "knob", parameterName: "MULTICOMP_RELEASE1", xmlLabel: "Release 1" },
    "multibandcomp.level_1": { groupCode: "MBC", block: "multibandcomp", paramId: 6, wikiName: "Level 1", name: "level_1", controlType: "knob", parameterName: "MULTICOMP_LEVEL1", xmlLabel: "Level 1" },
    "multibandcomp.detect_1": { groupCode: "MBC", block: "multibandcomp", paramId: 7, wikiName: "Detect 1", name: "detect_1", controlType: "select", parameterName: "MULTICOMP_DETECT1", xmlLabel: "Detect 1", enumValues: MULTIBANDCOMP_DETECT_1_VALUES },
    "multibandcomp.mute_1": { groupCode: "MBC", block: "multibandcomp", paramId: 8, wikiName: "Mute 1", name: "mute_1", controlType: "switch", parameterName: "MULTICOMP_MUTE1", xmlLabel: "Mute 1" },
    "multibandcomp.threshold_2": { groupCode: "MBC", block: "multibandcomp", paramId: 9, wikiName: "Threshold 2", name: "threshold_2", controlType: "knob" },
    "multibandcomp.ratio_2": { groupCode: "MBC", block: "multibandcomp", paramId: 10, wikiName: "Ratio 2", name: "ratio_2", controlType: "knob", parameterName: "MULTICOMP_RATIO2", xmlLabel: "Ratio 2" },
    "multibandcomp.attack_2": { groupCode: "MBC", block: "multibandcomp", paramId: 11, wikiName: "Attack 2", name: "attack_2", controlType: "knob", parameterName: "MULTICOMP_ATTACK2", xmlLabel: "Attack 2" },
    "multibandcomp.release_2": { groupCode: "MBC", block: "multibandcomp", paramId: 12, wikiName: "Release 2", name: "release_2", controlType: "knob", parameterName: "MULTICOMP_RELEASE2", xmlLabel: "Release 2" },
    "multibandcomp.level_2": { groupCode: "MBC", block: "multibandcomp", paramId: 13, wikiName: "Level 2", name: "level_2", controlType: "knob", parameterName: "MULTICOMP_LEVEL2", xmlLabel: "Level 2" },
    "multibandcomp.detect_2": { groupCode: "MBC", block: "multibandcomp", paramId: 14, wikiName: "Detect 2", name: "detect_2", controlType: "select", parameterName: "MULTICOMP_DETECT2", xmlLabel: "Detect 2", enumValues: MULTIBANDCOMP_DETECT_2_VALUES },
    "multibandcomp.mute_2": { groupCode: "MBC", block: "multibandcomp", paramId: 15, wikiName: "Mute 2", name: "mute_2", controlType: "switch", parameterName: "MULTICOMP_MUTE2", xmlLabel: "Mute 2" },
    "multibandcomp.threshold_3": { groupCode: "MBC", block: "multibandcomp", paramId: 16, wikiName: "Threshold 3", name: "threshold_3", controlType: "knob" },
    "multibandcomp.ratio_3": { groupCode: "MBC", block: "multibandcomp", paramId: 17, wikiName: "Ratio 3", name: "ratio_3", controlType: "knob", parameterName: "MULTICOMP_RATIO3", xmlLabel: "Ratio 3" },
    "multibandcomp.attack_3": { groupCode: "MBC", block: "multibandcomp", paramId: 18, wikiName: "Attack 3", name: "attack_3", controlType: "knob", parameterName: "MULTICOMP_ATTACK3", xmlLabel: "Attack 3" },
    "multibandcomp.release_3": { groupCode: "MBC", block: "multibandcomp", paramId: 19, wikiName: "Release 3", name: "release_3", controlType: "knob", parameterName: "MULTICOMP_RELEASE3", xmlLabel: "Release 3" },
    "multibandcomp.level_3": { groupCode: "MBC", block: "multibandcomp", paramId: 20, wikiName: "Level 3", name: "level_3", controlType: "knob", parameterName: "MULTICOMP_LEVEL3", xmlLabel: "Level 3" },
    "multibandcomp.detect_3": { groupCode: "MBC", block: "multibandcomp", paramId: 21, wikiName: "Detect 3", name: "detect_3", controlType: "select", parameterName: "MULTICOMP_DETECT3", xmlLabel: "Detect 3", enumValues: MULTIBANDCOMP_DETECT_3_VALUES },
    "multibandcomp.mute_3": { groupCode: "MBC", block: "multibandcomp", paramId: 22, wikiName: "Mute 3", name: "mute_3", controlType: "switch", parameterName: "MULTICOMP_MUTE3", xmlLabel: "Mute 3" },
    "multibandcomp.level": { groupCode: "MBC", block: "multibandcomp", paramId: 24, wikiName: "Level", name: "level", controlType: "knob", parameterName: "MULTICOMP_LEVEL", xmlLabel: "Level", modifierAssignable: true },
    "multibandcomp.balance": { groupCode: "MBC", block: "multibandcomp", paramId: 25, wikiName: "Balance", name: "balance", controlType: "knob", parameterName: "MULTICOMP_PAN", xmlLabel: "Balance", modifierAssignable: true },
    "multibandcomp.bypass_mode": { groupCode: "MBC", block: "multibandcomp", paramId: 26, wikiName: "BYPASS MODE", name: "bypass_mode", controlType: "select", parameterName: "MULTICOMP_BYPASSMODE", xmlLabel: "Bypass Mode", enumValues: MULTIBANDCOMP_BYPASS_MODE_VALUES, modifierAssignable: true },
    "multidelay.time_1": { groupCode: "MTD", block: "multidelay", paramId: 0, wikiName: "TIME 1", name: "time_1", controlType: "knob", parameterName: "MULTITAP_TIME1", xmlLabel: "Time 1" },
    "multidelay.time_2": { groupCode: "MTD", block: "multidelay", paramId: 1, wikiName: "TIME 2", name: "time_2", controlType: "knob", parameterName: "MULTITAP_TIME2", xmlLabel: "Time 2" },
    "multidelay.time_3": { groupCode: "MTD", block: "multidelay", paramId: 2, wikiName: "TIME 3", name: "time_3", controlType: "knob", parameterName: "MULTITAP_TIME3", xmlLabel: "Time 3" },
    "multidelay.time_4": { groupCode: "MTD", block: "multidelay", paramId: 3, wikiName: "TIME 4", name: "time_4", controlType: "knob", parameterName: "MULTITAP_TIME4", xmlLabel: "Time 4" },
    "multidelay.tempo_1": { groupCode: "MTD", block: "multidelay", paramId: 4, wikiName: "Tempo 1", name: "tempo_1", controlType: "select", parameterName: "MULTITAP_TEMPO1", xmlLabel: "Tempo 1" },
    "multidelay.tempo_2": { groupCode: "MTD", block: "multidelay", paramId: 5, wikiName: "Tempo 2", name: "tempo_2", controlType: "select", parameterName: "MULTITAP_TEMPO2", xmlLabel: "Tempo 2" },
    "multidelay.tempo_3": { groupCode: "MTD", block: "multidelay", paramId: 6, wikiName: "Tempo 3", name: "tempo_3", controlType: "select", parameterName: "MULTITAP_TEMPO3", xmlLabel: "Tempo 3" },
    "multidelay.tempo_4": { groupCode: "MTD", block: "multidelay", paramId: 7, wikiName: "Tempo 4", name: "tempo_4", controlType: "select", parameterName: "MULTITAP_TEMPO4", xmlLabel: "Tempo 4" },
    "multidelay.level_1": { groupCode: "MTD", block: "multidelay", paramId: 8, wikiName: "Level 1", name: "level_1", controlType: "knob", parameterName: "MULTITAP_LEVEL1", xmlLabel: "Level 1" },
    "multidelay.level_2": { groupCode: "MTD", block: "multidelay", paramId: 9, wikiName: "Level 2", name: "level_2", controlType: "knob", parameterName: "MULTITAP_LEVEL2", xmlLabel: "Level 2" },
    "multidelay.level_3": { groupCode: "MTD", block: "multidelay", paramId: 10, wikiName: "Level 3", name: "level_3", controlType: "knob", parameterName: "MULTITAP_LEVEL3", xmlLabel: "Level 3" },
    "multidelay.level_4": { groupCode: "MTD", block: "multidelay", paramId: 11, wikiName: "Level 4", name: "level_4", controlType: "knob", parameterName: "MULTITAP_LEVEL4", xmlLabel: "Level 4" },
    "multidelay.feedback_1": { groupCode: "MTD", block: "multidelay", paramId: 12, wikiName: "FEEDBACK 1", name: "feedback_1", controlType: "knob", parameterName: "MULTITAP_FEEDBACK1", xmlLabel: "Feedback 1" },
    "multidelay.feedback_2": { groupCode: "MTD", block: "multidelay", paramId: 13, wikiName: "FEEDBACK 2", name: "feedback_2", controlType: "knob", parameterName: "MULTITAP_FEEDBACK2", xmlLabel: "Feedback 2" },
    "multidelay.feedback_3": { groupCode: "MTD", block: "multidelay", paramId: 14, wikiName: "FEEDBACK 3", name: "feedback_3", controlType: "knob", parameterName: "MULTITAP_FEEDBACK3", xmlLabel: "Feedback 3" },
    "multidelay.feedback_4": { groupCode: "MTD", block: "multidelay", paramId: 15, wikiName: "FEEDBACK 4", name: "feedback_4", controlType: "knob", parameterName: "MULTITAP_FEEDBACK4", xmlLabel: "Feedback 4" },
    "multidelay.pan_1": { groupCode: "MTD", block: "multidelay", paramId: 16, wikiName: "Pan 1", name: "pan_1", controlType: "knob", parameterName: "MULTITAP_PAN1", xmlLabel: "Pan 1" },
    "multidelay.pan_2": { groupCode: "MTD", block: "multidelay", paramId: 17, wikiName: "Pan 2", name: "pan_2", controlType: "knob", parameterName: "MULTITAP_PAN2", xmlLabel: "Pan 2" },
    "multidelay.pan_3": { groupCode: "MTD", block: "multidelay", paramId: 18, wikiName: "Pan 3", name: "pan_3", controlType: "knob", parameterName: "MULTITAP_PAN3", xmlLabel: "Pan 3" },
    "multidelay.pan_4": { groupCode: "MTD", block: "multidelay", paramId: 19, wikiName: "Pan 4", name: "pan_4", controlType: "knob", parameterName: "MULTITAP_PAN4", xmlLabel: "Pan 4" },
    "multidelay.lfo1_rate": { groupCode: "MTD", block: "multidelay", paramId: 20, wikiName: "LFO1 RATE", name: "lfo1_rate", controlType: "knob", parameterName: "MULTITAP_RATE1", xmlLabel: "LFO1 Rate" },
    "multidelay.lfo2_rate": { groupCode: "MTD", block: "multidelay", paramId: 21, wikiName: "LFO2 RATE", name: "lfo2_rate", controlType: "knob", parameterName: "MULTITAP_RATE2", xmlLabel: "LFO2 Rate" },
    "multidelay.lfo3_rate": { groupCode: "MTD", block: "multidelay", paramId: 22, wikiName: "LFO3 RATE", name: "lfo3_rate", controlType: "knob", parameterName: "MULTITAP_RATE3", xmlLabel: "LFO3 Rate" },
    "multidelay.lfo4_rate": { groupCode: "MTD", block: "multidelay", paramId: 23, wikiName: "LFO4 RATE", name: "lfo4_rate", controlType: "knob", parameterName: "MULTITAP_RATE4", xmlLabel: "LFO4 Rate" },
    "multidelay.lfo1_tempo": { groupCode: "MTD", block: "multidelay", paramId: 24, wikiName: "LFO1 Tempo", name: "lfo1_tempo", controlType: "select", parameterName: "MULTITAP_LFOTEMPO1", xmlLabel: "LFO1 Tempo" },
    "multidelay.lfo2_tempo": { groupCode: "MTD", block: "multidelay", paramId: 25, wikiName: "LFO2 Tempo", name: "lfo2_tempo", controlType: "select", parameterName: "MULTITAP_LFOTEMPO2", xmlLabel: "LFO2 Tempo" },
    "multidelay.lfo3_tempo": { groupCode: "MTD", block: "multidelay", paramId: 26, wikiName: "LFO3 Tempo", name: "lfo3_tempo", controlType: "select", parameterName: "MULTITAP_LFOTEMPO3", xmlLabel: "LFO3 Tempo" },
    "multidelay.lfo4_tempo": { groupCode: "MTD", block: "multidelay", paramId: 27, wikiName: "LFO4 Tempo", name: "lfo4_tempo", controlType: "select", parameterName: "MULTITAP_LFOTEMPO4", xmlLabel: "LFO4 Tempo" },
    "multidelay.mix": { groupCode: "MTD", block: "multidelay", paramId: 28, wikiName: "MIX", name: "mix", controlType: "knob", parameterName: "MULTITAP_MIX", xmlLabel: "Mix", modifierAssignable: true },
    "multidelay.level": { groupCode: "MTD", block: "multidelay", paramId: 29, wikiName: "Level", name: "level", controlType: "knob", parameterName: "MULTITAP_LEVEL", xmlLabel: "Level", modifierAssignable: true },
    "multidelay.balance": { groupCode: "MTD", block: "multidelay", paramId: 30, wikiName: "Balance", name: "balance", controlType: "knob", parameterName: "MULTITAP_PAN", xmlLabel: "Balance", modifierAssignable: true },
    "multidelay.bypass_mode": { groupCode: "MTD", block: "multidelay", paramId: 31, wikiName: "BYPASS MODE", name: "bypass_mode", controlType: "select", parameterName: "MULTITAP_BYPASSMODE", xmlLabel: "Bypass Mode", enumValues: MULTIDELAY_BYPASS_MODE_VALUES, modifierAssignable: true },
    "multidelay.global_mix": { groupCode: "MTD", block: "multidelay", paramId: 32, wikiName: "GLOBAL MIX", name: "global_mix", controlType: "switch" },
    "multidelay.input_gain": { groupCode: "MTD", block: "multidelay", paramId: 33, wikiName: "INPUT GAIN", name: "input_gain", controlType: "knob", parameterName: "MULTITAP_INGAIN", xmlLabel: "Input Gain", modifierAssignable: true },
    "multidelay.effect_type": { groupCode: "MTD", block: "multidelay", paramId: 35, wikiName: "EFFECT TYPE", name: "effect_type", controlType: "select", enumValues: MULTIDELAY_EFFECT_TYPE_VALUES },
    "multidelay.decay_time": { groupCode: "MTD", block: "multidelay", paramId: 36, wikiName: "DECAY TIME", name: "decay_time", controlType: "knob", parameterName: "MULTITAP_DECAY", xmlLabel: "Decay Time" },
    "multidelay.diffusion": { groupCode: "MTD", block: "multidelay", paramId: 37, wikiName: "DIFFUSION", name: "diffusion", controlType: "knob", parameterName: "MULTITAP_DIFFUSION", xmlLabel: "Diffusion" },
    "multidelay.input_diff": { groupCode: "MTD", block: "multidelay", paramId: 38, wikiName: "INPUT DIFF", name: "input_diff", controlType: "knob" },
    "multidelay.diff_time": { groupCode: "MTD", block: "multidelay", paramId: 39, wikiName: "DIFF TIME", name: "diff_time", controlType: "knob" },
    "multidelay.ducker_thres": { groupCode: "MTD", block: "multidelay", paramId: 40, wikiName: "DUCKER THRES", name: "ducker_thres", controlType: "knob" },
    "multidelay.crossfade": { groupCode: "MTD", block: "multidelay", paramId: 41, wikiName: "CROSSFADE", name: "crossfade", controlType: "knob", parameterName: "MULTITAP_SPLICE", xmlLabel: "Crossfade" },
    "multidelay.master_time": { groupCode: "MTD", block: "multidelay", paramId: 42, wikiName: "MASTER TIME", name: "master_time", controlType: "knob", parameterName: "MULTITAP_MSTRTIME", xmlLabel: "Master Time", modifierAssignable: true },
    "multidelay.master_level": { groupCode: "MTD", block: "multidelay", paramId: 43, wikiName: "MASTER Level", name: "master_level", controlType: "knob", parameterName: "MULTITAP_MSTRLVL", xmlLabel: "Master Level", modifierAssignable: true },
    "multidelay.master_pan": { groupCode: "MTD", block: "multidelay", paramId: 44, wikiName: "MASTER Pan", name: "master_pan", controlType: "knob", parameterName: "MULTITAP_MSTRPAN", xmlLabel: "Master Pan", modifierAssignable: true },
    "multidelay.master_freq": { groupCode: "MTD", block: "multidelay", paramId: 45, wikiName: "MASTER FREQ", name: "master_freq", controlType: "knob", modifierAssignable: true },
    "multidelay.master_q": { groupCode: "MTD", block: "multidelay", paramId: 46, wikiName: "MASTER Q", name: "master_q", controlType: "knob", parameterName: "MULTITAP_MSTRQ", xmlLabel: "Master Q", modifierAssignable: true },
    "multidelay.master_feedback": { groupCode: "MTD", block: "multidelay", paramId: 47, wikiName: "MASTER FEEDBACK", name: "master_feedback", controlType: "knob", parameterName: "MULTITAP_MSTRFDBK", xmlLabel: "Master Feedback", modifierAssignable: true },
    "multidelay.master_pitch": { groupCode: "MTD", block: "multidelay", paramId: 48, wikiName: "MASTER PITCH", name: "master_pitch", controlType: "knob", parameterName: "MULTITAP_MSTRPITCH", xmlLabel: "Master Pitch", modifierAssignable: true },
    "multidelay.master_detune": { groupCode: "MTD", block: "multidelay", paramId: 49, wikiName: "MASTER DETUNE", name: "master_detune", controlType: "knob", parameterName: "MULTITAP_MSTRDTN", xmlLabel: "Master Detune", modifierAssignable: true },
    "multidelay.detune_1": { groupCode: "MTD", block: "multidelay", paramId: 50, wikiName: "DETUNE 1", name: "detune_1", controlType: "knob", parameterName: "MULTITAP_DETUNE1", xmlLabel: "Detune 1" },
    "multidelay.detune_2": { groupCode: "MTD", block: "multidelay", paramId: 51, wikiName: "DETUNE 2", name: "detune_2", controlType: "knob", parameterName: "MULTITAP_DETUNE2", xmlLabel: "Detune 2" },
    "multidelay.detune_3": { groupCode: "MTD", block: "multidelay", paramId: 52, wikiName: "DETUNE 3", name: "detune_3", controlType: "knob", parameterName: "MULTITAP_DETUNE3", xmlLabel: "Detune 3" },
    "multidelay.detune_4": { groupCode: "MTD", block: "multidelay", paramId: 53, wikiName: "DETUNE 4", name: "detune_4", controlType: "knob", parameterName: "MULTITAP_DETUNE4", xmlLabel: "Detune 4" },
    "multidelay.shift_1": { groupCode: "MTD", block: "multidelay", paramId: 54, wikiName: "SHIFT 1", name: "shift_1", controlType: "unknown", parameterName: "MULTITAP_SHIFT1", xmlLabel: "Shift 1", displayMin: 0, displayMax: 48, step: 1 },
    "multidelay.shift_2": { groupCode: "MTD", block: "multidelay", paramId: 55, wikiName: "SHIFT 2", name: "shift_2", controlType: "unknown", parameterName: "MULTITAP_SHIFT2", xmlLabel: "Shift 2", displayMin: 0, displayMax: 48, step: 1 },
    "multidelay.shift_3": { groupCode: "MTD", block: "multidelay", paramId: 56, wikiName: "SHIFT 3", name: "shift_3", controlType: "unknown", parameterName: "MULTITAP_SHIFT3", xmlLabel: "Shift 3", displayMin: 0, displayMax: 48, step: 1 },
    "multidelay.shift_4": { groupCode: "MTD", block: "multidelay", paramId: 57, wikiName: "SHIFT 4", name: "shift_4", controlType: "unknown", parameterName: "MULTITAP_SHIFT4", xmlLabel: "Shift 4", displayMin: 0, displayMax: 48, step: 1 },
    "multidelay.freq_1": { groupCode: "MTD", block: "multidelay", paramId: 58, wikiName: "FREQ 1", name: "freq_1", controlType: "knob", parameterName: "MULTITAP_FREQ1", xmlLabel: "Freq 1", modifierAssignable: true },
    "multidelay.freq_2": { groupCode: "MTD", block: "multidelay", paramId: 59, wikiName: "FREQ 2", name: "freq_2", controlType: "knob", parameterName: "MULTITAP_FREQ2", xmlLabel: "Freq 2", modifierAssignable: true },
    "multidelay.freq_3": { groupCode: "MTD", block: "multidelay", paramId: 60, wikiName: "FREQ 3", name: "freq_3", controlType: "knob", parameterName: "MULTITAP_FREQ3", xmlLabel: "Freq 3", modifierAssignable: true },
    "multidelay.freq_4": { groupCode: "MTD", block: "multidelay", paramId: 61, wikiName: "FREQ 4", name: "freq_4", controlType: "knob", parameterName: "MULTITAP_FREQ4", xmlLabel: "Freq 4", modifierAssignable: true },
    "multidelay.q_1": { groupCode: "MTD", block: "multidelay", paramId: 62, wikiName: "Q 1", name: "q_1", controlType: "knob", parameterName: "MULTITAP_Q1", xmlLabel: "Q 1" },
    "multidelay.q_2": { groupCode: "MTD", block: "multidelay", paramId: 63, wikiName: "Q 2", name: "q_2", controlType: "knob", parameterName: "MULTITAP_Q2", xmlLabel: "Q 2" },
    "multidelay.q_3": { groupCode: "MTD", block: "multidelay", paramId: 64, wikiName: "Q 3", name: "q_3", controlType: "knob", parameterName: "MULTITAP_Q3", xmlLabel: "Q 3" },
    "multidelay.q_4": { groupCode: "MTD", block: "multidelay", paramId: 65, wikiName: "Q 4", name: "q_4", controlType: "knob", parameterName: "MULTITAP_Q4", xmlLabel: "Q 4" },
    "multidelay.master_rate": { groupCode: "MTD", block: "multidelay", paramId: 66, wikiName: "MASTER RATE", name: "master_rate", controlType: "knob", parameterName: "MULTITAP_MSTRRATE", xmlLabel: "Master Rate", modifierAssignable: true },
    "multidelay.ducker_atten": { groupCode: "MTD", block: "multidelay", paramId: 67, wikiName: "DUCKER ATTEN", name: "ducker_atten", controlType: "knob", parameterName: "MULTITAP_ATTEN", xmlLabel: "Ducker Atten" },
    "multidelay.master_depth": { groupCode: "MTD", block: "multidelay", paramId: 68, wikiName: "MASTER DEPTH", name: "master_depth", controlType: "knob", parameterName: "MULTITAP_MSTRDEPTH", xmlLabel: "Master Depth", modifierAssignable: true },
    "multidelay.direction": { groupCode: "MTD", block: "multidelay", paramId: 69, wikiName: "DIRECTION", name: "direction", controlType: "select", parameterName: "MULTITAP_DIRECTION", xmlLabel: "Direction", enumValues: MULTIDELAY_DIRECTION_VALUES },
    "multidelay.tape_speed": { groupCode: "MTD", block: "multidelay", paramId: 70, wikiName: "TAPE SPEED", name: "tape_speed", controlType: "knob", parameterName: "MULTITAP_SPEED", xmlLabel: "Tape Speed" },
    "multidelay.lfo1_depth": { groupCode: "MTD", block: "multidelay", paramId: 71, wikiName: "LFO1 DEPTH", name: "lfo1_depth", controlType: "knob", parameterName: "MULTITAP_DEPTH1", xmlLabel: "LFO1 Depth" },
    "multidelay.lfo2_depth": { groupCode: "MTD", block: "multidelay", paramId: 72, wikiName: "LFO2 DEPTH", name: "lfo2_depth", controlType: "knob", parameterName: "MULTITAP_DEPTH2", xmlLabel: "LFO2 Depth" },
    "multidelay.lfo3_depth": { groupCode: "MTD", block: "multidelay", paramId: 73, wikiName: "LFO3 DEPTH", name: "lfo3_depth", controlType: "knob", parameterName: "MULTITAP_DEPTH3", xmlLabel: "LFO3 Depth" },
    "multidelay.lfo4_depth": { groupCode: "MTD", block: "multidelay", paramId: 74, wikiName: "LFO4 DEPTH", name: "lfo4_depth", controlType: "knob", parameterName: "MULTITAP_DEPTH4", xmlLabel: "LFO4 Depth" },
    "multidelay.lfo1_master": { groupCode: "MTD", block: "multidelay", paramId: 75, wikiName: "LFO1 MASTER", name: "lfo1_master", controlType: "switch", parameterName: "MULTITAP_LFOLOCK", xmlLabel: "LFO1 Master" },
    "multidelay.fb_send": { groupCode: "MTD", block: "multidelay", paramId: 76, wikiName: "FB SEND", name: "fb_send", controlType: "select", parameterName: "MULTITAP_FBKSEND", xmlLabel: "FB Send", enumValues: MULTIDELAY_FB_SEND_VALUES },
    "multidelay.fb_return": { groupCode: "MTD", block: "multidelay", paramId: 77, wikiName: "FB RETURN", name: "fb_return", controlType: "select", parameterName: "MULTITAP_FBKRET", xmlLabel: "FB Return", enumValues: MULTIDELAY_FB_RETURN_VALUES },
    "multidelay.mono_stereo": { groupCode: "MTD", block: "multidelay", paramId: 78, wikiName: "MONO/STEREO", name: "mono_stereo", controlType: "select", parameterName: "MULTITAP_STEREO", xmlLabel: "Mono/Stereo", enumValues: MULTIDELAY_MONO_STEREO_VALUES },
    "multidelay.delay_time": { groupCode: "MTD", block: "multidelay", paramId: 79, wikiName: "DELAY TIME", name: "delay_time", controlType: "knob", parameterName: "MULTITAP_TIMEM", xmlLabel: "Delay Time" },
    "multidelay.quantize": { groupCode: "MTD", block: "multidelay", paramId: 81, wikiName: "QUANTIZE", name: "quantize", controlType: "select", parameterName: "MULTITAP_QUANTIZE", xmlLabel: "Quantize" },
    "multidelay.decay": { groupCode: "MTD", block: "multidelay", paramId: 82, wikiName: "DECAY", name: "decay", controlType: "knob", parameterName: "MULTITAP_RDECAY", xmlLabel: "Decay" },
    "multidelay.number_of_taps": { groupCode: "MTD", block: "multidelay", paramId: 84, wikiName: "NUMBER OF TAPS", name: "number_of_taps", controlType: "unknown", parameterName: "MULTITAP_NUMTAPS", xmlLabel: "Number of Taps", displayMin: 1, displayMax: 10, step: 1 },
    "multidelay.shuffle": { groupCode: "MTD", block: "multidelay", paramId: 85, wikiName: "SHUFFLE", name: "shuffle", controlType: "knob", parameterName: "MULTITAP_SHUFFLE", xmlLabel: "Shuffle" },
    "multidelay.delay_tempo": { groupCode: "MTD", block: "multidelay", paramId: 86, wikiName: "DELAY Tempo", name: "delay_tempo", controlType: "select", parameterName: "MULTITAP_RTEMPO", xmlLabel: "Delay tempo" },
    "multidelay.spread": { groupCode: "MTD", block: "multidelay", paramId: 87, wikiName: "SPREAD", name: "spread", controlType: "knob", parameterName: "MULTITAP_SPREAD", xmlLabel: "Spread" },
    "multidelay.pan_shape": { groupCode: "MTD", block: "multidelay", paramId: 88, wikiName: "Pan SHAPE", name: "pan_shape", controlType: "select", parameterName: "MULTITAP_PANSHAPE", xmlLabel: "Pan Shape", enumValues: MULTIDELAY_PAN_SHAPE_VALUES },
    "multidelay.pan_alpha": { groupCode: "MTD", block: "multidelay", paramId: 89, wikiName: "Pan ALPHA", name: "pan_alpha", controlType: "knob", parameterName: "MULTITAP_PANALPHA", xmlLabel: "Pan alpha" },
    "multidelay.low_cut": { groupCode: "MTD", block: "multidelay", paramId: 90, wikiName: "LOW CUT", name: "low_cut", controlType: "knob", parameterName: "MULTITAP_LOWCUT", xmlLabel: "Low Cut" },
    "multidelay.high_cut": { groupCode: "MTD", block: "multidelay", paramId: 91, wikiName: "HIGH CUT", name: "high_cut", controlType: "knob", parameterName: "MULTITAP_HIGHCUT", xmlLabel: "High Cut" },
    "multidelay.ratio": { groupCode: "MTD", block: "multidelay", paramId: 92, wikiName: "RATIO", name: "ratio", controlType: "knob", parameterName: "MULTITAP_OFFSET", xmlLabel: "Ratio" },
    "multidelay.feedback": { groupCode: "MTD", block: "multidelay", paramId: 93, wikiName: "FEEDBACK", name: "feedback", controlType: "knob", parameterName: "MULTITAP_FEEDBACK", xmlLabel: "Feedback" },
    "multidelay.tap_1_time": { groupCode: "MTD", block: "multidelay", paramId: 94, wikiName: "TAP 1 TIME", name: "tap_1_time", controlType: "knob" },
    "multidelay.tap_2_time": { groupCode: "MTD", block: "multidelay", paramId: 95, wikiName: "TAP 2 TIME", name: "tap_2_time", controlType: "knob" },
    "multidelay.tap_3_time": { groupCode: "MTD", block: "multidelay", paramId: 96, wikiName: "TAP 3 TIME", name: "tap_3_time", controlType: "knob" },
    "multidelay.tap_4_time": { groupCode: "MTD", block: "multidelay", paramId: 97, wikiName: "TAP 4 TIME", name: "tap_4_time", controlType: "knob" },
    "multidelay.tap_5_time": { groupCode: "MTD", block: "multidelay", paramId: 98, wikiName: "TAP 5 TIME", name: "tap_5_time", controlType: "knob" },
    "multidelay.tap_6_time": { groupCode: "MTD", block: "multidelay", paramId: 99, wikiName: "TAP 6 TIME", name: "tap_6_time", controlType: "knob" },
    "multidelay.tap_7_time": { groupCode: "MTD", block: "multidelay", paramId: 100, wikiName: "TAP 7 TIME", name: "tap_7_time", controlType: "knob" },
    "multidelay.tap_8_time": { groupCode: "MTD", block: "multidelay", paramId: 101, wikiName: "TAP 8 TIME", name: "tap_8_time", controlType: "knob" },
    "multidelay.tap_9_time": { groupCode: "MTD", block: "multidelay", paramId: 102, wikiName: "TAP 9 TIME", name: "tap_9_time", controlType: "knob" },
    "multidelay.tap_10_time": { groupCode: "MTD", block: "multidelay", paramId: 103, wikiName: "TAP 10 TIME", name: "tap_10_time", controlType: "knob" },
    "multidelay.tap_1_level": { groupCode: "MTD", block: "multidelay", paramId: 104, wikiName: "TAP 1 Level", name: "tap_1_level", controlType: "knob" },
    "multidelay.tap_2_level": { groupCode: "MTD", block: "multidelay", paramId: 105, wikiName: "TAP 2 Level", name: "tap_2_level", controlType: "knob" },
    "multidelay.tap_3_level": { groupCode: "MTD", block: "multidelay", paramId: 106, wikiName: "TAP 3 Level", name: "tap_3_level", controlType: "knob" },
    "multidelay.tap_4_level": { groupCode: "MTD", block: "multidelay", paramId: 107, wikiName: "TAP 4 Level", name: "tap_4_level", controlType: "knob" },
    "multidelay.tap_5_level": { groupCode: "MTD", block: "multidelay", paramId: 108, wikiName: "TAP 5 Level", name: "tap_5_level", controlType: "knob" },
    "multidelay.tap_6_level": { groupCode: "MTD", block: "multidelay", paramId: 109, wikiName: "TAP 6 Level", name: "tap_6_level", controlType: "knob" },
    "multidelay.tap_7_level": { groupCode: "MTD", block: "multidelay", paramId: 110, wikiName: "TAP 7 Level", name: "tap_7_level", controlType: "knob" },
    "multidelay.tap_8_level": { groupCode: "MTD", block: "multidelay", paramId: 111, wikiName: "TAP 8 Level", name: "tap_8_level", controlType: "knob" },
    "multidelay.tap_9_level": { groupCode: "MTD", block: "multidelay", paramId: 112, wikiName: "TAP 9 Level", name: "tap_9_level", controlType: "knob" },
    "multidelay.tap_10_level": { groupCode: "MTD", block: "multidelay", paramId: 113, wikiName: "TAP 10 Level", name: "tap_10_level", controlType: "knob" },
    "multidelay.ducker_release": { groupCode: "MTD", block: "multidelay", paramId: 116, wikiName: "DUCKER RELEASE", name: "ducker_release", controlType: "knob", parameterName: "MULTITAP_RELEASE", xmlLabel: "Ducker Release" },
    "multidelay.drive": { groupCode: "MTD", block: "multidelay", paramId: 117, wikiName: "DRIVE", name: "drive", controlType: "knob", parameterName: "MULTITAP_DRIVE", xmlLabel: "Drive" },
    "output.level_1": { groupCode: "OUTPUT", block: "output", paramId: 0, wikiName: "Level 1", name: "level_1", controlType: "knob", parameterName: "OUTPUT_LEVEL1", xmlLabel: "Level 1" },
    "output.level_2": { groupCode: "OUTPUT", block: "output", paramId: 1, wikiName: "Level 2", name: "level_2", controlType: "knob", parameterName: "OUTPUT_LEVEL2", xmlLabel: "Level 2" },
    "output.level_3": { groupCode: "OUTPUT", block: "output", paramId: 2, wikiName: "Level 3", name: "level_3", controlType: "knob", parameterName: "OUTPUT_LEVEL3", xmlLabel: "Level 3" },
    "output.level_4": { groupCode: "OUTPUT", block: "output", paramId: 3, wikiName: "Level 4", name: "level_4", controlType: "knob", parameterName: "OUTPUT_LEVEL4", xmlLabel: "Level 4" },
    "output.balance_1": { groupCode: "OUTPUT", block: "output", paramId: 4, wikiName: "Balance 1", name: "balance_1", controlType: "knob", parameterName: "OUTPUT_PAN1", xmlLabel: "Balance 1" },
    "output.balance_2": { groupCode: "OUTPUT", block: "output", paramId: 5, wikiName: "Balance 2", name: "balance_2", controlType: "knob", parameterName: "OUTPUT_PAN2", xmlLabel: "Balance 2" },
    "output.balance_3": { groupCode: "OUTPUT", block: "output", paramId: 6, wikiName: "Balance 3", name: "balance_3", controlType: "knob", parameterName: "OUTPUT_PAN3", xmlLabel: "Balance 3" },
    "output.balance_4": { groupCode: "OUTPUT", block: "output", paramId: 7, wikiName: "Balance 4", name: "balance_4", controlType: "knob", parameterName: "OUTPUT_PAN4", xmlLabel: "Balance 4" },
    "output.scene_1_main": { groupCode: "OUTPUT", block: "output", paramId: 8, wikiName: "SCENE 1 MAIN", name: "scene_1_main", controlType: "unknown" },
    "output.scene_2_main": { groupCode: "OUTPUT", block: "output", paramId: 9, wikiName: "SCENE 2 MAIN", name: "scene_2_main", controlType: "unknown" },
    "output.scene_3_main": { groupCode: "OUTPUT", block: "output", paramId: 10, wikiName: "SCENE 3 MAIN", name: "scene_3_main", controlType: "unknown" },
    "output.scene_4_main": { groupCode: "OUTPUT", block: "output", paramId: 11, wikiName: "SCENE 4 MAIN", name: "scene_4_main", controlType: "unknown" },
    "output.scene_5_main": { groupCode: "OUTPUT", block: "output", paramId: 12, wikiName: "SCENE 5 MAIN", name: "scene_5_main", controlType: "unknown" },
    "output.scene_6_main": { groupCode: "OUTPUT", block: "output", paramId: 13, wikiName: "SCENE 6 MAIN", name: "scene_6_main", controlType: "unknown" },
    "output.scene_7_main": { groupCode: "OUTPUT", block: "output", paramId: 14, wikiName: "SCENE 7 MAIN", name: "scene_7_main", controlType: "unknown" },
    "output.scene_8_main": { groupCode: "OUTPUT", block: "output", paramId: 15, wikiName: "SCENE 8 MAIN", name: "scene_8_main", controlType: "unknown" },
    "output.level": { groupCode: "OUTPUT", block: "output", paramId: 16, wikiName: "Level", name: "level", controlType: "knob" },
    "output.pan": { groupCode: "OUTPUT", block: "output", paramId: 17, wikiName: "Pan", name: "pan", controlType: "knob" },
    "output.bypass_mode": { groupCode: "OUTPUT", block: "output", paramId: 18, wikiName: "BYPASS MODE", name: "bypass_mode", controlType: "select", enumValues: OUTPUT_BYPASS_MODE_VALUES },
    "pantrem.effect_type": { groupCode: "TRM", block: "pantrem", paramId: 0, wikiName: "EFFECT TYPE", name: "effect_type", controlType: "select", enumValues: PANTREM_EFFECT_TYPE_VALUES },
    "pantrem.lfo_type": { groupCode: "TRM", block: "pantrem", paramId: 1, wikiName: "LFO TYPE", name: "lfo_type", controlType: "select", parameterName: "TREMOLO_LFOTYPE", xmlLabel: "LFO Type", enumValues: PANTREM_LFO_TYPE_VALUES },
    "pantrem.rate": { groupCode: "TRM", block: "pantrem", paramId: 2, wikiName: "RATE", name: "rate", controlType: "knob", parameterName: "TREMOLO_RATE", xmlLabel: "Rate", modifierAssignable: true },
    "pantrem.depth": { groupCode: "TRM", block: "pantrem", paramId: 3, wikiName: "DEPTH", name: "depth", controlType: "knob", parameterName: "TREMOLO_DEPTH", xmlLabel: "Depth", modifierAssignable: true },
    "pantrem.duty": { groupCode: "TRM", block: "pantrem", paramId: 4, wikiName: "DUTY", name: "duty", controlType: "knob", parameterName: "TREMOLO_DUTY", xmlLabel: "Duty", modifierAssignable: true },
    "pantrem.tempo": { groupCode: "TRM", block: "pantrem", paramId: 5, wikiName: "Tempo", name: "tempo", controlType: "select", parameterName: "TREMOLO_TEMPO", xmlLabel: "Tempo" },
    "pantrem.level": { groupCode: "TRM", block: "pantrem", paramId: 7, wikiName: "Level", name: "level", controlType: "knob", parameterName: "TREMOLO_LEVEL", xmlLabel: "Level", modifierAssignable: true },
    "pantrem.balance": { groupCode: "TRM", block: "pantrem", paramId: 8, wikiName: "Balance", name: "balance", controlType: "knob", parameterName: "TREMOLO_PAN", xmlLabel: "Balance", modifierAssignable: true },
    "pantrem.bypass_mode": { groupCode: "TRM", block: "pantrem", paramId: 9, wikiName: "BYPASS MODE", name: "bypass_mode", controlType: "select", parameterName: "TREMOLO_BYPASSMODE", xmlLabel: "Bypass Mode", enumValues: PANTREM_BYPASS_MODE_VALUES, modifierAssignable: true },
    "pantrem.lfo_phase": { groupCode: "TRM", block: "pantrem", paramId: 11, wikiName: "LFO PHASE", name: "lfo_phase", controlType: "knob", parameterName: "TREMOLO_PHASE", xmlLabel: "LFO Phase", modifierAssignable: true },
    "pantrem.width": { groupCode: "TRM", block: "pantrem", paramId: 12, wikiName: "WIDTH", name: "width", controlType: "knob", parameterName: "TREMOLO_WIDTH", xmlLabel: "Width", modifierAssignable: true },
    "pantrem.pan_center": { groupCode: "TRM", block: "pantrem", paramId: 13, wikiName: "Pan CENTER", name: "pan_center", controlType: "knob", parameterName: "TREMOLO_CENTER", xmlLabel: "Pan Center" },
    "pantrem.start_phase": { groupCode: "TRM", block: "pantrem", paramId: 15, wikiName: "START PHASE", name: "start_phase", controlType: "knob", parameterName: "TREMOLO_STARTPHASE", xmlLabel: "Start Phase" },
    "parametriceq.freq_1": { groupCode: "PEQ", block: "parametriceq", paramId: 0, wikiName: "FREQ 1", name: "freq_1", controlType: "knob", parameterName: "PEQ_FREQ1", xmlLabel: "Freq 1" },
    "parametriceq.freq_2": { groupCode: "PEQ", block: "parametriceq", paramId: 1, wikiName: "FREQ 2", name: "freq_2", controlType: "knob", parameterName: "PEQ_FREQ2", xmlLabel: "Freq 2" },
    "parametriceq.freq_3": { groupCode: "PEQ", block: "parametriceq", paramId: 2, wikiName: "FREQ 3", name: "freq_3", controlType: "knob", parameterName: "PEQ_FREQ3", xmlLabel: "Freq 3" },
    "parametriceq.freq_4": { groupCode: "PEQ", block: "parametriceq", paramId: 3, wikiName: "FREQ 4", name: "freq_4", controlType: "knob", parameterName: "PEQ_FREQ4", xmlLabel: "Freq 4" },
    "parametriceq.freq_5": { groupCode: "PEQ", block: "parametriceq", paramId: 4, wikiName: "FREQ 5", name: "freq_5", controlType: "knob", parameterName: "PEQ_FREQ5", xmlLabel: "Freq 5" },
    "parametriceq.q_1": { groupCode: "PEQ", block: "parametriceq", paramId: 5, wikiName: "Q 1", name: "q_1", controlType: "knob" },
    "parametriceq.q_2": { groupCode: "PEQ", block: "parametriceq", paramId: 6, wikiName: "Q 2", name: "q_2", controlType: "knob" },
    "parametriceq.q_3": { groupCode: "PEQ", block: "parametriceq", paramId: 7, wikiName: "Q 3", name: "q_3", controlType: "knob" },
    "parametriceq.q_4": { groupCode: "PEQ", block: "parametriceq", paramId: 8, wikiName: "Q 4", name: "q_4", controlType: "knob" },
    "parametriceq.q_5": { groupCode: "PEQ", block: "parametriceq", paramId: 9, wikiName: "Q 5", name: "q_5", controlType: "knob" },
    "parametriceq.gain_1": { groupCode: "PEQ", block: "parametriceq", paramId: 10, wikiName: "GAIN 1", name: "gain_1", controlType: "knob", parameterName: "PEQ_GAIN1", xmlLabel: "Gain 1" },
    "parametriceq.gain_2": { groupCode: "PEQ", block: "parametriceq", paramId: 11, wikiName: "GAIN 2", name: "gain_2", controlType: "knob", parameterName: "PEQ_GAIN2", xmlLabel: "Gain 2" },
    "parametriceq.gain_3": { groupCode: "PEQ", block: "parametriceq", paramId: 12, wikiName: "GAIN 3", name: "gain_3", controlType: "knob", parameterName: "PEQ_GAIN3", xmlLabel: "Gain 3" },
    "parametriceq.gain_4": { groupCode: "PEQ", block: "parametriceq", paramId: 13, wikiName: "GAIN 4", name: "gain_4", controlType: "knob", parameterName: "PEQ_GAIN4", xmlLabel: "Gain 4" },
    "parametriceq.gain_5": { groupCode: "PEQ", block: "parametriceq", paramId: 14, wikiName: "GAIN 5", name: "gain_5", controlType: "knob", parameterName: "PEQ_GAIN5", xmlLabel: "Gain 5" },
    "parametriceq.freq_type_1": { groupCode: "PEQ", block: "parametriceq", paramId: 15, wikiName: "FREQ TYPE 1", name: "freq_type_1", controlType: "select", enumValues: PARAMETRICEQ_FREQ_TYPE_1_VALUES },
    "parametriceq.freq_type_5": { groupCode: "PEQ", block: "parametriceq", paramId: 16, wikiName: "FREQ TYPE 5", name: "freq_type_5", controlType: "select", enumValues: PARAMETRICEQ_FREQ_TYPE_5_VALUES },
    "parametriceq.freq_type_2": { groupCode: "PEQ", block: "parametriceq", paramId: 17, wikiName: "FREQ TYPE 2", name: "freq_type_2", controlType: "select", enumValues: PARAMETRICEQ_FREQ_TYPE_2_VALUES },
    "parametriceq.freq_type_4": { groupCode: "PEQ", block: "parametriceq", paramId: 18, wikiName: "FREQ TYPE 4", name: "freq_type_4", controlType: "select", enumValues: PARAMETRICEQ_FREQ_TYPE_4_VALUES },
    "parametriceq.level": { groupCode: "PEQ", block: "parametriceq", paramId: 19, wikiName: "Level", name: "level", controlType: "knob", parameterName: "PEQ_LEVEL", xmlLabel: "Level", modifierAssignable: true },
    "parametriceq.balance": { groupCode: "PEQ", block: "parametriceq", paramId: 20, wikiName: "Balance", name: "balance", controlType: "knob", parameterName: "PEQ_PAN", xmlLabel: "Balance", modifierAssignable: true },
    "parametriceq.bypass_mode": { groupCode: "PEQ", block: "parametriceq", paramId: 21, wikiName: "BYPASS MODE", name: "bypass_mode", controlType: "select", parameterName: "PEQ_BYPASSMODE", xmlLabel: "Bypass Mode", enumValues: PARAMETRICEQ_BYPASS_MODE_VALUES, modifierAssignable: true },
    "phaser.effect_type": { groupCode: "PHA", block: "phaser", paramId: 0, wikiName: "EFFECT TYPE", name: "effect_type", controlType: "select", enumValues: PHASER_EFFECT_TYPE_VALUES },
    "phaser.order": { groupCode: "PHA", block: "phaser", paramId: 1, wikiName: "ORDER", name: "order", controlType: "select", parameterName: "PHASER_ORDER", xmlLabel: "Order", enumValues: PHASER_ORDER_VALUES },
    "phaser.rate": { groupCode: "PHA", block: "phaser", paramId: 2, wikiName: "RATE", name: "rate", controlType: "knob", parameterName: "PHASER_RATE", xmlLabel: "Rate", modifierAssignable: true },
    "phaser.lfo_type": { groupCode: "PHA", block: "phaser", paramId: 3, wikiName: "LFO TYPE", name: "lfo_type", controlType: "select", parameterName: "PHASER_LFOTYPE", xmlLabel: "LFO Type", enumValues: PHASER_LFO_TYPE_VALUES },
    "phaser.tempo": { groupCode: "PHA", block: "phaser", paramId: 4, wikiName: "Tempo", name: "tempo", controlType: "select", parameterName: "PHASER_TEMPO", xmlLabel: "Tempo" },
    "phaser.depth": { groupCode: "PHA", block: "phaser", paramId: 5, wikiName: "DEPTH", name: "depth", controlType: "knob", parameterName: "PHASER_DEPTH", xmlLabel: "Depth", modifierAssignable: true },
    "phaser.feedback": { groupCode: "PHA", block: "phaser", paramId: 6, wikiName: "FEEDBACK", name: "feedback", controlType: "knob", parameterName: "PHASER_FEEDBACK", xmlLabel: "Feedback", modifierAssignable: true },
    "phaser.freq_start": { groupCode: "PHA", block: "phaser", paramId: 7, wikiName: "FREQ. START", name: "freq_start", controlType: "knob" },
    "phaser.freq_span": { groupCode: "PHA", block: "phaser", paramId: 8, wikiName: "FREQ. SPan", name: "freq_span", controlType: "knob" },
    "phaser.lfo_phase": { groupCode: "PHA", block: "phaser", paramId: 9, wikiName: "LFO PHASE", name: "lfo_phase", controlType: "knob", parameterName: "PHASER_LFOPHASE", xmlLabel: "LFO Phase" },
    "phaser.bulb_bias": { groupCode: "PHA", block: "phaser", paramId: 10, wikiName: "BULB BIAS", name: "bulb_bias", controlType: "knob", parameterName: "PHASER_BIAS", xmlLabel: "Bulb Bias", gateOn: "PHASER_MODE", gateValues: "0,1" },
    "phaser.mix": { groupCode: "PHA", block: "phaser", paramId: 11, wikiName: "MIX", name: "mix", controlType: "knob", parameterName: "PHASER_MIX", xmlLabel: "Mix", modifierAssignable: true },
    "phaser.level": { groupCode: "PHA", block: "phaser", paramId: 12, wikiName: "Level", name: "level", controlType: "knob", parameterName: "PHASER_LEVEL", xmlLabel: "Level", modifierAssignable: true },
    "phaser.balance": { groupCode: "PHA", block: "phaser", paramId: 13, wikiName: "Balance", name: "balance", controlType: "knob", parameterName: "PHASER_PAN", xmlLabel: "Balance", modifierAssignable: true },
    "phaser.bypass_mode": { groupCode: "PHA", block: "phaser", paramId: 14, wikiName: "BYPASS MODE", name: "bypass_mode", controlType: "select", parameterName: "PHASER_BYPASSMODE", xmlLabel: "Bypass Mode", enumValues: PHASER_BYPASS_MODE_VALUES, modifierAssignable: true },
    "phaser.global": { groupCode: "PHA", block: "phaser", paramId: 15, wikiName: "GLOBAL", name: "global", controlType: "switch" },
    "phaser.mode": { groupCode: "PHA", block: "phaser", paramId: 17, wikiName: "MODE", name: "mode", controlType: "select", enumValues: PHASER_MODE_VALUES },
    "phaser.feedback_tap": { groupCode: "PHA", block: "phaser", paramId: 18, wikiName: "FEEDBACK TAP", name: "feedback_tap", controlType: "switch", parameterName: "PHASER_FBTAP", xmlLabel: "Feedback Tap" },
    "phaser.tone": { groupCode: "PHA", block: "phaser", paramId: 19, wikiName: "TONE", name: "tone", controlType: "knob", parameterName: "PHASER_TONE", xmlLabel: "Tone" },
    "phaser.direction": { groupCode: "PHA", block: "phaser", paramId: 20, wikiName: "DIRECTION", name: "direction", controlType: "select", parameterName: "PHASER_DIRECTION", xmlLabel: "Direction", enumValues: PHASER_DIRECTION_VALUES },
    "phaser.filter_q": { groupCode: "PHA", block: "phaser", paramId: 21, wikiName: "FILTER Q", name: "filter_q", controlType: "knob", parameterName: "PHASER_Q", xmlLabel: "Filter Q" },
    "phaser.lfo_bypass_reset": { groupCode: "PHA", block: "phaser", paramId: 22, wikiName: "LFO BYPASS RESET", name: "lfo_bypass_reset", controlType: "select", parameterName: "PHASER_LFORESET", xmlLabel: "LFO Bypass Reset", enumValues: PHASER_LFO_BYPASS_RESET_VALUES },
    "pitch.effect_type": { groupCode: "PIT", block: "pitch", paramId: 0, wikiName: "EFFECT TYPE", name: "effect_type", controlType: "select", enumValues: PITCH_EFFECT_TYPE_VALUES },
    "pitch.mode": { groupCode: "PIT", block: "pitch", paramId: 1, wikiName: "MODE", name: "mode", controlType: "select", parameterName: "PITCH_PITCHMODE", xmlLabel: "Mode", enumValues: PITCH_MODE_VALUES },
    "pitch.master_pitch": { groupCode: "PIT", block: "pitch", paramId: 2, wikiName: "MASTER PITCH", name: "master_pitch", controlType: "knob", parameterName: "PITCH_CTRL", xmlLabel: "Master Pitch", modifierAssignable: true },
    "pitch.control": { groupCode: "PIT", block: "pitch", paramId: 3, wikiName: "CONTROL", name: "control", controlType: "knob", parameterName: "PITCH_UCTRL", xmlLabel: "Control", modifierAssignable: true },
    "pitch.voice_1_harmony": { groupCode: "PIT", block: "pitch", paramId: 4, wikiName: "VOICE 1 HARMONY", name: "voice_1_harmony", controlType: "unknown", displayMin: 0, displayMax: 48, step: 1 },
    "pitch.voice_2_harmony": { groupCode: "PIT", block: "pitch", paramId: 5, wikiName: "VOICE 2 HARMONY", name: "voice_2_harmony", controlType: "unknown", displayMin: 0, displayMax: 48, step: 1 },
    "pitch.key": { groupCode: "PIT", block: "pitch", paramId: 6, wikiName: "KEY", name: "key", controlType: "select", parameterName: "PITCH_KEY", xmlLabel: "Key", enumValues: PITCH_KEY_VALUES },
    "pitch.scale": { groupCode: "PIT", block: "pitch", paramId: 7, wikiName: "SCALE", name: "scale", controlType: "select", parameterName: "PITCH_SCALE", xmlLabel: "Scale", enumValues: PITCH_SCALE_VALUES },
    "pitch.track_mode": { groupCode: "PIT", block: "pitch", paramId: 8, wikiName: "TRACK MODE", name: "track_mode", controlType: "select", parameterName: "PITCH_MODE", xmlLabel: "Track Mode", enumValues: PITCH_TRACK_MODE_VALUES },
    "pitch.voice_1_detune": { groupCode: "PIT", block: "pitch", paramId: 9, wikiName: "VOICE 1 DETUNE", name: "voice_1_detune", controlType: "knob", modifierAssignable: true },
    "pitch.voice_2_detune": { groupCode: "PIT", block: "pitch", paramId: 10, wikiName: "VOICE 2 DETUNE", name: "voice_2_detune", controlType: "knob", modifierAssignable: true },
    "pitch.voice_1_shift": { groupCode: "PIT", block: "pitch", paramId: 11, wikiName: "VOICE 1 SHIFT", name: "voice_1_shift", controlType: "unknown", displayMin: 0, displayMax: 48, step: 1, modifierAssignable: true },
    "pitch.voice_2_shift": { groupCode: "PIT", block: "pitch", paramId: 12, wikiName: "VOICE 2 SHIFT", name: "voice_2_shift", controlType: "unknown", displayMin: 0, displayMax: 48, step: 1, modifierAssignable: true },
    "pitch.voice_1_level": { groupCode: "PIT", block: "pitch", paramId: 13, wikiName: "VOICE 1 Level", name: "voice_1_level", controlType: "knob", modifierAssignable: true },
    "pitch.voice_2_level": { groupCode: "PIT", block: "pitch", paramId: 14, wikiName: "VOICE 2 Level", name: "voice_2_level", controlType: "knob", modifierAssignable: true },
    "pitch.voice_1_pan": { groupCode: "PIT", block: "pitch", paramId: 15, wikiName: "VOICE 1 Pan", name: "voice_1_pan", controlType: "knob", modifierAssignable: true },
    "pitch.voice_2_pan": { groupCode: "PIT", block: "pitch", paramId: 16, wikiName: "VOICE 2 Pan", name: "voice_2_pan", controlType: "knob", modifierAssignable: true },
    "pitch.voice_1_delay": { groupCode: "PIT", block: "pitch", paramId: 17, wikiName: "VOICE 1 DELAY", name: "voice_1_delay", controlType: "knob" },
    "pitch.voice_2_delay": { groupCode: "PIT", block: "pitch", paramId: 18, wikiName: "VOICE 2 DELAY", name: "voice_2_delay", controlType: "knob" },
    "pitch.voice_1_feedback": { groupCode: "PIT", block: "pitch", paramId: 19, wikiName: "VOICE 1 FEEDBACK", name: "voice_1_feedback", controlType: "knob" },
    "pitch.voice_2_feedback": { groupCode: "PIT", block: "pitch", paramId: 20, wikiName: "VOICE 2 FEEDBACK", name: "voice_2_feedback", controlType: "knob" },
    "pitch.pitch_track": { groupCode: "PIT", block: "pitch", paramId: 21, wikiName: "PITCH TRACK", name: "pitch_track", controlType: "select", parameterName: "PITCH_TRACKMODE", xmlLabel: "Pitch Track", enumValues: PITCH_PITCH_TRACK_VALUES },
    "pitch.track_adjust": { groupCode: "PIT", block: "pitch", paramId: 22, wikiName: "TRACK ADJUST", name: "track_adjust", controlType: "knob", parameterName: "PITCH_TRACKING", xmlLabel: "Track Adjust" },
    "pitch.mix": { groupCode: "PIT", block: "pitch", paramId: 23, wikiName: "MIX", name: "mix", controlType: "knob", parameterName: "PITCH_MIX", xmlLabel: "Mix", modifierAssignable: true },
    "pitch.level": { groupCode: "PIT", block: "pitch", paramId: 24, wikiName: "Level", name: "level", controlType: "knob", parameterName: "PITCH_LEVEL", xmlLabel: "Level", modifierAssignable: true },
    "pitch.balance": { groupCode: "PIT", block: "pitch", paramId: 25, wikiName: "Balance", name: "balance", controlType: "knob", parameterName: "PITCH_PAN", xmlLabel: "Balance", modifierAssignable: true },
    "pitch.bypass_mode": { groupCode: "PIT", block: "pitch", paramId: 26, wikiName: "BYPASS MODE", name: "bypass_mode", controlType: "select", parameterName: "PITCH_BYPASSMODE", xmlLabel: "Bypass Mode", enumValues: PITCH_BYPASS_MODE_VALUES, modifierAssignable: true },
    "pitch.global": { groupCode: "PIT", block: "pitch", paramId: 27, wikiName: "GLOBAL", name: "global", controlType: "switch" },
    "pitch.input_gain": { groupCode: "PIT", block: "pitch", paramId: 28, wikiName: "INPUT GAIN", name: "input_gain", controlType: "knob", parameterName: "PITCH_GAIN", xmlLabel: "Input Gain", modifierAssignable: true },
    "pitch.crossfade": { groupCode: "PIT", block: "pitch", paramId: 30, wikiName: "CROSSFADE", name: "crossfade", controlType: "knob", parameterName: "PITCH_XFADE", xmlLabel: "Crossfade" },
    "pitch.voice_1_splice": { groupCode: "PIT", block: "pitch", paramId: 31, wikiName: "VOICE 1 SPLICE", name: "voice_1_splice", controlType: "knob" },
    "pitch.voice_2_splice": { groupCode: "PIT", block: "pitch", paramId: 32, wikiName: "VOICE 2 SPLICE", name: "voice_2_splice", controlType: "knob" },
    "pitch.voice_1_tempo": { groupCode: "PIT", block: "pitch", paramId: 33, wikiName: "VOICE 1 Tempo", name: "voice_1_tempo", controlType: "select" },
    "pitch.voice_2_tempo": { groupCode: "PIT", block: "pitch", paramId: 34, wikiName: "VOICE 2 Tempo", name: "voice_2_tempo", controlType: "select" },
    "pitch.splc1_tempo": { groupCode: "PIT", block: "pitch", paramId: 35, wikiName: "SPLC1 Tempo", name: "splc1_tempo", controlType: "select" },
    "pitch.splc2_tempo": { groupCode: "PIT", block: "pitch", paramId: 36, wikiName: "SPLC2 Tempo", name: "splc2_tempo", controlType: "select" },
    "pitch.feedback_type": { groupCode: "PIT", block: "pitch", paramId: 37, wikiName: "FEEDBACK TYPE", name: "feedback_type", controlType: "select", parameterName: "PITCH_FBTYPE", xmlLabel: "Feedback type", enumValues: PITCH_FEEDBACK_TYPE_VALUES },
    "pitch.reverse": { groupCode: "PIT", block: "pitch", paramId: 38, wikiName: "REVERSE", name: "reverse", controlType: "switch", parameterName: "PITCH_DIRECTION", xmlLabel: "Reverse" },
    "pitch.hi_cut": { groupCode: "PIT", block: "pitch", paramId: 39, wikiName: "HI CUT", name: "hi_cut", controlType: "knob", parameterName: "PITCH_LPFREQ", xmlLabel: "Hi Cut" },
    "pitch.glide_time": { groupCode: "PIT", block: "pitch", paramId: 40, wikiName: "GLIDE TIME", name: "glide_time", controlType: "knob", parameterName: "PITCH_GLIDE", xmlLabel: "Glide Time" },
    "pitch.master_delay": { groupCode: "PIT", block: "pitch", paramId: 41, wikiName: "MASTER DELAY", name: "master_delay", controlType: "knob", parameterName: "PITCH_MDELAY", xmlLabel: "Master Delay", modifierAssignable: true },
    "pitch.master_feedback": { groupCode: "PIT", block: "pitch", paramId: 42, wikiName: "MASTER FEEDBACK", name: "master_feedback", controlType: "knob", modifierAssignable: true },
    "pitch.master_pan": { groupCode: "PIT", block: "pitch", paramId: 43, wikiName: "MASTER Pan", name: "master_pan", controlType: "knob", parameterName: "PITCH_MPAN", xmlLabel: "Master Pan", modifierAssignable: true },
    "pitch.master_level": { groupCode: "PIT", block: "pitch", paramId: 44, wikiName: "MASTER Level", name: "master_level", controlType: "knob", parameterName: "PITCH_MLEVEL", xmlLabel: "Master Level", modifierAssignable: true },
    "pitch.notes": { groupCode: "PIT", block: "pitch", paramId: 45, wikiName: "Notes", name: "notes", controlType: "select", enumValues: PITCH_NOTES_VALUES, displayMin: 4 },
    "pitch.voice_1_scale": { groupCode: "PIT", block: "pitch", paramId: 53, wikiName: "VOICE 1 SCALE", name: "voice_1_scale", controlType: "unknown", parameterName: "PITCH_CUSTOMSCALE1", xmlLabel: "Voice 1 Scale", displayMin: 0, displayMax: 31, step: 1, modifierAssignable: true },
    "pitch.voice_2_scale": { groupCode: "PIT", block: "pitch", paramId: 54, wikiName: "VOICE 2 SCALE", name: "voice_2_scale", controlType: "unknown", parameterName: "PITCH_CUSTOMSCALE2", xmlLabel: "Voice 2 Scale", displayMin: 0, displayMax: 31, step: 1, modifierAssignable: true },
    "pitch.stages": { groupCode: "PIT", block: "pitch", paramId: 55, wikiName: "STAGES", name: "stages", controlType: "unknown", parameterName: "PITCH_NUMSTEPS", xmlLabel: "Stages", displayMin: 2, displayMax: 16, step: 1 },
    "pitch.repeats": { groupCode: "PIT", block: "pitch", paramId: 56, wikiName: "REPEATS", name: "repeats", controlType: "select", parameterName: "PITCH_NUMREPEATS", xmlLabel: "Repeats", enumValues: PITCH_REPEATS_VALUES, displayMin: 1 },
    "pitch.run": { groupCode: "PIT", block: "pitch", paramId: 57, wikiName: "RUN", name: "run", controlType: "switch", parameterName: "PITCH_ARPRUN", xmlLabel: "Run", modifierAssignable: true },
    "pitch.tempo": { groupCode: "PIT", block: "pitch", paramId: 58, wikiName: "Tempo", name: "tempo", controlType: "select", parameterName: "PITCH_TEMPO", xmlLabel: "Tempo", displayMin: 1 },
    "pitch.stage_1_shift": { groupCode: "PIT", block: "pitch", paramId: 59, wikiName: "STAGE 1 SHIFT", name: "stage_1_shift", controlType: "unknown", parameterName: "PITCH_STEP1", xmlLabel: "Stage 1 Shift", displayMin: 0, displayMax: 48, step: 1 },
    "pitch.stage_2_shift": { groupCode: "PIT", block: "pitch", paramId: 60, wikiName: "STAGE 2 SHIFT", name: "stage_2_shift", controlType: "unknown", parameterName: "PITCH_STEP2", xmlLabel: "Stage 2 Shift", displayMin: 0, displayMax: 48, step: 1 },
    "pitch.stage_3_shift": { groupCode: "PIT", block: "pitch", paramId: 61, wikiName: "STAGE 3 SHIFT", name: "stage_3_shift", controlType: "unknown", parameterName: "PITCH_STEP3", xmlLabel: "Stage 3 Shift", displayMin: 0, displayMax: 48, step: 1 },
    "pitch.stage_4_shift": { groupCode: "PIT", block: "pitch", paramId: 62, wikiName: "STAGE 4 SHIFT", name: "stage_4_shift", controlType: "unknown", parameterName: "PITCH_STEP4", xmlLabel: "Stage 4 Shift", displayMin: 0, displayMax: 48, step: 1 },
    "pitch.stage_5_shift": { groupCode: "PIT", block: "pitch", paramId: 63, wikiName: "STAGE 5 SHIFT", name: "stage_5_shift", controlType: "unknown", parameterName: "PITCH_STEP5", xmlLabel: "Stage 5 Shift", displayMin: 0, displayMax: 48, step: 1 },
    "pitch.stage_6_shift": { groupCode: "PIT", block: "pitch", paramId: 64, wikiName: "STAGE 6 SHIFT", name: "stage_6_shift", controlType: "unknown", parameterName: "PITCH_STEP6", xmlLabel: "Stage 6 Shift", displayMin: 0, displayMax: 48, step: 1 },
    "pitch.stage_7_shift": { groupCode: "PIT", block: "pitch", paramId: 65, wikiName: "STAGE 7 SHIFT", name: "stage_7_shift", controlType: "unknown", parameterName: "PITCH_STEP7", xmlLabel: "Stage 7 Shift", displayMin: 0, displayMax: 48, step: 1 },
    "pitch.stage_8_shift": { groupCode: "PIT", block: "pitch", paramId: 66, wikiName: "STAGE 8 SHIFT", name: "stage_8_shift", controlType: "unknown", parameterName: "PITCH_STEP8", xmlLabel: "Stage 8 Shift", displayMin: 0, displayMax: 48, step: 1 },
    "pitch.stage_9_shift": { groupCode: "PIT", block: "pitch", paramId: 67, wikiName: "STAGE 9 SHIFT", name: "stage_9_shift", controlType: "unknown", parameterName: "PITCH_STEP9", xmlLabel: "Stage 9 Shift", displayMin: 0, displayMax: 48, step: 1 },
    "pitch.stage_10_shift": { groupCode: "PIT", block: "pitch", paramId: 68, wikiName: "STAGE 10 SHIFT", name: "stage_10_shift", controlType: "unknown", parameterName: "PITCH_STEP10", xmlLabel: "Stage 10 Shift", displayMin: 0, displayMax: 48, step: 1 },
    "pitch.stage_11_shift": { groupCode: "PIT", block: "pitch", paramId: 69, wikiName: "STAGE 11 SHIFT", name: "stage_11_shift", controlType: "unknown", parameterName: "PITCH_STEP11", xmlLabel: "Stage 11 Shift", displayMin: 0, displayMax: 48, step: 1 },
    "pitch.stage_12_shift": { groupCode: "PIT", block: "pitch", paramId: 70, wikiName: "STAGE 12 SHIFT", name: "stage_12_shift", controlType: "unknown", parameterName: "PITCH_STEP12", xmlLabel: "Stage 12 Shift", displayMin: 0, displayMax: 48, step: 1 },
    "pitch.stage_13_shift": { groupCode: "PIT", block: "pitch", paramId: 71, wikiName: "STAGE 13 SHIFT", name: "stage_13_shift", controlType: "unknown", parameterName: "PITCH_STEP13", xmlLabel: "Stage 13 Shift", displayMin: 0, displayMax: 48, step: 1 },
    "pitch.stage_14_shift": { groupCode: "PIT", block: "pitch", paramId: 72, wikiName: "STAGE 14 SHIFT", name: "stage_14_shift", controlType: "unknown", parameterName: "PITCH_STEP14", xmlLabel: "Stage 14 Shift", displayMin: 0, displayMax: 48, step: 1 },
    "pitch.stage_15_shift": { groupCode: "PIT", block: "pitch", paramId: 73, wikiName: "STAGE 15 SHIFT", name: "stage_15_shift", controlType: "unknown", parameterName: "PITCH_STEP15", xmlLabel: "Stage 15 Shift", displayMin: 0, displayMax: 48, step: 1 },
    "pitch.stage_16_shift": { groupCode: "PIT", block: "pitch", paramId: 74, wikiName: "STAGE 16 SHIFT", name: "stage_16_shift", controlType: "unknown", parameterName: "PITCH_STEP16", xmlLabel: "Stage 16 Shift", displayMin: 0, displayMax: 48, step: 1 },
    "pitch.amplitube_shape": { groupCode: "PIT", block: "pitch", paramId: 75, wikiName: "AMPLITUBE SHAPE", name: "amplitube_shape", controlType: "select", enumValues: PITCH_AMPLITUBE_SHAPE_VALUES },
    "pitch.amplitube_alpha": { groupCode: "PIT", block: "pitch", paramId: 76, wikiName: "AMPLITUBE ALPHA", name: "amplitube_alpha", controlType: "knob" },
    "pitch.pan_shape": { groupCode: "PIT", block: "pitch", paramId: 77, wikiName: "Pan SHAPE", name: "pan_shape", controlType: "select", parameterName: "PITCH_PANSHAPE", xmlLabel: "Pan Shape", enumValues: PITCH_PAN_SHAPE_VALUES },
    "pitch.pan_alpha": { groupCode: "PIT", block: "pitch", paramId: 78, wikiName: "Pan ALPHA", name: "pan_alpha", controlType: "knob", parameterName: "PITCH_PANALPHA", xmlLabel: "Pan Alpha" },
    "pitch.pitch_source": { groupCode: "PIT", block: "pitch", paramId: 81, wikiName: "PITCH SOURCE", name: "pitch_source", controlType: "select", parameterName: "PITCH_SOURCE", xmlLabel: "Pitch Source", enumValues: PITCH_PITCH_SOURCE_VALUES },
    "pitch.input_mode": { groupCode: "PIT", block: "pitch", paramId: 82, wikiName: "INPUT MODE", name: "input_mode", controlType: "select", parameterName: "PITCH_INMODE", xmlLabel: "Input Mode", enumValues: PITCH_INPUT_MODE_VALUES },
    "pitch.learn": { groupCode: "PIT", block: "pitch", paramId: 83, wikiName: "LEARN", name: "learn", controlType: "switch", parameterName: "PITCH_LEARN", xmlLabel: "Learn", modifierAssignable: true },
    "pitch.low_cut": { groupCode: "PIT", block: "pitch", paramId: 84, wikiName: "LOW CUT", name: "low_cut", controlType: "knob", parameterName: "PITCH_HPFREQ", xmlLabel: "Low Cut" },
    "pitch.economy": { groupCode: "PIT", block: "pitch", paramId: 85, wikiName: "ECONOMY", name: "economy", controlType: "switch" },
    "reverb.effect_type": { groupCode: "REV", block: "reverb", paramId: 0, wikiName: "EFFECT TYPE", name: "effect_type", controlType: "select", enumValues: REVERB_EFFECT_TYPE_VALUES },
    "reverb.time": { groupCode: "REV", block: "reverb", paramId: 1, wikiName: "TIME", name: "time", controlType: "knob", parameterName: "REVERB_TIME", xmlLabel: "Time", modifierAssignable: true },
    "reverb.high_cut": { groupCode: "REV", block: "reverb", paramId: 2, wikiName: "HIGH CUT", name: "high_cut", controlType: "knob", parameterName: "REVERB_HICUT", xmlLabel: "High Cut" },
    "reverb.hf_time": { groupCode: "REV", block: "reverb", paramId: 3, wikiName: "HF TIME", name: "hf_time", controlType: "knob", parameterName: "REVERB_HFRATIO", xmlLabel: "HF Time" },
    "reverb.wall_diffusion": { groupCode: "REV", block: "reverb", paramId: 4, wikiName: "WALL DIFFUSION", name: "wall_diffusion", controlType: "knob", parameterName: "REVERB_DIFFUSION", xmlLabel: "Wall Diffusion" },
    "reverb.size": { groupCode: "REV", block: "reverb", paramId: 5, wikiName: "SIZE", name: "size", controlType: "knob", parameterName: "REVERB_SIZE", xmlLabel: "Size" },
    "reverb.early_level": { groupCode: "REV", block: "reverb", paramId: 7, wikiName: "EARLY Level", name: "early_level", controlType: "knob", parameterName: "REVERB_EARLYLEVEL", xmlLabel: "Early Level" },
    "reverb.late_level": { groupCode: "REV", block: "reverb", paramId: 8, wikiName: "LATE Level", name: "late_level", controlType: "knob", parameterName: "REVERB_REVERBLEVEL", xmlLabel: "Late Level" },
    "reverb.predelay": { groupCode: "REV", block: "reverb", paramId: 9, wikiName: "PREDELAY", name: "predelay", controlType: "knob", parameterName: "REVERB_PREDELAY", xmlLabel: "PreDelay", modifierAssignable: true },
    "reverb.low_cut": { groupCode: "REV", block: "reverb", paramId: 10, wikiName: "LOW CUT", name: "low_cut", controlType: "knob", parameterName: "REVERB_LOWCUT", xmlLabel: "Low Cut" },
    "reverb.mod_depth": { groupCode: "REV", block: "reverb", paramId: 11, wikiName: "MOD DEPTH", name: "mod_depth", controlType: "knob", parameterName: "REVERB_DEPTH", xmlLabel: "Mod Depth" },
    "reverb.mod_rate": { groupCode: "REV", block: "reverb", paramId: 12, wikiName: "MOD RATE", name: "mod_rate", controlType: "knob", parameterName: "REVERB_RATE", xmlLabel: "Mod Rate" },
    // HW-088 calibration (2026-05-11): wire 0..65534 ↔ 0..100% linear.
    "reverb.mix": { groupCode: "REV", block: "reverb", paramId: 13, wikiName: "MIX", name: "mix", controlType: "knob", parameterName: "REVERB_MIX", xmlLabel: "Mix", modifierAssignable: true, displayMin: 0, displayMax: 100 },
    "reverb.level": { groupCode: "REV", block: "reverb", paramId: 14, wikiName: "Level", name: "level", controlType: "knob", parameterName: "REVERB_LEVEL", xmlLabel: "Level", modifierAssignable: true },
    "reverb.balance": { groupCode: "REV", block: "reverb", paramId: 15, wikiName: "Balance", name: "balance", controlType: "knob", parameterName: "REVERB_PAN", xmlLabel: "Balance", modifierAssignable: true },
    "reverb.bypass_mode": { groupCode: "REV", block: "reverb", paramId: 16, wikiName: "BYPASS MODE", name: "bypass_mode", controlType: "select", parameterName: "REVERB_BYPASSMODE", xmlLabel: "Bypass Mode", enumValues: REVERB_BYPASS_MODE_VALUES, modifierAssignable: true },
    "reverb.global": { groupCode: "REV", block: "reverb", paramId: 17, wikiName: "GLOBAL", name: "global", controlType: "switch" },
    "reverb.input_gain": { groupCode: "REV", block: "reverb", paramId: 18, wikiName: "INPUT GAIN", name: "input_gain", controlType: "knob", parameterName: "REVERB_GAIN", xmlLabel: "Input Gain", modifierAssignable: true },
    "reverb.echo_density": { groupCode: "REV", block: "reverb", paramId: 19, wikiName: "ECHO DENSITY", name: "echo_density", controlType: "unknown", parameterName: "REVERB_DENSITY", xmlLabel: "Echo Density", displayMin: 2, displayMax: 8, step: 1 },
    "reverb.late_diffusion": { groupCode: "REV", block: "reverb", paramId: 20, wikiName: "LATE DIFFUSION", name: "late_diffusion", controlType: "knob", parameterName: "REVERB_INPDIFF", xmlLabel: "Late Diffusion" },
    "reverb.late_diff_time": { groupCode: "REV", block: "reverb", paramId: 21, wikiName: "LATE DIFF TIME", name: "late_diff_time", controlType: "knob", parameterName: "REVERB_INDIFFTIME", xmlLabel: "Late Diff Time" },
    "reverb.spring_number": { groupCode: "REV", block: "reverb", paramId: 23, wikiName: "SPRING NUMBER", name: "spring_number", controlType: "unknown", displayMin: 2, displayMax: 6, step: 1 },
    "reverb.spring_tone": { groupCode: "REV", block: "reverb", paramId: 24, wikiName: "SPRING TONE", name: "spring_tone", controlType: "knob", parameterName: "REVERB_TONE", xmlLabel: "Spring Tone" },
    "reverb.mic_spacing": { groupCode: "REV", block: "reverb", paramId: 25, wikiName: "MIC SPACING", name: "mic_spacing", controlType: "knob", parameterName: "REVERB_WIDTH", xmlLabel: "Mic Spacing" },
    "reverb.freq_1": { groupCode: "REV", block: "reverb", paramId: 26, wikiName: "FREQ 1", name: "freq_1", controlType: "knob", parameterName: "REVERB_FREQ1", xmlLabel: "Freq 1" },
    "reverb.freq_2": { groupCode: "REV", block: "reverb", paramId: 27, wikiName: "FREQ 2", name: "freq_2", controlType: "knob", parameterName: "REVERB_FREQ2", xmlLabel: "Freq 2" },
    "reverb.q_1": { groupCode: "REV", block: "reverb", paramId: 28, wikiName: "Q 1", name: "q_1", controlType: "knob", parameterName: "REVERB_Q1", xmlLabel: "Q 1" },
    "reverb.q_2": { groupCode: "REV", block: "reverb", paramId: 29, wikiName: "Q 2", name: "q_2", controlType: "knob", parameterName: "REVERB_Q2", xmlLabel: "Q 2" },
    "reverb.gain_1": { groupCode: "REV", block: "reverb", paramId: 30, wikiName: "GAIN 1", name: "gain_1", controlType: "knob", parameterName: "REVERB_GAIN1", xmlLabel: "Gain 1" },
    "reverb.gain_2": { groupCode: "REV", block: "reverb", paramId: 31, wikiName: "GAIN 2", name: "gain_2", controlType: "knob", parameterName: "REVERB_GAIN2", xmlLabel: "Gain 2" },
    "reverb.spring_drive": { groupCode: "REV", block: "reverb", paramId: 32, wikiName: "SPRING DRIVE", name: "spring_drive", controlType: "knob", parameterName: "REVERB_DRIVE", xmlLabel: "Spring Drive" },
    "reverb.lf_time": { groupCode: "REV", block: "reverb", paramId: 33, wikiName: "LF TIME", name: "lf_time", controlType: "knob", parameterName: "REVERB_LFTIME", xmlLabel: "LF Time" },
    "reverb.lf_crossover": { groupCode: "REV", block: "reverb", paramId: 34, wikiName: "LF CROSSOVER", name: "lf_crossover", controlType: "knob", parameterName: "REVERB_LFXOVER", xmlLabel: "LF Crossover" },
    "reverb.stereo_width": { groupCode: "REV", block: "reverb", paramId: 35, wikiName: "STEREO WIDTH", name: "stereo_width", controlType: "knob", parameterName: "REVERB_SPREAD", xmlLabel: "Stereo Width" },
    "reverb.atten": { groupCode: "REV", block: "reverb", paramId: 36, wikiName: "ATTEN", name: "atten", controlType: "knob", parameterName: "REVERB_ATTEN", xmlLabel: "Atten" },
    "reverb.threshold": { groupCode: "REV", block: "reverb", paramId: 37, wikiName: "THRESHOLD", name: "threshold", controlType: "knob", parameterName: "REVERB_THRESH", xmlLabel: "Threshold" },
    "reverb.release_time": { groupCode: "REV", block: "reverb", paramId: 38, wikiName: "RELEASE TIME", name: "release_time", controlType: "knob", parameterName: "REVERB_RELEASE", xmlLabel: "Release Time" },
    "reverb.early_diffusion": { groupCode: "REV", block: "reverb", paramId: 39, wikiName: "EARLY DIFFUSION", name: "early_diffusion", controlType: "knob", parameterName: "REVERB_EARLYDIFF", xmlLabel: "Early Diffusion" },
    "reverb.early_diff_time": { groupCode: "REV", block: "reverb", paramId: 40, wikiName: "EARLY DIFF TIME", name: "early_diff_time", controlType: "knob", parameterName: "REVERB_EARLYDIFFTIME", xmlLabel: "Early Diff Time" },
    "reverb.early_decay": { groupCode: "REV", block: "reverb", paramId: 41, wikiName: "EARLY DECAY", name: "early_decay", controlType: "knob", parameterName: "REVERB_EARLYDECAY", xmlLabel: "Early Decay" },
    "reverb.quality": { groupCode: "REV", block: "reverb", paramId: 43, wikiName: "QUALITY", name: "quality", controlType: "select", parameterName: "REVERB_QUALITY", xmlLabel: "Quality", enumValues: REVERB_QUALITY_VALUES },
    "reverb.hold": { groupCode: "REV", block: "reverb", paramId: 44, wikiName: "HOLD", name: "hold", controlType: "switch", parameterName: "REVERB_HOLD", xmlLabel: "Hold", modifierAssignable: true },
    "ringmod.frequency": { groupCode: "RNG", block: "ringmod", paramId: 0, wikiName: "FREQUENCY", name: "frequency", controlType: "knob", parameterName: "RINGMOD_COARSE", xmlLabel: "Frequency", modifierAssignable: true },
    "ringmod.f_multiplier": { groupCode: "RNG", block: "ringmod", paramId: 1, wikiName: "F. MULTIPLIER", name: "f_multiplier", controlType: "knob", modifierAssignable: true },
    "ringmod.track": { groupCode: "RNG", block: "ringmod", paramId: 2, wikiName: "TRACK", name: "track", controlType: "switch", parameterName: "RINGMOD_TRACK", xmlLabel: "Track" },
    "ringmod.high_cut": { groupCode: "RNG", block: "ringmod", paramId: 3, wikiName: "HIGH CUT", name: "high_cut", controlType: "knob", parameterName: "RINGMOD_HICUT", xmlLabel: "High Cut" },
    "ringmod.mix": { groupCode: "RNG", block: "ringmod", paramId: 4, wikiName: "MIX", name: "mix", controlType: "knob", parameterName: "RINGMOD_MIX", xmlLabel: "Mix", modifierAssignable: true },
    "ringmod.level": { groupCode: "RNG", block: "ringmod", paramId: 5, wikiName: "Level", name: "level", controlType: "knob", parameterName: "RINGMOD_LEVEL", xmlLabel: "Level", modifierAssignable: true },
    "ringmod.balance": { groupCode: "RNG", block: "ringmod", paramId: 6, wikiName: "Balance", name: "balance", controlType: "knob", parameterName: "RINGMOD_PAN", xmlLabel: "Balance", modifierAssignable: true },
    "ringmod.bypass_mode": { groupCode: "RNG", block: "ringmod", paramId: 7, wikiName: "BYPASS MODE", name: "bypass_mode", controlType: "select", parameterName: "RINGMOD_BYPASSMODE", xmlLabel: "Bypass Mode", enumValues: RINGMOD_BYPASS_MODE_VALUES, modifierAssignable: true },
    "ringmod.global_mix": { groupCode: "RNG", block: "ringmod", paramId: 8, wikiName: "GLOBAL MIX", name: "global_mix", controlType: "switch" },
    "rotary.rate": { groupCode: "ROT", block: "rotary", paramId: 0, wikiName: "RATE", name: "rate", controlType: "knob", parameterName: "ROTARY_RATE", xmlLabel: "Rate", modifierAssignable: true },
    "rotary.low_depth": { groupCode: "ROT", block: "rotary", paramId: 1, wikiName: "LOW DEPTH", name: "low_depth", controlType: "knob", parameterName: "ROTARY_LFDEPTH", xmlLabel: "Low Depth" },
    "rotary.hi_depth": { groupCode: "ROT", block: "rotary", paramId: 2, wikiName: "HI DEPTH", name: "hi_depth", controlType: "knob", parameterName: "ROTARY_HFDEPTH", xmlLabel: "Hi Depth" },
    "rotary.hi_level": { groupCode: "ROT", block: "rotary", paramId: 3, wikiName: "HI Level", name: "hi_level", controlType: "knob" },
    "rotary.tempo": { groupCode: "ROT", block: "rotary", paramId: 4, wikiName: "Tempo", name: "tempo", controlType: "select", parameterName: "ROTARY_TEMPO", xmlLabel: "Tempo" },
    "rotary.mix": { groupCode: "ROT", block: "rotary", paramId: 5, wikiName: "MIX", name: "mix", controlType: "knob", parameterName: "ROTARY_MIX", xmlLabel: "Mix", modifierAssignable: true },
    "rotary.level": { groupCode: "ROT", block: "rotary", paramId: 6, wikiName: "Level", name: "level", controlType: "knob", parameterName: "ROTARY_LEVEL", xmlLabel: "Level", modifierAssignable: true },
    "rotary.balance": { groupCode: "ROT", block: "rotary", paramId: 7, wikiName: "Balance", name: "balance", controlType: "knob", parameterName: "ROTARY_PAN", xmlLabel: "Balance", modifierAssignable: true },
    "rotary.bypass_mode": { groupCode: "ROT", block: "rotary", paramId: 8, wikiName: "BYPASS MODE", name: "bypass_mode", controlType: "select", parameterName: "ROTARY_BYPASSMODE", xmlLabel: "Bypass Mode", enumValues: ROTARY_BYPASS_MODE_VALUES, modifierAssignable: true },
    "rotary.rotor_length": { groupCode: "ROT", block: "rotary", paramId: 10, wikiName: "ROTOR LENGTH", name: "rotor_length", controlType: "knob", parameterName: "ROTARY_HFLENGTH", xmlLabel: "Rotor Length" },
    "rotary.mic_spacing": { groupCode: "ROT", block: "rotary", paramId: 12, wikiName: "MIC SPACING", name: "mic_spacing", controlType: "knob", parameterName: "ROTARY_WIDTH", xmlLabel: "Mic Spacing" },
    "rotary.low_rate_mult": { groupCode: "ROT", block: "rotary", paramId: 13, wikiName: "LOW RATE MULT", name: "low_rate_mult", controlType: "knob", parameterName: "ROTARY_LOWRATE", xmlLabel: "Low Rate Mult" },
    "rotary.low_time_const": { groupCode: "ROT", block: "rotary", paramId: 14, wikiName: "LOW TIME CONST", name: "low_time_const", controlType: "knob", parameterName: "ROTARY_LOWTIME", xmlLabel: "Low Time Const" },
    "rotary.hi_time_const": { groupCode: "ROT", block: "rotary", paramId: 15, wikiName: "HI TIME CONST", name: "hi_time_const", controlType: "knob", parameterName: "ROTARY_HIGHTIME", xmlLabel: "Hi Time Const" },
    "rotary.stereo_spread": { groupCode: "ROT", block: "rotary", paramId: 16, wikiName: "STEREO SPREAD", name: "stereo_spread", controlType: "knob", parameterName: "ROTARY_SPREAD", xmlLabel: "Stereo Spread" },
    "rotary.drive": { groupCode: "ROT", block: "rotary", paramId: 17, wikiName: "DRIVE", name: "drive", controlType: "knob", parameterName: "ROTARY_DRIVE", xmlLabel: "Drive" },
    "rotary.mic_distance": { groupCode: "ROT", block: "rotary", paramId: 18, wikiName: "MIC DISTANCE", name: "mic_distance", controlType: "knob", parameterName: "ROTARY_MICDIST", xmlLabel: "Mic Distance" },
    "synth.type_1": { groupCode: "SYN", block: "synth", paramId: 0, wikiName: "TYPE 1", name: "type_1", controlType: "select", enumValues: SYNTH_TYPE_1_VALUES },
    "synth.frequency_1": { groupCode: "SYN", block: "synth", paramId: 1, wikiName: "FREQUENCY 1", name: "frequency_1", controlType: "knob", modifierAssignable: true },
    "synth.track_1": { groupCode: "SYN", block: "synth", paramId: 2, wikiName: "TRACK 1", name: "track_1", controlType: "select", enumValues: SYNTH_TRACK_1_VALUES },
    "synth.shift_1": { groupCode: "SYN", block: "synth", paramId: 3, wikiName: "SHIFT 1", name: "shift_1", controlType: "knob", modifierAssignable: true },
    "synth.tune_1": { groupCode: "SYN", block: "synth", paramId: 4, wikiName: "TUNE 1", name: "tune_1", controlType: "knob", modifierAssignable: true },
    "synth.duty_1": { groupCode: "SYN", block: "synth", paramId: 5, wikiName: "DUTY 1", name: "duty_1", controlType: "knob", modifierAssignable: true },
    "synth.voice_level_1": { groupCode: "SYN", block: "synth", paramId: 6, wikiName: "VOICE Level 1", name: "voice_level_1", controlType: "knob", modifierAssignable: true },
    "synth.voice_pan_1": { groupCode: "SYN", block: "synth", paramId: 7, wikiName: "VOICE Pan 1", name: "voice_pan_1", controlType: "knob", modifierAssignable: true },
    "synth.attack_1": { groupCode: "SYN", block: "synth", paramId: 8, wikiName: "ATTACK 1", name: "attack_1", controlType: "knob" },
    "synth.filter_1": { groupCode: "SYN", block: "synth", paramId: 9, wikiName: "FILTER 1", name: "filter_1", controlType: "knob", modifierAssignable: true },
    "synth.q_1": { groupCode: "SYN", block: "synth", paramId: 10, wikiName: "Q 1", name: "q_1", controlType: "knob" },
    "synth.type_2": { groupCode: "SYN", block: "synth", paramId: 11, wikiName: "TYPE 2", name: "type_2", controlType: "select", enumValues: SYNTH_TYPE_2_VALUES },
    "synth.frequency_2": { groupCode: "SYN", block: "synth", paramId: 12, wikiName: "FREQUENCY 2", name: "frequency_2", controlType: "knob", modifierAssignable: true },
    "synth.track_2": { groupCode: "SYN", block: "synth", paramId: 13, wikiName: "TRACK 2", name: "track_2", controlType: "select", enumValues: SYNTH_TRACK_2_VALUES },
    "synth.shift_2": { groupCode: "SYN", block: "synth", paramId: 14, wikiName: "SHIFT 2", name: "shift_2", controlType: "knob", modifierAssignable: true },
    "synth.tune_2": { groupCode: "SYN", block: "synth", paramId: 15, wikiName: "TUNE 2", name: "tune_2", controlType: "knob", modifierAssignable: true },
    "synth.duty_2": { groupCode: "SYN", block: "synth", paramId: 16, wikiName: "DUTY 2", name: "duty_2", controlType: "knob", modifierAssignable: true },
    "synth.voice_level_2": { groupCode: "SYN", block: "synth", paramId: 17, wikiName: "VOICE Level 2", name: "voice_level_2", controlType: "knob", modifierAssignable: true },
    "synth.voice_pan_2": { groupCode: "SYN", block: "synth", paramId: 18, wikiName: "VOICE Pan 2", name: "voice_pan_2", controlType: "knob", modifierAssignable: true },
    "synth.attack_2": { groupCode: "SYN", block: "synth", paramId: 19, wikiName: "ATTACK 2", name: "attack_2", controlType: "knob" },
    "synth.filter_2": { groupCode: "SYN", block: "synth", paramId: 20, wikiName: "FILTER 2", name: "filter_2", controlType: "knob", modifierAssignable: true },
    "synth.q_2": { groupCode: "SYN", block: "synth", paramId: 21, wikiName: "Q 2", name: "q_2", controlType: "knob" },
    "synth.mix": { groupCode: "SYN", block: "synth", paramId: 23, wikiName: "MIX", name: "mix", controlType: "knob", parameterName: "SYNTH_MIX", xmlLabel: "Mix", modifierAssignable: true },
    "synth.level": { groupCode: "SYN", block: "synth", paramId: 24, wikiName: "Level", name: "level", controlType: "knob", parameterName: "SYNTH_LEVEL", xmlLabel: "Level", modifierAssignable: true },
    "synth.balance": { groupCode: "SYN", block: "synth", paramId: 25, wikiName: "Balance", name: "balance", controlType: "knob", parameterName: "SYNTH_PAN", xmlLabel: "Balance", modifierAssignable: true },
    "synth.bypass_mode": { groupCode: "SYN", block: "synth", paramId: 26, wikiName: "BYPASS MODE", name: "bypass_mode", controlType: "select", parameterName: "SYNTH_BYPASSMODE", xmlLabel: "Bypass Mode", enumValues: SYNTH_BYPASS_MODE_VALUES, modifierAssignable: true },
    "synth.global_mix": { groupCode: "SYN", block: "synth", paramId: 27, wikiName: "GLOBAL MIX", name: "global_mix", controlType: "switch" },
    "synth.type_3": { groupCode: "SYN", block: "synth", paramId: 29, wikiName: "TYPE 3", name: "type_3", controlType: "select", enumValues: SYNTH_TYPE_3_VALUES },
    "synth.frequency_3": { groupCode: "SYN", block: "synth", paramId: 30, wikiName: "FREQUENCY 3", name: "frequency_3", controlType: "knob", modifierAssignable: true },
    "synth.track_3": { groupCode: "SYN", block: "synth", paramId: 31, wikiName: "TRACK 3", name: "track_3", controlType: "select", enumValues: SYNTH_TRACK_3_VALUES },
    "synth.shift_3": { groupCode: "SYN", block: "synth", paramId: 32, wikiName: "SHIFT 3", name: "shift_3", controlType: "knob", modifierAssignable: true },
    "synth.tune_3": { groupCode: "SYN", block: "synth", paramId: 33, wikiName: "TUNE 3", name: "tune_3", controlType: "knob", modifierAssignable: true },
    "synth.duty_3": { groupCode: "SYN", block: "synth", paramId: 34, wikiName: "DUTY 3", name: "duty_3", controlType: "knob", modifierAssignable: true },
    "synth.voice_level_3": { groupCode: "SYN", block: "synth", paramId: 35, wikiName: "VOICE Level 3", name: "voice_level_3", controlType: "knob", modifierAssignable: true },
    "synth.voice_pan_3": { groupCode: "SYN", block: "synth", paramId: 36, wikiName: "VOICE Pan 3", name: "voice_pan_3", controlType: "knob", modifierAssignable: true },
    "synth.attack_3": { groupCode: "SYN", block: "synth", paramId: 37, wikiName: "ATTACK 3", name: "attack_3", controlType: "knob" },
    "synth.filter_3": { groupCode: "SYN", block: "synth", paramId: 38, wikiName: "FILTER 3", name: "filter_3", controlType: "knob", modifierAssignable: true },
    "synth.q_3": { groupCode: "SYN", block: "synth", paramId: 39, wikiName: "Q 3", name: "q_3", controlType: "knob" },
    "volpan.volume": { groupCode: "VOL", block: "volpan", paramId: 0, wikiName: "VOLUME", name: "volume", controlType: "knob", parameterName: "VOLUME_GAIN", xmlLabel: "Volume", modifierAssignable: true },
    "volpan.balance": { groupCode: "VOL", block: "volpan", paramId: 1, wikiName: "Balance", name: "balance", controlType: "knob", parameterName: "VOLUME_BAL", xmlLabel: "Balance", modifierAssignable: true },
    "volpan.volume_taper": { groupCode: "VOL", block: "volpan", paramId: 2, wikiName: "VOLUME TAPER", name: "volume_taper", controlType: "select", parameterName: "VOLUME_TAPER", xmlLabel: "Volume Taper", enumValues: VOLPAN_VOLUME_TAPER_VALUES },
    "volpan.pan_left": { groupCode: "VOL", block: "volpan", paramId: 4, wikiName: "Pan Left", name: "pan_left", controlType: "knob", parameterName: "VOLUME_PANL", xmlLabel: "Pan Left", modifierAssignable: true },
    "volpan.pan_right": { groupCode: "VOL", block: "volpan", paramId: 5, wikiName: "Pan Right", name: "pan_right", controlType: "knob", parameterName: "VOLUME_PANR", xmlLabel: "Pan Right", modifierAssignable: true },
    "volpan.level": { groupCode: "VOL", block: "volpan", paramId: 6, wikiName: "Level", name: "level", controlType: "knob", parameterName: "VOLUME_LEVEL", xmlLabel: "Level", modifierAssignable: true },
    "volpan.bypass_mode": { groupCode: "VOL", block: "volpan", paramId: 7, wikiName: "BYPASS MODE", name: "bypass_mode", controlType: "select", parameterName: "VOLUME_BYPASSMODE", xmlLabel: "Bypass Mode", enumValues: VOLPAN_BYPASS_MODE_VALUES, modifierAssignable: true },
    "volpan.input_select": { groupCode: "VOL", block: "volpan", paramId: 8, wikiName: "INPUT SELECT", name: "input_select", controlType: "select", parameterName: "VOLUME_INPUTSELECT", xmlLabel: "Input Select", enumValues: VOLPAN_INPUT_SELECT_VALUES },
    "wah.effect_type": { groupCode: "WAH", block: "wah", paramId: 0, wikiName: "EFFECT TYPE", name: "effect_type", controlType: "select", enumValues: WAH_EFFECT_TYPE_VALUES },
    "wah.freq_min": { groupCode: "WAH", block: "wah", paramId: 1, wikiName: "FREQ MIN", name: "freq_min", controlType: "knob" },
    "wah.freq_max": { groupCode: "WAH", block: "wah", paramId: 2, wikiName: "FREQ MAX", name: "freq_max", controlType: "knob" },
    "wah.resonance": { groupCode: "WAH", block: "wah", paramId: 3, wikiName: "RESONANCE", name: "resonance", controlType: "knob", parameterName: "WAH_Q", xmlLabel: "Resonance" },
    "wah.tracking": { groupCode: "WAH", block: "wah", paramId: 4, wikiName: "TRACKING", name: "tracking", controlType: "knob", parameterName: "WAH_TRACK", xmlLabel: "Tracking" },
    "wah.control": { groupCode: "WAH", block: "wah", paramId: 5, wikiName: "CONTROL", name: "control", controlType: "knob", parameterName: "WAH_CONTROL", xmlLabel: "Control", modifierAssignable: true },
    "wah.level": { groupCode: "WAH", block: "wah", paramId: 6, wikiName: "Level", name: "level", controlType: "knob", parameterName: "WAH_LEVEL", xmlLabel: "Level", modifierAssignable: true },
    "wah.balance": { groupCode: "WAH", block: "wah", paramId: 7, wikiName: "Balance", name: "balance", controlType: "knob", parameterName: "WAH_PAN", xmlLabel: "Balance", modifierAssignable: true },
    "wah.bypass_mode": { groupCode: "WAH", block: "wah", paramId: 8, wikiName: "BYPASS MODE", name: "bypass_mode", controlType: "select", parameterName: "WAH_BYPASSMODE", xmlLabel: "Bypass Mode", enumValues: WAH_BYPASS_MODE_VALUES, modifierAssignable: true },
    "wah.fat": { groupCode: "WAH", block: "wah", paramId: 9, wikiName: "FAT", name: "fat", controlType: "knob", parameterName: "WAH_MIX", xmlLabel: "Fat" },
    "wah.drive": { groupCode: "WAH", block: "wah", paramId: 10, wikiName: "DRIVE", name: "drive", controlType: "knob", parameterName: "WAH_DRIVE", xmlLabel: "Drive" },
    "wah.taper": { groupCode: "WAH", block: "wah", paramId: 11, wikiName: "TAPER", name: "taper", controlType: "select", parameterName: "WAH_TAPER", xmlLabel: "Taper", enumValues: WAH_TAPER_VALUES },
    "wah.coil_bias": { groupCode: "WAH", block: "wah", paramId: 13, wikiName: "COIL BIAS", name: "coil_bias", controlType: "knob", parameterName: "WAH_BIAS", xmlLabel: "Coil Bias", fwAdded: "Since Quantum 6" },
    "wah.low_cut_freq": { groupCode: "WAH", block: "wah", paramId: 14, wikiName: "LOW CUT FREQ", name: "low_cut_freq", controlType: "knob", fwAdded: "Since Quantum 6" },
} as const satisfies Readonly<Record<string, AxeFxIIParam>>;

export type AxeFxIIParamKey = keyof typeof KNOWN_PARAMS;

/** Extraction summary (refresh by re-running the generator). */
export const REGISTRY_STATS = Object.freeze({
    totalParams: 905,
    totalEnumEntries: 1239,
});
