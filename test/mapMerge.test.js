// Test der HA-portierten Merge-/Decode-Logik.
// WICHTIG (wie HA decode_p_map_data_from_partial): P-Frame-Bytes sind bei version!=3
// DELTAS auf den Roh-Puffer ("P map only returns difference"); frame_map wird beim
// I-Frame ueber meta.fsm==1 erkannt, bei P-Frames ist es immer true.
const zlib = require('zlib');
const { MapMerger, readHeader, HEADER_SIZE, MapPixelType } = require('../lib/mapMerge');
const { getPixelType, setSegmentColorIndex } = require('../lib/haMap');

// rohen Frame bauen (Header + Pixel + Meta) -> base64/zlib
function buildFrame({ mapId = 1, frameId = 0, frameType, gridSize, width, height, originX, originY, pixels, meta }) {
  const hdr = Buffer.alloc(HEADER_SIZE, 0);
  hdr.writeInt16LE(mapId, 0);
  hdr.writeInt16LE(frameId, 2);
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
const R = (id) => id << 2;        // Raum-ID (Rohbyte)
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
assert(getPixelType(ctx, R(5) | 0x03)[1] === true, 'Parser: carpet-Flag (bits 0-1 == 3)');
// version-1/2-Zweig (kein frame_map): bit7 = Wand
const ctxV1 = { version: 1, frame_map: false, saved_map_status: 2 };
assert(getPixelType(ctxV1, 0x80)[0] === MapPixelType.WALL, 'Parser v1/2: bit7 ohne seg -> WALL');
assert(getPixelType(ctxV1, 5)[0] === 5, 'Parser v1/2: seg 5 (ris=2)');
// version-3-Zweig
const ctxV3 = { version: 3, frame_map: false, saved_map_status: 2 };
assert(getPixelType(ctxV3, 31 | (1 << 5))[0] === MapPixelType.WALL, 'Parser v3: seg31+wall -> WALL');
assert(getPixelType(ctxV3, 7)[0] === 7, 'Parser v3: seg 7');

// --- 0b) Farb-Index-Algorithmus (set_segment_color_index) ---
const ci = setSegmentColorIndex({ 1: { nei_id: [3, 7] }, 2: { nei_id: [3, 6] }, 3: { nei_id: [1, 2, 4, 6] }, 4: { nei_id: [3] }, 5: { nei_id: [6] }, 6: { nei_id: [2, 3, 5] }, 7: { nei_id: [1] } });
assert(ci[2] !== ci[3] && ci[2] !== ci[6], 'Farben: Flur(2) kollidiert nicht mit Nachbarn 3/6');
assert(ci[3] !== ci[4] && ci[3] !== ci[6] && ci[3] !== ci[1], 'Farben: 3 kollidiert mit keinem Nachbarn');
assert(Object.values(ci).every((v) => v >= 0 && v <= 3), 'Farben: nur Indizes 0-3');

// --- 1) I-Frame (fsm=1 -> frame_map): Räume 1/2 + Wand ---
const merger = new MapMerger();
const iPix = Buffer.from([
  R(1), R(1), 0, 0,
  R(1), R(1), 0, 0,
  0, 0, R(2), R(2),
  WALLB, 0, R(2), R(2), // (0,3) = Wand
]);
const iFrame = buildFrame({ frameId: 1, frameType: 73, gridSize: 50, width: 4, height: 4, originX: 0, originY: 0, pixels: iPix, meta: { fsm: 1, ris: 2, seg_inf: { 1: {} }, walls_info: { x: 1 } } });
let out = merger.process(iFrame);
assert(!!out, 'I-Frame liefert Ergebnis');
let d = decodeFrame(out);
assert(d.h.frameType === 73, 'Ausgabe ist Typ 73');
assert(d.pix[0] === 1 && d.pix[5] === 1, 'Raum 1 korrekt dekodiert');
assert(d.pix[10] === 2, 'Raum 2 korrekt dekodiert');
assert(d.pix[12] === MapPixelType.WALL, 'Wand -> MapPixelType.WALL (255)');

// --- 2) P-Frame = DELTAS: (0,0) Raum1->Raum3 (delta 8), (2,0) leer->Wand (delta 252),
//     (1,1) Raum1->Boden (delta 244) ---
const pPix = Buffer.from([
  R(3) - R(1), 0, WALLB, 0,
  0, FLOORB - R(1), 0, 0,
  0, 0, 0, 0,
  0, 0, 0, 0,
]);
const pFrame = buildFrame({ frameId: 2, frameType: 80, gridSize: 50, width: 4, height: 4, originX: 0, originY: 0, pixels: pPix, meta: { ris: 2, robot: [10, 20] } });
d = decodeFrame(merger.process(pFrame));
assert(d.h.width === 4 && d.h.height === 4, 'Dims unverändert');
assert(d.pix[0] === 3, 'Delta auf Rohwert: Raum 1 + 8 -> Raum 3');
assert(d.pix[2] === MapPixelType.WALL, 'Delta auf leer: 0 + 252 -> WALL');
assert(d.pix[5] === MapPixelType.FLOOR, 'Delta: Raum 1 + 244 -> FLOOR');
assert(d.pix[1] === 1 && d.pix[10] === 2, 'nicht berührte Zellen erhalten');
assert(d.pix[12] === MapPixelType.WALL, 'Wand aus Basis erhalten');
assert(d.meta.walls_info && d.meta.walls_info.x === 1, 'walls_info aus I-Frame behalten');
assert(Array.isArray(d.meta.robot), 'robot aus P-Frame übernommen');

// --- 3) P-Frame erweitert die Karte nach rechts (Neuland: alter Rohwert 0 + Delta) ---
const m2 = new MapMerger();
m2.process(iFrame);
const pRight = Buffer.from([R(5), R(5), R(5), R(5), R(5), R(5), R(5), R(5)]);
const pFrame2 = buildFrame({ frameId: 2, frameType: 80, gridSize: 50, width: 2, height: 4, originX: 200, originY: 0, pixels: pRight, meta: { ris: 2 } });
d = decodeFrame(m2.process(pFrame2));
assert(d.h.width === 6, `Karte auf 6 verbreitert (war ${d.h.width})`);
assert(d.pix[0] === 1, 'alte Karte links erhalten');
assert(d.pix[4] === 5 && d.pix[5] === 5, 'Neuland: 0 + R(5) -> Raum 5');

// --- 4) Zwei P-Frames nacheinander: Deltas akkumulieren auf dem Roh-Puffer ---
const m3 = new MapMerger();
m3.process(iFrame);
// Frame A: (0,0) Raum1 -> Raum2 (delta 4)
m3.process(buildFrame({ frameId: 2, frameType: 80, gridSize: 50, width: 1, height: 1, originX: 0, originY: 0, pixels: Buffer.from([R(2) - R(1)]), meta: { ris: 2 } }));
// Frame B: (0,0) Raum2 -> Raum6 (delta 16)
d = decodeFrame(m3.process(buildFrame({ frameId: 3, frameType: 80, gridSize: 50, width: 1, height: 1, originX: 0, originY: 0, pixels: Buffer.from([R(6) - R(2)]), meta: { ris: 2 } })));
assert(d.pix[0] === 6, 'zwei Deltas nacheinander: 1 -> 2 -> 6');

// --- 5) Fahrspur (tr) wird aufgesammelt und als trpts ausgegeben ---
const m4 = new MapMerger();
m4.process(buildFrame({ frameId: 1, frameType: 73, gridSize: 50, width: 4, height: 4, originX: 0, originY: 0, pixels: iPix, meta: { fsm: 1, ris: 2, tr: 'S100,200L10,0' } }));
let d4 = decodeFrame(m4._buildFrame());
assert(d4.meta.trpts && d4.meta.trpts.length === 2, 'I-Frame tr -> 2 Punkte');
assert(d4.meta.trpts[0][0] === 100 && d4.meta.trpts[1][0] === 110, 'tr: L ist relativ (100 -> 110)');
assert(d4.meta.tr === undefined, 'rohes tr aus Meta entfernt');

// --- 6) Frame-Sequenz (HA _add_map_data): Luecke wird gepuffert, dann in Reihenfolge angewandt ---
const m5 = new MapMerger();
m5.process(iFrame); // frame 1
// frame 3 kommt VOR frame 2 -> darf nicht angewandt werden (Puffer)
let r = m5.process(buildFrame({ frameId: 3, frameType: 80, gridSize: 50, width: 1, height: 1, originX: 0, originY: 0, pixels: Buffer.from([R(6) - R(2)]), meta: { ris: 2 } }));
assert(r === null, 'Sequenz: Frame 3 vor Frame 2 -> gepuffert, nichts ausgegeben');
// frame 2 kommt nach -> beide werden in Reihenfolge angewandt (1 -> 2 -> 6)
d = decodeFrame(m5.process(buildFrame({ frameId: 2, frameType: 80, gridSize: 50, width: 1, height: 1, originX: 0, originY: 0, pixels: Buffer.from([R(2) - R(1)]), meta: { ris: 2 } })));
assert(d.pix[0] === 6, 'Sequenz: Luecke geschlossen -> beide Deltas in Reihenfolge (1->2->6)');
// alter Frame (id 2) nochmal -> uebersprungen
assert(m5.process(buildFrame({ frameId: 2, frameType: 80, gridSize: 50, width: 1, height: 1, originX: 0, originY: 0, pixels: Buffer.from([R(2)]), meta: { ris: 2 } })) === null, 'Sequenz: alter Frame wird uebersprungen');
// Map-ID-Wechsel -> needMapRequest
assert(m5.needMapRequest === false, 'Sequenz: needMapRequest anfangs false');
m5.process(buildFrame({ mapId: 9, frameId: 4, frameType: 80, gridSize: 50, width: 1, height: 1, originX: 0, originY: 0, pixels: Buffer.from([R(1)]), meta: { ris: 2 } }));
assert(m5.needMapRequest === true, 'Sequenz: Map-ID-Wechsel -> needMapRequest');

// --- 7) Aelterer I-Frame (timestamp) ueberschreibt frischere Basis NICHT ---
const m6 = new MapMerger();
m6.process(buildFrame({ frameId: 1, frameType: 73, gridSize: 50, width: 4, height: 4, originX: 0, originY: 0, pixels: iPix, meta: { fsm: 1, ris: 2, timestamp_ms: 2000 } }));
const oldI = buildFrame({ frameId: 1, frameType: 73, gridSize: 50, width: 4, height: 4, originX: 0, originY: 0, pixels: Buffer.from(new Array(16).fill(R(9))), meta: { fsm: 1, ris: 2, timestamp_ms: 1000 } });
assert(m6.process(oldI) === null, 'aelterer I-Frame (ts 1000 < 2000) wird uebersprungen');
d = decodeFrame(m6._buildFrame());
assert(d.pix[0] === 1, 'Basis blieb die frischere Karte');

console.log(`\nErgebnis: ${ok} OK, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
