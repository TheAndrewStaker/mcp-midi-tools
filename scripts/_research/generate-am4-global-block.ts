// Generate the GLOBAL family params.ts block from the AM4 Ghidra catalog.
// HW-112 (Session 96) decoded pidLow=0x0001 from
// samples/captured/session-95-am4-global-pidlow.pcapng. The Ghidra
// dispatcher catalog (case_0x1) carries paramId + symbol for all 99
// GLOBAL_* settings; this script emits a hand-edit-ready TypeScript
// snippet that appends them to KNOWN_PARAMS.
//
// Unit heuristics are name-based and intentionally conservative — only
// the two HW-112-confirmed params (USBLEVEL1 = dB, TAP_TEMPO_MODE = enum)
// get hardware-verified ranges. Everything else defaults to safe `count`
// placeholders pending HW verification.

import { readFileSync } from 'node:fs';

const PATH = 'samples/captured/decoded/ghidra-am4-paramnames.json';
const XML_REG = 'samples/captured/decoded/binarydata/extracted/__block_layout.xml';
const XML_EXPERT = 'samples/captured/decoded/binarydata/extracted/__block_layout_expert.xml';

const data = JSON.parse(readFileSync(PATH, 'utf8'));
const params: Array<{ paramId: number; name: string }> = data.effect_types.case_0x1.params;

// Symbol → XML display label (first hit wins; same loader the cross-ref
// audit uses).
const xmlLabel = new Map<string, string>();
for (const x of [readFileSync(XML_REG, 'utf-8'), readFileSync(XML_EXPERT, 'utf-8')]) {
  for (const m of x.matchAll(/<EditorControl\b([^>]*?)\/?>/g)) {
    const attrs = m[1];
    const sym = attrs.match(/parameterName="([A-Z][A-Z0-9_]*)"/)?.[1];
    const name = attrs.match(/\bname="([^"]+)"/)?.[1]
      ?.replace(/&#10;/g, ' ')
      .replace(/&amp;/g, '&');
    if (sym && name && !xmlLabel.has(sym)) xmlLabel.set(sym, name);
  }
}

// Dedupe by paramId — catalog has GLOBAL_FC_HOLD_TIMEOUT listed twice at id 57.
const byId = new Map<number, string>();
for (const p of params) if (!byId.has(p.paramId)) byId.set(p.paramId, p.name);

type Unit = 'knob_0_10' | 'db' | 'hz' | 'seconds' | 'percent' | 'bipolar_percent' |
            'count' | 'semitones' | 'ratio' | 'ms' | 'degrees' | 'enum';

type ParamShape = {
  key: string;
  name: string;
  displayLabel?: string;
  paramId: number;
  unit: Unit;
  displayMin: number;
  displayMax: number;
  enumValues?: Record<number, string>;
  comment?: string;
};

// Map raw GLOBAL_* symbol → tool-facing snake_case name (strip prefix, lowercase,
// convert `+N` array suffixes to `_N`).
function toKey(symbol: string): string {
  return symbol.replace(/^GLOBAL_/, '').replace(/\+(\d+)/g, '_$1').toLowerCase();
}

