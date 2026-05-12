/**
 * Brute-force scan: try zlib inflate at every offset of AM4-Edit.exe
 * that starts with a zlib magic byte pair. For each successful inflate,
 * check if the output contains "<Editor" or "<?xml". If yes, we've
 * found the XML source blob.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

const exePath = 'C:\\Program Files\\Fractal Audio\\AM4-Edit\\AM4-Edit.exe';
const buf = readFileSync(exePath);

// All zlib stream header byte pairs we'd see for any compression level.
const HEADER_PAIRS: Array<[number, number]> = [
  [0x78, 0x01], [0x78, 0x5e], [0x78, 0x9c], [0x78, 0xda],
  // Less standard but valid
  [0x78, 0x20], [0x78, 0x7d], [0x78, 0xbb],
  // raw deflate stream — no header (would need to use inflateRaw)
];

interface XmlHit {
  offset: number;
  inflatedLen: number;
  preview: string;
  marker: string;
}

const found: XmlHit[] = [];

for (const [b0, b1] of HEADER_PAIRS) {
  let pos = 0;
  while (pos < buf.length - 2) {
    const i = buf.indexOf(b0, pos);
    if (i < 0) break;
    if (buf[i + 1] === b1) {
      // Try to inflate at this offset
      try {
        const slice = buf.subarray(i, Math.min(i + 1_000_000, buf.length));
        const out = inflateSync(slice);
        // Check if output contains markers we care about
        const text = out.toString('latin1');
        const idx1 = text.indexOf('<Editor');
        const idx2 = text.indexOf('<?xml');
        const idx3 = text.indexOf('<Block ');
        const idx4 = text.indexOf('parameterName=');
        if (idx1 >= 0 || idx2 >= 0 || idx3 >= 0 || idx4 >= 0) {
          const m =
            idx1 >= 0 ? '<Editor' :
            idx2 >= 0 ? '<?xml' :
            idx3 >= 0 ? '<Block' :
            'parameterName=';
          const startMarker = idx1 >= 0 ? idx1 : idx2 >= 0 ? idx2 : idx3 >= 0 ? idx3 : idx4;
          found.push({
            offset: i,
            inflatedLen: out.length,
            preview: text.slice(Math.max(0, startMarker - 32), Math.min(text.length, startMarker + 200)),
            marker: m,
          });
        }
      } catch {
        // not a valid zlib stream — skip
      }
    }
    pos = i + 1;
  }
}

console.log(`scanned for XML-bearing zlib streams in AM4-Edit.exe`);
console.log(`successful XML hits: ${found.length}\n`);

found.sort((a, b) => b.inflatedLen - a.inflatedLen);
for (let i = 0; i < Math.min(found.length, 10); i++) {
  const f = found[i];
  console.log(`#${i}  exe-offset=0x${f.offset.toString(16)}  inflated=${f.inflatedLen}  marker=${f.marker}`);
  console.log(`     preview: ${f.preview.replace(/[^\x20-\x7e]/g, '.').slice(0, 200)}`);
  console.log();
}

// Save largest found blob as decompressed text
if (found.length > 0) {
  const winner = found[0];
  const slice = buf.subarray(winner.offset, Math.min(winner.offset + 5_000_000, buf.length));
  const inflated = inflateSync(slice);
  const out = 'samples/captured/decoded/exe-xml-blob.xml';
  writeFileSync(out, inflated);
  console.log(`wrote ${out} (${inflated.length} bytes)`);
}
