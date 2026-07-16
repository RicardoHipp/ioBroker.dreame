// Test der HA-portierten Merge-/Decode-Logik (frame_map-Zweig: Pixel >> 2)
const zlib = require('zlib');
const { MapMerger, readHeader, HEADER_SIZE, MapPixelType } = require('../lib/mapMerge');
const { getPixelType } = require('../lib/haMap');

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
// frame_map-Kodierung: Wert steckt in den oberen Bits (Byte = wert << 2)
const R = (id) => id << 2;        // Raum-ID
const WALLB = 63 << 2;            // -> MapPixelType.WALL
const FLOORB = 62 << 2;           // -> MapPixelType.FLOOR
const UNKB = 61 << 2;             // -> MapPixelType.UNKNOWN

let ok = 0, fail = 0;
const assert = (c, m) => { if (c) { ok++; } else { fail++; console.log('  ✗ FAIL:', m); } };

// --- 0) Parser (HA _get_pixel_type, frame_map-Zweig) ---
const ctx = { version: 1, frame_map: true, saved_map_status: 2 };
assert(getPixelType(ctx, WALLB)[0] === MapPixelType.WALL, 'Parser: 63<<2 -> WALL');
assert(getPixelType(ctx, FLOORB)[0] === MapPixelType.FLOOR, 'Parser: 62<<2 -> FLOOR');
assert(getPixelType(ctx, UNKB)[0] === MapPixelType.UNKNOWN, 'Parser: 61<<2 -> UNKNOWN');
assert(getPixelType(ctx, R(5))[0] === 5, 'Parser: Raum 5');
assert(getPixelType(ctx, 0)[0] === MapPixelType.OUTSIDE, 'Parser: 0 -> OUTSIDE');

const merger = new MapMerger();

// --- 1) I-Frame: Räume 1/2 + Wand ---
const iPix = Buffer.from([
  R(1), R(1), 0, 0,
  R(1), R(1), 0, 0,
  0, 0, R(2), R(2),
  WALLB, 0, R(2), R(2), // (0,3) = Wand
]);
const iFrame = buildFrame({ frameType: 73, gridSize: 50, width: 4, height: 4, originX: 0, originY: 0, pixels: iPix, meta: { ris: 2, seg_inf: { 1: {} }, walls_info: { x: 1 } } });
let out = merger.process(iFrame);
assert(!!out, 'I-Frame liefert Ergebnis');
let d = decodeFrame(out);
assert(d.h.frameType === 73, 'Ausgabe ist Typ 73');
assert(d.pix[0] === 1 && d.pix[5] === 1, 'Raum 1 korrekt dekodiert');
assert(d.pix[10] === 2, 'Raum 2 korrekt dekodiert');
assert(d.pix[12] === MapPixelType.WALL, 'Wand -> MapPixelType.WALL (255)');

// --- 2) P-Frame überlagert: Raum 3, Boden, Wand ---
const pPix = Buffer.from([
  R(3), 0, WALLB, 0,  // (0,0) Raum 3 über Raum 1, (2,0) Wand
  0, FLOORB, 0, 0,    // (1,1) Boden
  0, 0, 0, 0,
  0, 0, 0, 0,
]);
const pFrame = buildFrame({ frameType: 80, gridSize: 50, width: 4, height: 4, originX: 0, originY: 0, pixels: pPix, meta: { ris: 2, robot: [10, 20] } });
d = decodeFrame(merger.process(pFrame));
assert(d.h.width === 4 && d.h.height === 4, 'Dims unverändert');
assert(d.pix[0] === 3, 'P-Frame Raum 3 übernommen (wie HA: einfaches Überlagern)');
assert(d.pix[2] === MapPixelType.WALL, 'P-Frame Wand übernommen');
assert(d.pix[5] === MapPixelType.FLOOR, 'P-Frame Boden übernommen');
assert(d.pix[1] === 1 && d.pix[10] === 2, 'nicht berührte Zellen erhalten');
assert(d.pix[12] === MapPixelType.WALL, 'Wand aus Basis erhalten');
assert(d.meta.walls_info && d.meta.walls_info.x === 1, 'walls_info aus I-Frame behalten');
assert(Array.isArray(d.meta.robot), 'robot aus P-Frame übernommen');

// --- 3) P-Frame erweitert die Karte nach rechts ---
const m2 = new MapMerger();
m2.process(iFrame);
const pRight = Buffer.from([R(5), R(5), R(5), R(5), R(5), R(5), R(5), R(5)]);
const pFrame2 = buildFrame({ frameType: 80, gridSize: 50, width: 2, height: 4, originX: 200, originY: 0, pixels: pRight, meta: { ris: 2 } });
d = decodeFrame(m2.process(pFrame2));
assert(d.h.width === 6, `Karte auf 6 verbreitert (war ${d.h.width})`);
assert(d.pix[0] === 1, 'alte Karte links erhalten');
assert(d.pix[4] === 5 && d.pix[5] === 5, 'neue Region rechts (Raum 5)');

// --- 4) Fahrspur (tr) wird aufgesammelt und als trpts ausgegeben ---
const m3 = new MapMerger();
m3.process(buildFrame({ frameType: 73, gridSize: 50, width: 4, height: 4, originX: 0, originY: 0, pixels: iPix, meta: { ris: 2, tr: 'S100,200L10,0' } }));
let d3 = decodeFrame(m3._buildFrame());
assert(d3.meta.trpts && d3.meta.trpts.length === 2, 'I-Frame tr -> 2 Punkte');
assert(d3.meta.trpts[0][0] === 100 && d3.meta.trpts[1][0] === 110, 'tr: L ist relativ (100 -> 110)');
assert(d3.meta.tr === undefined, 'rohes tr aus Meta entfernt');

console.log(`\nErgebnis: ${ok} OK, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
