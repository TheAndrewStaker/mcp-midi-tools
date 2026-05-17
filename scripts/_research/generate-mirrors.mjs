import fs from 'node:fs';

const params = fs.readFileSync('packages/am4/src/params.ts', 'utf8');
const cache = fs.readFileSync('packages/am4/src/cacheParams.ts', 'utf8');

// Parse cacheParams.ts entries into { key, block, name, pidLow, pidHigh, body }
function parseCacheParams(text) {
  // Match each top-level entry like:
  //   'block.name': {
  //     block: 'block', name: 'name',
  //     pidLow: 0x..., pidHigh: 0x...,
  //     unit: '...', ...
  //   },
  const entries = [];
  const entryRe = /^\s+('[a-z]+\.[a-z0-9_]+'):\s*\{([\s\S]*?)\n\s+\},/gm;
  let m;
  while ((m = entryRe.exec(text))) {
    const key = m[1].slice(1, -1); // strip quotes
    const body = m[2].trim();
    const blockMatch = body.match(/block:\s*'([a-z]+)'/);
    const nameMatch = body.match(/name:\s*'([a-z0-9_]+)'/);
    const pidLowMatch = body.match(/pidLow:\s*(0x[0-9a-fA-F]+)/);
    const pidHighMatch = body.match(/pidHigh:\s*(0x[0-9a-fA-F]+)/);
    if (!blockMatch || !nameMatch || !pidLowMatch || !pidHighMatch) continue;
    entries.push({
      key,
      block: blockMatch[1],
      name: nameMatch[1],
      pidLow: parseInt(pidLowMatch[1], 16),
      pidHigh: parseInt(pidHighMatch[1], 16),
      body,
    });
  }
  return entries;
}

// Get pidHighs already in params.ts per pidLow
function pidHighsInParams(pidLow) {
  const hex = pidLow.toString(16).padStart(4, '0');
  const re = new RegExp('pidLow:\\s*0x' + hex + ',\\s*pidHigh:\\s*(0x[0-9a-fA-F]+)', 'gs');
  const s = new Set();
  let m;
  while ((m = re.exec(params))) s.add(parseInt(m[1], 16));
  return s;
}

const cacheEntries = parseCacheParams(cache);
console.log(`Parsed ${cacheEntries.length} cacheParams.ts entries`);

const TARGET_FAMILIES = new Map([
  // block name → expected pidLow
  ['chorus', 0x004e],
  ['flanger', 0x0052],
  ['phaser', 0x005a],
  ['filter', 0x0072],
  ['tremolo', 0x006a],
  ['enhancer', 0x007a],
  ['compressor', 0x002e],
]);

// Compute one-line mirror format
function fmtMirror(e) {
  // Normalize the body to a single line.
  const lines = e.body.split('\n').map(l => l.trim().replace(/,$/, '')).filter(Boolean);
  // Reassemble into one comma-separated body
  const oneLine = lines.join(', ');
  const key = `'${e.key}':`;
  return `  ${key.padEnd(34)} { ${oneLine} },`;
}

const output = { byFamily: {} };

for (const [block, pidLow] of TARGET_FAMILIES) {
  const seen = pidHighsInParams(pidLow);
  const mirrorable = cacheEntries.filter(e => e.block === block && e.pidLow === pidLow && !seen.has(e.pidHigh));
  if (mirrorable.length === 0) continue;
  output.byFamily[block] = mirrorable.map(fmtMirror);
}

// Print
for (const [block, lines] of Object.entries(output.byFamily)) {
  console.log(`\n  // ${block.toUpperCase()} mirrors (${lines.length} entries).`);
  for (const line of lines) console.log(line);
}
