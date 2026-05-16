/**
 * Survey AxeEdit III string dump for high-value Ghidra anchors.
 *
 * Loads samples/captured/decoded/axeedit3-strings.json and emits a
 * bucketed report of strings that are likely valuable to xref-walk
 * in Ghidra. The output guides which strings to add as anchors to
 * scripts/ghidra/MineAxeEditIII.java.
 *
 * Buckets (each becomes a section in the output):
 *
 *  1. SYSEX_*, MIDI_*, FRACTAL_* prefixed names — protocol-level
 *     enum identifiers
 *  2. msg_ format strings — message-builder hints
 *  3. Set/Get/Update/Process function-like names — likely
 *     handler / builder function symbols
 *  4. xxxMessage / xxxPacket / xxxResponse / xxxFrame / xxxEnvelope —
 *     wire-format-named symbols
 *  5. ParamX / EffectX / BlockX / SceneX / ChannelX / PatchX /
 *     PresetX / CabX / AmpX — domain-named symbols
 *  6. CSV / table column headers (likely export-related)
 *  7. Resource / asset / file-path strings (.xml, .json, .bin,
 *     BinaryData::)
 *  8. Enum value names: anything ALL_CAPS with underscores
 *  9. JUCE/Qt class names (anything containing "::" — useful for
 *     identifying which framework classes the binary uses)
 *
 * Output: stdout (printed to terminal). Optionally write to file via --out.
 *
 * Run:
 *   npx tsx scripts/_research/survey-axeedit3-anchors.ts [--out file.txt]
 */

import { readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
function flag(name: string, fallback?: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  if (i < 0 || i + 1 >= args.length) return fallback;
  return args[i + 1];
}

const inPath = flag('in', 'samples/captured/decoded/axeedit3-strings.json')!;
const outPath = flag('out');

interface ExtractedString {
  offset: number;
  kind: 'ascii' | 'utf16le';
  value: string;
}

console.log(`reading ${inPath}…`);
const all: ExtractedString[] = JSON.parse(readFileSync(inPath, 'utf-8'));
console.log(`  ${all.length.toLocaleString()} total strings`);

// ASCII-only for symbol-style names (utf16le is mostly UI labels).
const ascii = all.filter((s) => s.kind === 'ascii');
console.log(`  ${ascii.length.toLocaleString()} ASCII strings`);

const out: string[] = [];
function w(s: string) {
  out.push(s);
  console.log(s);
}

function bucket(label: string, pred: (s: string) => boolean, cap = 200): ExtractedString[] {
  const hits = ascii.filter((s) => pred(s.value));
  hits.sort((a, b) => a.offset - b.offset);
  w('');
  w(`## ${label} — ${hits.length} matches`);
  w('');
  for (const h of hits.slice(0, cap)) {
    w(`  0x${h.offset.toString(16).padStart(6, '0')}  ${h.value}`);
  }
  if (hits.length > cap) w(`  … (${hits.length - cap} more truncated)`);
  return hits;
}

bucket(
  '1. SYSEX_* / MIDI_* / FRACTAL_* protocol enum names',
  (v) => /^(SYSEX|MIDI|FRACTAL)_/.test(v),
  200,
);

bucket(
  '2. msg_* format-string hints',
  (v) => /^msg_/.test(v),
  100,
);

bucket(
  '3. Set*/Get*/Update*/Process* function-like names (CamelCase)',
  (v) => /^(Set|Get|Update|Process|Build|Send|Receive|Encode|Decode|Parse|Read|Write|Handle)[A-Z][a-zA-Z]+$/.test(v),
  200,
);

bucket(
  '4. *Message / *Packet / *Response / *Frame / *Envelope (CamelCase)',
  (v) => /^[A-Z][a-zA-Z]*(Message|Packet|Response|Frame|Envelope|Request|Reply|Ack|Nack)$/.test(v),
  150,
);

bucket(
  '5. Domain-named CamelCase symbols (Param/Effect/Block/Scene/Channel/Patch/Preset/Cab/Amp)',
  (v) =>
    /^[A-Z][a-zA-Z]*(Param|Effect|Block|Scene|Channel|Patch|Preset|Cab|Amp|Drive|Reverb|Delay|Chorus|Flanger|Phaser|Wah|Tone)/.test(v) &&
    v.length < 50 &&
    !/\s/.test(v),
  150,
);

bucket(
  '6. CSV / table column headers and label-ish short strings',
  (v) =>
    /^(EffectType|Param Label|ParamId|ParamID|Param Name|Type|Units|Precision|Low Limit|High Limit|Multiplier|Resolution|Strings|Bypass|Channel|Scene|Tempo|Looper|Patch|Preset|Cab|Amp|Drive|Reverb|Delay|Chorus|Flanger|Phaser|Wah|Block|Slot|Grid|Routing|Compressor|EQ|Graphic|Parametric)$/.test(v),
  100,
);

bucket(
  '7. Resource / asset paths and BinaryData symbols',
  (v) =>
    /(BinaryData|\.xml$|\.json$|\.bin$|\.png$|__amp_layout|__block_layout|__components|axe-change|fdit|fdn)/i.test(v) &&
    v.length < 60,
  150,
);

bucket(
  '8. ALL_CAPS_WITH_UNDERSCORES enum value names (excluding already-bucketed prefixes)',
  (v) =>
    /^[A-Z][A-Z0-9_]{4,}$/.test(v) &&
    !/^(SYSEX|MIDI|FRACTAL)_/.test(v) &&
    v.length < 50,
  300,
);

bucket(
  '9. JUCE / Qt class-like names (contains ::)',
  (v) => v.includes('::') && v.length < 80,
  100,
);

bucket(
  '10. Format-string hints (% format specifiers) suggesting message-builders',
  (v) => /^[a-zA-Z_]{4,40}:.*%[dscxXfp]/.test(v) && v.length < 150,
  150,
);

// Block-group-code candidates: 3-letter all-caps codes that match what
// AXE_FX_III_BLOCKS uses (AMP, CMP, REV, DLY, DRV, …). These often show
// up as standalone display strings adjacent to effect-type metadata.
const knownGroupCodes = ['AMP','CMP','REV','DLY','DRV','CAB','CHO','FLG','PHA','WAH','VOL','PTR','PIT','FIL','FUZ','ENH','MIX','SYN','VOC','MGD','XOV','GAT','RNG','MBC','TTD','RES','LPR','TMA','RTA','PLX','SND','RTN','SMI','MUX','IRP','FC','PFC','DYD','NAM','GBK','SHT','GEQ','PEQ','MTD','TUN','FRM','ROT','CTR','IN','OUT','IRC'];
const codeMatches = ascii.filter((s) => knownGroupCodes.includes(s.value));
w('');
w(`## 11. 3-letter block group codes (exact match to AXE_FX_III_BLOCKS) — ${codeMatches.length} matches`);
w('');
for (const h of codeMatches) {
  w(`  0x${h.offset.toString(16).padStart(6, '0')}  ${h.value}`);
}

if (outPath) {
  writeFileSync(outPath, out.join('\n'));
  console.log(`\nwrote ${out.length} lines to ${outPath}`);
}