// Conservative unit inference. Returns the unit + a typical display range +
// optional comment marking confidence level. HW-confirmed entries are
// overridden below by name.
function infer(symbol: string, paramId: number): Omit<ParamShape, 'key' | 'name' | 'paramId'> {
  const s = symbol.toUpperCase();
  // HW-112 confirmed.
  if (paramId === 99) {
    // GLOBAL_USBLEVEL1 — captured value 1.11 dB. Fractal USB-out trim is
    // typically -64..+24 dB; conservatively widen to a 100 dB span.
    return { unit: 'db', displayMin: -64, displayMax: 24,
             comment: 'HW-112 (Session 96) — captured at 1.11 dB' };
  }
  if (paramId === 46) {
    // GLOBAL_TAP_TEMPO_MODE — captured value 1.0 displays as "Last Two".
    // Full enum table not yet captured; leaving values unset until HW.
    return { unit: 'enum', displayMin: 0, displayMax: 7,
             comment: 'HW-112 (Session 96) — captured at 1.0 = "Last Two"; full enum table pending HW' };
  }
  // MIDI CC mappings — value is a CC number 0..127.
  if (/_CC$/.test(s)) return { unit: 'count', displayMin: 0, displayMax: 127 };
  // Sibling USB / AES / metronome levels — dB family.
  if (/USBLEVEL\d+$|^AESLEVEL$|^METLEVEL\d+$/.test(s.replace(/^GLOBAL_/, ''))) {
    return { unit: 'db', displayMin: -64, displayMax: 24,
             comment: 'unit inferred from USBLEVEL1 sibling — HW unverified' };
  }
  // Out 2 graphic EQ bands — Fractal GEQ is ±12 dB across 10 bands.
  if (/OUT2EQ\d+$/.test(s)) {
    return { unit: 'db', displayMin: -12, displayMax: 12,
             comment: 'GEQ band ±12 dB convention — HW unverified' };
  }
  // LCD contrast + FC ring LED brightness — percent.
  if (/LCD_CONTRAST$|RING_BRIGHT_LEVEL$|RING_DIM_LEVEL$/.test(s)) {
    return { unit: 'percent', displayMin: 0, displayMax: 100,
             comment: 'percent inferred from AM4-Edit display — HW unverified' };
  }
  // Tuning reference — Hz, typically 430..450.
  if (s.endsWith('_TUNINGREF') || s === 'GLOBAL_TUNINGREF') {
    return { unit: 'hz', displayMin: 430, displayMax: 450,
             comment: 'tuning reference Hz convention — HW unverified' };
  }
  // Down-tune — semitones, negative range.
  if (s.endsWith('_DOWNTUNE') || s === 'GLOBAL_DOWNTUNE') {
    return { unit: 'semitones', displayMin: -12, displayMax: 0,
             comment: 'down-tune semitones — HW unverified' };
  }
  // Per-string tuning offsets — semitones, bipolar small range.
  if (/^GLOBAL_OFFSET\d$/.test(s)) {
    return { unit: 'semitones', displayMin: -1, displayMax: 1,
             comment: 'per-string tuning offset — HW unverified' };
  }
  // Gate offset — dB.
  if (s === 'GLOBAL_GATE_OFFSET') {
    return { unit: 'db', displayMin: -40, displayMax: 0,
             comment: 'gate threshold offset dB — HW unverified' };
  }
  // Input trim — percent.
  if (s === 'GLOBAL_IN1_TRIM') {
    return { unit: 'percent', displayMin: 0, displayMax: 100,
             comment: 'input trim percent — HW unverified' };
  }
  // MIDI channel — 1..16.
  if (s === 'GLOBAL_MIDI_CHAN') {
    return { unit: 'count', displayMin: 1, displayMax: 16,
             comment: 'MIDI channel 1..16' };
  }
  // Footswitch hold timeout (FC_HOLD_TIMEOUT, FS_PRESS_HOLD*) — ms.
  if (/HOLD_TIMEOUT$|FS_PRESS_HOLD\d+$/.test(s)) {
    return { unit: 'ms', displayMin: 0, displayMax: 5000,
             comment: 'press-hold timeout ms — HW unverified' };
  }
  // Default scene picker — 1..4 (AM4 has 4 scenes).
  if (s === 'GLOBAL_DEFAULT_SCENE') {
    return { unit: 'count', displayMin: 1, displayMax: 4,
             comment: 'AM4 has 4 scenes (1..4)' };
  }
  // External CC begin pool — CC numbers.
  if (/^GLOBAL_EXT_CC_BEGIN/.test(s)) {
    return { unit: 'count', displayMin: 0, displayMax: 127,
             comment: 'external CC routing — CC number 0..127' };
  }
  // External startval pool — CC values, 0..127.
  if (/^GLOBAL_EXT_STARTVAL_BEGIN/.test(s)) {
    return { unit: 'count', displayMin: 0, displayMax: 127,
             comment: 'external CC initial value 0..127' };
  }
  // Everything else: safe `count` placeholder pending HW capture.
  return { unit: 'count', displayMin: 0, displayMax: 127,
           comment: 'safe placeholder (range unverified) — Ghidra catalog entry only' };
}

const entries: ParamShape[] = [];
for (const [paramId, symbol] of [...byId.entries()].sort((a, b) => a[0] - b[0])) {
  const tail = toKey(symbol);
  const shape = infer(symbol, paramId);
  entries.push({
    key: `global.${tail}`,
    name: tail,
    displayLabel: xmlLabel.get(symbol),
    paramId,
    ...shape,
  });
}

// Emit the TypeScript snippet.
let out = '';
out += `  // ============================================================\n`;
out += `  // GLOBAL family (pidLow = 0x0001) — 98 entries.\n`;
out += `  //\n`;
out += `  // Wire pidLow decoded HW-112 (Session 96, 2026-05-17) from\n`;
out += `  // samples/captured/session-95-am4-global-pidlow.pcapng. paramIds\n`;
out += `  // sourced from samples/captured/decoded/ghidra-am4-paramnames.json\n`;
out += `  // (effect_types.case_0x1.params, 99 entries; GLOBAL_FC_HOLD_TIMEOUT\n`;
out += `  // appears twice at paramId 57 so deduped to 98).\n`;
out += `  //\n`;
out += `  // Two paramIds are HW-verified by the HW-112 capture: USBLEVEL1\n`;
out += `  // (99) at 1.11 dB and TAP_TEMPO_MODE (46) at 1.0 = "Last Two".\n`;
out += `  // All other unit/range pairs are name-inferred — entries default\n`;
out += `  // to unit: 'count' as a safe write placeholder pending hardware\n`;
out += `  // verification. The Ghidra catalog gives us the address and the\n`;
out += `  // symbolic name; UI semantics still need front-panel or AM4-Edit\n`;
out += `  // captures to confirm range/enum tables.\n`;
out += `  //\n`;
out += `  // Naming convention: \`global.<lowercased>\` with the GLOBAL_ prefix\n`;
out += `  // stripped and \`+N\` array suffixes converted to \`_N\` (so\n`;
out += `  // \`GLOBAL_EXT_CC_BEGIN+1\` -> \`global.ext_cc_begin_1\`).\n`;
out += `\n`;

for (const e of entries) {
  const comment = e.comment ? `  // ${e.comment}\n` : '';
  const enumPart = e.enumValues
    ? `, enumValues: ${JSON.stringify(e.enumValues)}`
    : '';
  const labelPart = e.displayLabel
    ? `, displayLabel: ${JSON.stringify(e.displayLabel)}`
    : '';
  out += comment;
  out += `  '${e.key}': { block: 'global', name: '${e.name}'${labelPart}, pidLow: 0x0001, pidHigh: 0x${e.paramId.toString(16).padStart(4, '0')}, unit: '${e.unit}', displayMin: ${e.displayMin}, displayMax: ${e.displayMax}${enumPart} },\n`;
}

process.stdout.write(out);
console.error(`Emitted ${entries.length} GLOBAL entries (deduped from ${params.length} catalog rows)`);
