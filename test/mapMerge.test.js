// Lokaler Test der Merge-Logik: I-Frame-Durchlauf + synthetischer P-Frame
const zlib = require('zlib');
const { MapMerger, readHeader, HEADER_SIZE } = require('../lib/mapMerge');

// --- kleine Helfer: rohen Frame bauen (Header + Pixel + Meta) -> base64/zlib ---
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
  const raw = Buffer.concat([hdr, Buffer.from(pixels), metaBuf]);
  return Buffer.from(zlib.deflateSync(raw)).toString('base64');
}
function decodeFrame(b64) {
  const raw = Buffer.from(zlib.inflateSync(Buffer.from(b64, 'base64')));
  const h = readHeader(raw);
  const pix = raw.slice(HEADER_SIZE, HEADER_SIZE + h.width * h.height);
  const meta = JSON.parse(raw.toString('utf8', HEADER_SIZE + h.width * h.height) || '{}');
  return { h, pix, meta };
}

let ok = 0, fail = 0;
const assert = (c, m) => { if (c) { ok++; } else { fail++; console.log('  ✗ FAIL:', m); } };

const merger = new MapMerger({ additive: false });

// --- 1) I-Frame: 4x4 Gitter, gridSize 50, origin (0,0), 2 Räume ---
const iPix = Buffer.from([
  1, 1, 0, 0,
  1, 1, 0, 0,
  0, 0, 2, 2,
  0, 0, 2, 2,
]);
const iFrame = buildFrame({ frameType: 73, gridSize: 50, width: 4, height: 4, originX: 0, originY: 0, pixels: iPix, meta: { seg_inf: { 1: {} }, walls_info: { x: 1 } } });
let out = merger.process(iFrame);
assert(out === iFrame, 'I-Frame wird unverändert zurückgegeben');
assert(merger.maps[1] && merger.maps[1].dims.width === 4, 'I-Frame gespeichert (4x4)');

// --- 2) P-Frame: gleiche Region, ändert Pixel (0,0)-Bereich zu Raum 3 ---
const pPix = Buffer.from([
  3, 0, 0, 0,
  0, 0, 0, 0,
  0, 0, 0, 0,
  0, 0, 0, 0,
]);
const pFrame = buildFrame({ frameType: 80, gridSize: 50, width: 4, height: 4, originX: 0, originY: 0, pixels: pPix, meta: { robot: [10, 20] } });
out = merger.process(pFrame);
assert(out && out !== pFrame, 'P-Frame liefert gemergten synthetischen Frame');
let d = decodeFrame(out);
assert(d.h.frameType === 73, 'Ergebnis ist synthetischer I-Frame (type 73)');
assert(d.h.width === 4 && d.h.height === 4, 'Dims unverändert (gleiche Region)');
assert(d.pix[0] === 3, 'Pixel (0,0) durch P-Frame auf 3 gesetzt');
assert(d.pix[1] === 1 && d.pix[5] === 1, 'übrige alte Pixel erhalten (Raum 1)');
assert(d.pix[10] === 2, 'Raum 2 erhalten');
assert(d.meta.walls_info && d.meta.walls_info.x === 1, 'walls_info aus I-Frame behalten');
assert(Array.isArray(d.meta.robot), 'robot aus P-Frame übernommen');

// --- 3) P-Frame ERWEITERT die Karte nach rechts (origin verschoben) ---
const merger2 = new MapMerger({ additive: false });
merger2.process(iFrame); // Basis 4x4 origin (0,0)
// P-Frame: 2x4 Region rechts daneben, origin x=200 (=4 Zellen * 50)
const pRight = Buffer.from([ 5, 5, 5, 5, 5, 5, 5, 5 ]); // 2 breit x 4 hoch
const pFrame2 = buildFrame({ frameType: 80, gridSize: 50, width: 2, height: 4, originX: 200, originY: 0, pixels: pRight, meta: {} });
out = merger2.process(pFrame2);
d = decodeFrame(out);
assert(d.h.width === 6, `Karte auf 6 verbreitert (war ${d.h.width})`);
assert(d.h.height === 4, 'Höhe bleibt 4');
assert(d.pix[0] === 1, 'alte Karte links erhalten');
assert(d.pix[4] === 5 && d.pix[5] === 5, 'neue Region rechts eingefügt (Raum 5)');

console.log(`\nErgebnis: ${ok} OK, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
