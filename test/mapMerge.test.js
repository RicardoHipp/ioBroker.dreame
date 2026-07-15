// Lokaler Test der Typ-Grid-Merge-Logik
const zlib = require('zlib');
const { MapMerger, readHeader, HEADER_SIZE } = require('../lib/mapMerge');

// rohen Frame bauen (Header + Pixel + Meta) -> base64/zlib
function buildFrame({ mapId = 1, frameType, gridSize, width, height, originX, originY, pixels, meta }) {
  const hdr = Buffer.alloc(HEADER_SIZE, 0);
  hdr.writeInt16LE(mapId, 0);
  hdr.writeInt16LE(0, 2);
  hdr.writeUInt8(frameType, 4);
  hdr.writeInt16LE(gridSize, 17);
  hdr.writeInt16LE(width, 19);
  hdr.writeInt16LE(height, 21);
  hdr.writeInt16LE(originX, 23);
  hdr.writeInt16LE(originY, 25);
  const metaBuf = Buffer.from(JSON.stringify(meta || {}), 'utf8');
  return Buffer.from(zlib.deflateSync(Buffer.concat([hdr, Buffer.from(pixels), metaBuf]))).toString('base64');
}
function decodeFrame(b64) {
  const raw = Buffer.from(zlib.inflateSync(Buffer.from(b64, 'base64')));
  const h = readHeader(raw);
  const pix = raw.slice(HEADER_SIZE, HEADER_SIZE + h.width * h.height);
  const meta = JSON.parse(raw.toString('utf8', HEADER_SIZE + h.width * h.height) || '{}');
  return { h, pix, meta };
}
const R = (id) => id << 2; // P-Frame-Format: Raum-ID -> Byte (×4)

let ok = 0, fail = 0;
const assert = (c, m) => { if (c) { ok++; } else { fail++; console.log('  ✗ FAIL:', m); } };

const merger = new MapMerger();

// --- 1) I-Frame (&0x3f-Format): Räume 1/2 + eine Wand (Byte 0x80|1 = 129) ---
const iPix = Buffer.from([
  1, 1, 0, 0,
  1, 1, 0, 0,
  0, 0, 2, 2,
  129, 0, 2, 2, // (0,3) = Wand
]);
const iFrame = buildFrame({ frameType: 73, gridSize: 50, width: 4, height: 4, originX: 0, originY: 0, pixels: iPix, meta: { seg_inf: { 1: {} }, walls_info: { x: 1 } } });
let out = merger.process(iFrame);
assert(!!out, 'I-Frame liefert Ergebnis');
let d = decodeFrame(out);
assert(d.h.frameType === 73, 'Ausgabe ist Typ 73');
assert(d.pix[0] === 1 && d.pix[5] === 1, 'Raum 1 als Typ 1');
assert(d.pix[10] === 2, 'Raum 2 als Typ 2');
assert(d.pix[12] === 63, 'Wand-Bit (129) -> Typ 63');

// --- 2) P-Frame (>>2-Format): setzt (0,0) auf Raum 3 = Byte 12, plus Boden(62)=248 ---
const pPix = Buffer.from([
  R(3), 0, 0, 0,
  0, 62 << 2, 0, 0, // (1,1) = Boden (Typ 62)
  0, 0, 0, 0,
  0, 0, 0, 0,
]);
const pFrame = buildFrame({ frameType: 80, gridSize: 50, width: 4, height: 4, originX: 0, originY: 0, pixels: pPix, meta: { robot: [10, 20] } });
out = merger.process(pFrame);
d = decodeFrame(out);
assert(d.h.width === 4 && d.h.height === 4, 'Dims unverändert');
assert(d.pix[0] === 3, 'P-Frame (Byte 12) -> Typ 3 (Raum 3)');
assert(d.pix[5] === 62, 'P-Frame Boden -> Typ 62');
assert(d.pix[1] === 1 && d.pix[10] === 2, 'alte Räume erhalten');
assert(d.pix[12] === 63, 'Wand aus Basis erhalten');
assert(d.meta.walls_info && d.meta.walls_info.x === 1, 'walls_info aus I-Frame behalten');
assert(Array.isArray(d.meta.robot), 'robot aus P-Frame übernommen');

// --- 3) P-Frame erweitert Karte nach rechts (Raum 5 = Byte 20) ---
const m2 = new MapMerger();
m2.process(iFrame);
const pRight = Buffer.from([ R(5), R(5), R(5), R(5), R(5), R(5), R(5), R(5) ]);
const pFrame2 = buildFrame({ frameType: 80, gridSize: 50, width: 2, height: 4, originX: 200, originY: 0, pixels: pRight, meta: {} });
d = decodeFrame(m2.process(pFrame2));
assert(d.h.width === 6, `Karte auf 6 verbreitert (war ${d.h.width})`);
assert(d.pix[0] === 1, 'alte Karte links erhalten');
assert(d.pix[4] === 5 && d.pix[5] === 5, 'neue Region rechts (Raum 5)');

console.log(`\nErgebnis: ${ok} OK, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
