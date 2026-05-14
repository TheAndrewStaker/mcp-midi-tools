/**
 * AM4 0x01 SET_PARAM value-field encoding.
 *
 * Reverse-engineered from `FUN_140156d10` (encoder) and `FUN_140156af0`
 * (decoder) in AM4-Edit.exe — see docs/_private/SESSIONS.md session 05.
 *
 * Algorithm: sliding-window 8-to-7 bit-pack. N raw bytes become N+1 wire
 * septets. Each iteration k=1..N takes the top (8-k) bits of the input
 * byte for the current wire position (OR'd with the carry from the
 * previous iteration), and saves the bottom k bits as carry for the next.
 * All wire bytes have bit 7 = 0, satisfying the SysEx wire constraint.
 *
 * Verified round-trip on all 10 captured (param, value) samples — see
 * scripts/verify-pack.ts.
 */

export function packValue(raw: Uint8Array): Uint8Array {
  const out = new Uint8Array(raw.length + 1);
  let carry = 0;
  for (let i = 0; i < raw.length; i++) {
    const k = i + 1;
    const b = raw[i];
    out[i] = (((b >> k) & 0x7f) | carry) & 0x7f;
    carry = ((~(0x7f << k) & b) << (7 - k)) & 0x7f;
  }
  out[raw.length] = carry;
  return out;
}

export function unpackValue(wire: Uint8Array, rawLen: number): Uint8Array {
  const out = new Uint8Array(rawLen);
  for (let i = 0; i < wire.length; i++) {
    const k = i + 1;
    const b = wire[i] & 0x7f;
    if (i > 0 && i - 1 < rawLen) {
      out[i - 1] |= ((~(0x7f >> k) & b) >> (8 - k)) & 0xff;
    }
    if (i < rawLen) out[i] = (b << k) & 0xff;
  }
  return out;
}

/** Pack a 32-bit IEEE 754 float (little-endian) into 5 wire septets. */
export function packFloat32LE(value: number): Uint8Array {
  const buf = new ArrayBuffer(4);
  new DataView(buf).setFloat32(0, value, true);
  return packValue(new Uint8Array(buf));
}

/**
 * Chunked variant of `packValue` for payloads > 7 raw bytes. The sliding
 * window in `packValue` restarts every 7 raw bytes — i.e. 7 raw → 8 packed,
 * repeated. A trailing partial chunk of N<7 bytes produces N+1 packed
 * bytes the same way a full standalone `packValue` call would.
 *
 * For ≤ 7 raw bytes this is identical to `packValue`, so small payloads
 * (the 4-byte float used by SET_PARAM, the 4-byte slot uint used by
 * SAVE_TO_SLOT) are unaffected. Needed for 36-byte preset-name payloads
 * decoded Session 19; confirmed byte-exact against the captured rename.
 */
export function packValueChunked(raw: Uint8Array): Uint8Array {
  const CHUNK = 7;
  // Full 7-byte chunks → 8 packed bytes each; trailing partial chunk of
  // length R → R+1 packed bytes.
  const fullChunks = Math.floor(raw.length / CHUNK);
  const remainder = raw.length % CHUNK;
  const outLen = fullChunks * 8 + (remainder > 0 ? remainder + 1 : 0);
  const out = new Uint8Array(outLen);
  let outPos = 0;
  for (let offset = 0; offset < raw.length; offset += CHUNK) {
    const end = Math.min(offset + CHUNK, raw.length);
    const chunkPacked = packValue(raw.subarray(offset, end));
    out.set(chunkPacked, outPos);
    outPos += chunkPacked.length;
  }
  return out;
}

/**
 * Inverse of `packValueChunked`: decode a chunked-packed wire buffer
 * back into raw bytes. `rawLen` is the known total raw byte count
 * (typically carried in hdr4 of the command the wire payload came from).
 */
export function unpackValueChunked(wire: Uint8Array, rawLen: number): Uint8Array {
  const CHUNK_RAW = 7;
  const CHUNK_WIRE = 8;
  const out = new Uint8Array(rawLen);
  let rawPos = 0;
  let wirePos = 0;
  while (rawPos < rawLen) {
    const remainingRaw = rawLen - rawPos;
    const thisChunkRaw = Math.min(CHUNK_RAW, remainingRaw);
    const thisChunkWire = thisChunkRaw === CHUNK_RAW ? CHUNK_WIRE : thisChunkRaw + 1;
    const chunk = wire.subarray(wirePos, wirePos + thisChunkWire);
    const unpacked = unpackValue(chunk, thisChunkRaw);
    out.set(unpacked, rawPos);
    rawPos += thisChunkRaw;
    wirePos += thisChunkWire;
  }
  return out;
}

/** Inverse of packFloat32LE — decode 5 wire septets back to a float. */
export function unpackFloat32LE(wire: Uint8Array): number {
  if (wire.length !== 5) {
    throw new Error(`unpackFloat32LE: expected 5 wire bytes, got ${wire.length}`);
  }
  const raw = unpackValue(wire, 4);
  return new DataView(raw.buffer, raw.byteOffset, 4).getFloat32(0, true);
}
