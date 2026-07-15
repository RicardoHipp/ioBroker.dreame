'use strict';
/*
 * Dreame-Karten P-Frame-Merge
 * ===========================
 * Der Merge-Algorithmus und das Frame-/Pixel-Format wurden portiert/adaptiert aus:
 *   dreame-vacuum (Home Assistant Integration) von Tasshack
 *   https://github.com/Tasshack/dreame-vacuum
 *   Copyright (c) 2022 Tasshack — MIT License
 *
 * Referenz: dreame/map.py  (decode_map_data_from_partial / decode_p_map_data_from_partial)
 *
 * MIT License — the above copyright notice and this permission notice shall be
 * included in all copies or substantial portions of the Software.
 * -----------------------------------------------------------------------------
 *
 * P-Frame-Merge für Dreame-Karten  (Typ-Grid-Verfahren)
 * -----------------------------------------------------
 * Problem: I-Frame (getMap, gespeichert) und P-Frame (MQTT, live) kodieren
 * dieselbe Info in verschiedenen Byte-Werten:
 *   I-Frame:  Raum-ID in unteren 6 Bit  (v & 0x3f),  Wand = oberstes Bit (v>>7)
 *   P-Frame:  Raum-ID/Typ = v >> 2      (Raum 1-59, 61=Unbekannt, 62=Boden, 63=Wand)
 * Rohes Byte-Mischen ergibt Unsinn.
 *
 * Lösung: beide erst in EINE Sprache übersetzen -> "Typ pro Zelle" (0-63),
 * dann überlagern. Ausgabe: synthetischer Frame, ein Byte = Typ; das Widget
 * dekodiert direkt (kein Shift mehr nötig).
 *
 * Typ-Werte:  0=leer, 1..59=Raum-Segment, 61=Unbekannt, 62=Boden, 63=Wand
 */

// pako (wie im Adapter); Fallback auf Node-zlib (zlib-kompatibel)
let pako;
try {
  pako = require('pako');
} catch (e) {
  const zlib = require('zlib');
  pako = { inflate: (b) => zlib.inflateSync(Buffer.from(b)), deflate: (b) => zlib.deflateSync(Buffer.from(b)) };
}
const { Buffer } = require('buffer');

const HEADER_SIZE = 27;

function readHeader(buf) {
  return {
    mapId: buf.readInt16LE(0),
    frameId: buf.readInt16LE(2),
    frameType: buf.readUInt8(4),
    gridSize: buf.readInt16LE(17),
    width: buf.readInt16LE(19),
    height: buf.readInt16LE(21),
    originX: buf.readInt16LE(23),
    originY: buf.readInt16LE(25),
  };
}

// I-Frame-Byte -> Typ
function iType(v) {
  if (v >> 7) return 63; // Wand
  const seg = v & 0x3f;
  return seg > 0 && seg < 60 ? seg : 0; // Raum-Segment
}

class MapMerger {
  constructor(opts = {}) {
    this.log = opts.log || { debug() {}, info() {}, warn() {} };
    // EINE laufende Karte: { grid:Uint8Array(Typ/Zelle), dims, metaObj, headerBase:Buffer }
    // Hinweis: I-Frame (gespeicherte Karte) und P-Frames (Live-Reinigung) haben oft
    // verschiedene mapIds, aber dasselbe Koordinatensystem -> wir mergen auf EINE Basis.
    this.current = null;
  }

  reset() {
    this.current = null;
  }

  _inflate(b64) {
    try {
      return Buffer.from(pako.inflate(Buffer.from(b64, 'base64')));
    } catch (e) {
      this.log.debug('[MERGE] inflate fehlgeschlagen: ' + e.message);
      return null;
    }
  }

  _parseMeta(buf, pixEnd) {
    if (buf.length <= pixEnd) return {};
    try { return JSON.parse(buf.toString('utf8', pixEnd)); } catch (e) { return {}; }
  }

  /** Baut aus dem laufenden Typ-Grid einen synthetischen I-Frame (base64/zlib). */
  _buildFrame() {
    const m = this.current;
    const hdr = Buffer.from(m.headerBase); // vom letzten Frame (frische robot/charger im Header)
    hdr.writeUInt8(73, 4); // frame_type = I
    hdr.writeInt16LE(m.dims.width, 19);
    hdr.writeInt16LE(m.dims.height, 21);
    hdr.writeInt16LE(m.dims.left, 23);
    hdr.writeInt16LE(m.dims.top, 25);
    const pixels = Buffer.from(m.grid); // ein Byte = Typ
    const meta = Buffer.from(JSON.stringify(m.metaObj), 'utf8');
    return Buffer.from(pako.deflate(Buffer.concat([hdr, pixels, meta]))).toString('base64');
  }

