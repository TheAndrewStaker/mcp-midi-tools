/**
 * Parse the PE header of AM4-Edit.exe to find the .rsrc section's
 * file offset, dump it, and look for label strings inside.
 *
 * .rsrc is 123 KB per Ghidra. Even though Win32 resource APIs aren't
 * imported, AM4-Edit might read it via direct memory after the PE
 * loader maps the section.
 */

import { readFileSync, writeFileSync } from 'node:fs';

const exePath = 'C:\\Program Files\\Fractal Audio\\AM4-Edit\\AM4-Edit.exe';
const buf = readFileSync(exePath);
console.log(`exe: ${exePath}`);
console.log(`size: ${buf.length.toLocaleString()} bytes\n`);

// Parse PE header.
// 1. DOS header at offset 0; e_lfanew at 0x3c points to PE header.
const peOff = buf.readUInt32LE(0x3c);
console.log(`e_lfanew (PE offset): 0x${peOff.toString(16)}`);
const peSig = buf.readUInt32LE(peOff);
console.log(`PE signature: 0x${peSig.toString(16)} (expected 0x00004550 "PE\\0\\0")`);

// 2. COFF File Header at peOff+4; size 20 bytes.
const machine = buf.readUInt16LE(peOff + 4);
const numSections = buf.readUInt16LE(peOff + 6);
const sizeOfOptionalHeader = buf.readUInt16LE(peOff + 20);
console.log(`machine: 0x${machine.toString(16)} (0x8664 = AMD64)`);
console.log(`numSections: ${numSections}`);
console.log(`sizeOfOptionalHeader: ${sizeOfOptionalHeader}`);

// 3. Optional Header starts at peOff + 24. Section Table follows it.
const sectionTableOff = peOff + 24 + sizeOfOptionalHeader;
console.log(`sectionTableOff: 0x${sectionTableOff.toString(16)}`);

// 4. Each Section header is 40 bytes:
//    +0  char[8] Name
//    +8  u32     VirtualSize
//    +12 u32     VirtualAddress (RVA)
//    +16 u32     SizeOfRawData
//    +20 u32     PointerToRawData (file offset)
//    +24 u32     PointerToRelocations
//    +28 u32     PointerToLinenumbers
//    +32 u16     NumberOfRelocations
//    +34 u16     NumberOfLinenumbers
//    +36 u32     Characteristics

interface Section {
  name: string;
  virtualSize: number;
  virtualAddress: number;
  rawSize: number;
  rawOffset: number;
}

const sections: Section[] = [];
for (let i = 0; i < numSections; i++) {
  const off = sectionTableOff + i * 40;
  const name = buf.subarray(off, off + 8).toString('latin1').replace(/\0/g, '');
  const section: Section = {
    name,
    virtualSize: buf.readUInt32LE(off + 8),
    virtualAddress: buf.readUInt32LE(off + 12),
    rawSize: buf.readUInt32LE(off + 16),
    rawOffset: buf.readUInt32LE(off + 20),
  };
  sections.push(section);
}

console.log('\n=== sections ===');
console.log('name'.padEnd(10) + 'virtAddr'.padEnd(14) + 'virtSize'.padEnd(12) + 'rawOff'.padEnd(12) + 'rawSize');
for (const s of sections) {
  console.log(
    s.name.padEnd(10) +
    ('0x' + s.virtualAddress.toString(16)).padEnd(14) +
    s.virtualSize.toString().padEnd(12) +
    ('0x' + s.rawOffset.toString(16)).padEnd(12) +
    s.rawSize.toString(),
  );
}

const rsrc = sections.find(s => s.name === '.rsrc');
if (!rsrc) {
  console.error('no .rsrc section found!');
  process.exit(1);
}
console.log(`\n.rsrc file slice: 0x${rsrc.rawOffset.toString(16)} .. 0x${(rsrc.rawOffset + rsrc.rawSize).toString(16)}`);

// Extract and write .rsrc bytes
const rsrcBytes = buf.subarray(rsrc.rawOffset, rsrc.rawOffset + rsrc.rawSize);
const outPath = 'samples/captured/decoded/exe-rsrc.bin';
writeFileSync(outPath, rsrcBytes);
console.log(`wrote ${outPath} (${rsrcBytes.length} bytes)`);

// Search .rsrc for known labels in plain ASCII / UTF-16LE / UTF-16BE
const probes = [
  'Bright Cap', 'High Treble', 'Master Vol Trim',
  'Saturation Drive', 'Negative Feedback', 'Variac',
  'Spring Tone', 'Slew Rate', 'Bass Focus',
  'Knee Type', 'Sidechain Source', 'Auto Makeup',
  // Just check we can at least find ANY known label in any encoding
  'Treble', 'Presence', 'Depth', 'Bass',
];

console.log('\n=== probe .rsrc for labels ===');
for (const p of probes) {
  const a = rsrcBytes.indexOf(Buffer.from(p, 'ascii'));
  const u = rsrcBytes.indexOf(Buffer.from(p, 'utf16le'));
  // UTF-16BE
  const beB = Buffer.alloc(p.length * 2);
  for (let i = 0; i < p.length; i++) { beB[i * 2] = 0; beB[i * 2 + 1] = p.charCodeAt(i); }
  const be = rsrcBytes.indexOf(beB);
  console.log(p.padEnd(20), 'ascii:', a, ' utf16le:', u, ' utf16be:', be);
}

// Also extract every printable run of ≥3 ASCII chars from .rsrc and print
// the longest 30
console.log('\n=== longest ASCII runs in .rsrc ===');
interface Run { off: number; text: string; }
const runs: Run[] = [];
let runStart = -1;
for (let i = 0; i < rsrcBytes.length; i++) {
  const b = rsrcBytes[i];
  if (b >= 0x20 && b <= 0x7e) {
    if (runStart < 0) runStart = i;
  } else {
    if (runStart >= 0) {
      const len = i - runStart;
      if (len >= 4) {
        runs.push({ off: runStart, text: rsrcBytes.subarray(runStart, i).toString('ascii') });
      }
      runStart = -1;
    }
  }
}
runs.sort((a, b) => b.text.length - a.text.length);
for (let i = 0; i < Math.min(30, runs.length); i++) {
  const r = runs[i];
  console.log(`  +${r.off.toString(16).padStart(5,'0')}  len=${r.text.length}  "${r.text.slice(0, 100)}"`);
}
