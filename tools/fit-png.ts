// Re-encodes a PNG's pixel data at the zlib level that lands the file nearest a target size window,
// without touching a pixel: the rules ask for screenshots of 300 to 350 KB each.
//
//   node tools/fit-png.ts <file.png> [min bytes] [max bytes]

import { readFileSync, writeFileSync } from 'node:fs';
import { constants, crc32, deflateSync, inflateSync } from 'node:zlib';

const [file, minArg, maxArg] = process.argv.slice(2);
if (!file) {
  process.stderr.write('usage: node tools/fit-png.ts <file.png> [min bytes] [max bytes]\n');
  process.exit(2);
}
const min = Number(minArg ?? 300_000);
const max = Number(maxArg ?? 350_000);

const png = readFileSync(file);
const SIGNATURE = png.subarray(0, 8);

/** The PNG's chunks in order: type and data. */
function chunks(bytes: Buffer): { type: string; data: Buffer }[] {
  const out: { type: string; data: Buffer }[] = [];
  for (let at = 8; at < bytes.length; ) {
    const length = bytes.readUInt32BE(at);
    out.push({ type: bytes.toString('latin1', at + 4, at + 8), data: bytes.subarray(at + 8, at + 8 + length) });
    at += 12 + length;
  }
  return out;
}

function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0);
  return Buffer.concat([head, data, tail]);
}

const all = chunks(png);
const pixels = inflateSync(Buffer.concat(all.filter((c) => c.type === 'IDAT').map((c) => c.data)));

/** The whole file with its pixel data deflated at `level` with `strategy`, other chunks kept as they were. */
function encode(level: number, strategy: number, memLevel: number): Buffer {
  const parts: Buffer[] = [SIGNATURE];
  let written = false;
  for (const c of all) {
    if (c.type !== 'IDAT') parts.push(chunk(c.type, c.data));
    else if (!written) {
      parts.push(chunk('IDAT', deflateSync(pixels, { level, strategy, memLevel })));
      written = true;
    }
  }
  return Buffer.concat(parts);
}

// Try every level under each zlib strategy; keep the encoding nearest the middle of the window that
// stays under the max. The order is fixed, so the same input always gives the same file.
const STRATEGIES: [string, number][] = [
  ['default', constants.Z_DEFAULT_STRATEGY],
  ['filtered', constants.Z_FILTERED],
  ['rle', constants.Z_RLE],
  ['huffman', constants.Z_HUFFMAN_ONLY],
];
const middle = (min + max) / 2;
let best: { how: string; bytes: Buffer } | null = null;
for (const [name, strategy] of STRATEGIES) {
  for (const memLevel of [8, 4, 1]) {
    for (let level = 9; level >= 1; level--) {
      const bytes = encode(level, strategy, memLevel);
      if (bytes.length > max) continue;
      if (best === null || Math.abs(bytes.length - middle) < Math.abs(best.bytes.length - middle)) best = { how: `${name} level ${level} memLevel ${memLevel}`, bytes };
    }
  }
}
if (best === null) {
  process.stderr.write(`${file}: no zlib setting brings it under ${max} bytes\n`);
  process.exit(1);
}
writeFileSync(file, best.bytes);
process.stdout.write(`${file}: ${png.length} -> ${best.bytes.length} bytes with zlib ${best.how}${best.bytes.length < min ? ` (still under ${min})` : ''}\n`);