  /**
   * Verarbeitet einen rohen Karten-Frame (base64/zlib).
   * @returns {string|null} base64 des gemergten synthetischen Frames (Typ-Format),
   *          oder null wenn nicht verarbeitbar.
   */
  process(b64) {
    const inflated = this._inflate(b64);
    if (!inflated || inflated.length < HEADER_SIZE) return null;
    const h = readHeader(inflated);
    const pixStart = HEADER_SIZE;
    const pixEnd = HEADER_SIZE + h.width * h.height;
    if (inflated.length < pixEnd) {
      this.log.debug(`[MERGE] Frame zu kurz (${inflated.length} < ${pixEnd})`);
      return null;
    }

    // --- I-Frame: neue Basis (in Typ-Grid übersetzen) ---
    if (h.frameType === 73) {
      // Basis nur EINMAL setzen. Weitere I-Frames (getMap-Poll) ignorieren,
      // damit angesammeltes P-Frame-Detail nicht zurückgesetzt wird.
      if (this.current) {
        this.log.debug(`[MERGE] weiterer I-Frame (map=${h.mapId}) ignoriert, Basis bleibt`);
        return this._buildFrame();
      }
      const n = h.width * h.height;
      const grid = new Uint8Array(n);
      for (let i = 0; i < n; i++) grid[i] = iType(inflated[pixStart + i]);
      this.current = {
        grid,
        dims: { left: h.originX, top: h.originY, width: h.width, height: h.height, gridSize: h.gridSize },
        metaObj: this._parseMeta(inflated, pixEnd),
        headerBase: Buffer.from(inflated.slice(0, HEADER_SIZE)),
      };
      this.log.debug(`[MERGE] I-Frame Basis: map=${h.mapId} ${h.width}x${h.height}`);
      return this._buildFrame();
    }

    // --- P-Frame: auf laufende Basis überlagern (mapId egal, gleiches Koord-System) ---
    const cur = this.current;
    if (!cur) {
      this.log.debug(`[MERGE] P-Frame (map=${h.mapId}), aber noch keine Basis -> überspringe`);
      return null;
    }

    const grid_ = h.gridSize || cur.dims.gridSize;
    const nd = { left: h.originX, top: h.originY, width: h.width, height: h.height, gridSize: grid_ };
    const cd = cur.dims;

    // Union-Bounding-Box (Weltkoordinaten)
    const left = Math.min(nd.left, cd.left);
    const top = Math.min(nd.top, cd.top);
    const maxLeft = Math.max(nd.left + nd.width * grid_, cd.left + cd.width * cd.gridSize);
    const maxTop = Math.max(nd.top + nd.height * grid_, cd.top + cd.height * cd.gridSize);
    const width = Math.round((maxLeft - left) / grid_);
    const height = Math.round((maxTop - top) / grid_);

    if (width <= 0 || height <= 0 || width * height > 4000000) {
      this.log.warn(`[MERGE] ungültige Zielgröße ${width}x${height} -> überspringe`);
      return null;
    }

    const grid = new Uint8Array(width * height);

    // 1) altes Typ-Grid an seinen Offset kopieren
    let lo = Math.round((cd.left - left) / cd.gridSize);
    let to = Math.round((cd.top - top) / cd.gridSize);
    for (let y = 0; y < cd.height; y++) {
      for (let x = 0; x < cd.width; x++) {
        const gx = lo + x, gy = to + y;
        if (gx >= 0 && gy >= 0 && gx < width && gy < height) grid[width * gy + gx] = cur.grid[cd.width * y + x];
      }
    }

    // 2) P-Frame-Typen (>>2) drüberlegen (nur Nicht-Null)
    lo = Math.round((nd.left - left) / grid_);
    to = Math.round((nd.top - top) / grid_);
    const pf = inflated.slice(pixStart, pixEnd);
    let changed = 0;
    for (let y = 0; y < nd.height; y++) {
      for (let x = 0; x < nd.width; x++) {
        const v = pf[nd.width * y + x];
        if (!v) continue;
        const gx = lo + x, gy = to + y;
        if (gx < 0 || gy < 0 || gx >= width || gy >= height) continue;
        grid[width * gy + gx] = v >> 2; // in Typ übersetzen
        changed++;
      }
    }

    // Meta: Raumstruktur (walls_info/seg_inf) aus I-Frame behalten, Rest aus P-Frame
    const pMeta = this._parseMeta(inflated, pixEnd);
    const mergedMeta = Object.assign({}, cur.metaObj, pMeta);
    if (cur.metaObj.walls_info && !pMeta.walls_info) mergedMeta.walls_info = cur.metaObj.walls_info;
    if (cur.metaObj.seg_inf && !pMeta.seg_inf) mergedMeta.seg_inf = cur.metaObj.seg_inf;

    cur.grid = grid;
    cur.dims = { left, top, width, height, gridSize: grid_ };
    cur.metaObj = mergedMeta;
    cur.headerBase = Buffer.from(inflated.slice(0, HEADER_SIZE)); // frische robot/charger

    this.log.debug(`[MERGE] P-Frame gemergt: map=${h.mapId} frame=${h.frameId} +${changed}px -> ${width}x${height}`);
    return this._buildFrame();
  }
}

module.exports = { MapMerger, readHeader, HEADER_SIZE, iType };
