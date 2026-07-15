'use strict';
/*
 * P-Frame-Merge für Dreame-Karten (portiert aus HA dreame-vacuum v2.0.0b25)
 * -------------------------------------------------------------------------
 * Der Roboter sendet:
 *   - I-Frame (frame_type 73): die komplette Karte (Basis)
 *   - P-Frame (frame_type 80): nur die Änderungen (Delta) gegenüber vorher
 *
 * Der bestehende decodeMultiMapData() verwirft P-Frames (return null) und zeigt
 * daher nur den alten I-Frame. Dieses Modul hält pro Karte einen laufenden Puffer
 * und merged P-Frame-Deltas hinein. Ergebnis wird als synthetischer I-Frame
 * (frame_type 73, base64/zlib) zurückgegeben, den decodeMultiMapData unverändert
 * weiterverarbeiten kann.
 *
 * Referenz-Algorithmus: HA map.py decode_p_map_data_from_partial (Z. 5762-5824).
 */

// pako (wie im Adapter); Fallback auf Node-zlib (zlib-kompatibel), falls pako fehlt
let pako;
try {
  pako = require('pako');
} catch (e) {
  const zlib = require('zlib');
  pako = {
    inflate: (b) => zlib.inflateSync(Buffer.from(b)),
    deflate: (b) => zlib.deflateSync(Buffer.from(b)),
  };
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

class MapMerger {
  /**
   * @param {object} opts { log, additive }
   *   log: ioBroker-Logger (optional)
   *   additive: true = HA-Verhalten für Nicht-V3 (alt+neu), false = ersetzen
   */
  constructor(opts = {}) {
    this.log = opts.log || { debug() {}, info() {}, warn() {} };
    this.additive = opts.additive !== false; // default: additiv (HA Nicht-V3)
    this.maps = {}; // mapId -> { pixels:Buffer, dims:{left,top,width,height,gridSize}, header:Buffer, metaObj:object }
  }

  reset(mapId) {
    if (mapId == null) this.maps = {};
    else delete this.maps[mapId];
  }

  _inflate(b64) {
    try {
      return Buffer.from(pako.inflate(Buffer.from(b64, 'base64')));
    } catch (e) {
      this.log.debug('[MERGE] inflate failed: ' + e.message);
      return null;
    }
  }

  _parseMeta(buf, pixEnd) {
    if (buf.length <= pixEnd) return {};
    try { return JSON.parse(buf.toString('utf8', pixEnd)); } catch (e) { return {}; }
  }

  /**
   * Verarbeitet einen rohen Karten-Frame (base64, zlib).
   * @returns {string|null} base64 eines gemergten synthetischen I-Frames,
   *          oder der Original-String bei I-Frames,
   *          oder null wenn nicht verarbeitbar (Aufrufer nutzt dann Original/Fallback).
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

    // --- I-Frame: als neue Basis speichern ---
    if (h.frameType === 73) {
      this.maps[h.mapId] = {
        header: Buffer.from(inflated.slice(0, HEADER_SIZE)),
        pixels: Buffer.from(inflated.slice(pixStart, pixEnd)),
        metaObj: this._parseMeta(inflated, pixEnd),
        dims: { left: h.originX, top: h.originY, width: h.width, height: h.height, gridSize: h.gridSize },
      };
      this.log.debug(`[MERGE] I-Frame gespeichert: map=${h.mapId} ${h.width}x${h.height} origin=(${h.originX},${h.originY})`);
      return b64; // unverändert weiterreichen
    }

    // --- P-Frame: auf laufenden Puffer mergen ---
    const cur = this.maps[h.mapId];
    if (!cur) {
      this.log.debug(`[MERGE] P-Frame für map=${h.mapId}, aber noch kein I-Frame -> überspringe`);
      return null;
    }

    const grid = h.gridSize || cur.dims.gridSize;
    const nd = { left: h.originX, top: h.originY, width: h.width, height: h.height, gridSize: grid };
    const cd = cur.dims;

    // Union-Bounding-Box (Weltkoordinaten)
    const left = Math.min(nd.left, cd.left);
    const top = Math.min(nd.top, cd.top);
    const maxLeft = Math.max(nd.left + nd.width * grid, cd.left + cd.width * cd.gridSize);
    const maxTop = Math.max(nd.top + nd.height * grid, cd.top + cd.height * cd.gridSize);
    const width = Math.round((maxLeft - left) / grid);
    const height = Math.round((maxTop - top) / grid);

    if (width <= 0 || height <= 0 || width * height > 4_000_000) {
      this.log.warn(`[MERGE] ungültige Zielgröße ${width}x${height} -> Fallback`);
      return null;
    }

    const data = Buffer.alloc(width * height, 0);
    const put = (x, y, v) => { if (x >= 0 && y >= 0 && x < width && y < height) data[width * y + x] = v; };

    // 1) alte Karte an ihren Offset kopieren
    let lo = Math.round((cd.left - left) / cd.gridSize);
    let to = Math.round((cd.top - top) / cd.gridSize);
    for (let y = 0; y < cd.height; y++) {
      for (let x = 0; x < cd.width; x++) {
        put(lo + x, to + y, cur.pixels[cd.width * y + x]);
      }
    }

    // 2) P-Frame-Delta an seinem Offset drüberlegen (nur Nicht-Null-Pixel)
    lo = Math.round((nd.left - left) / grid);
    to = Math.round((nd.top - top) / grid);
    const pf = inflated.slice(pixStart, pixEnd);
    let changed = 0;
    for (let y = 0; y < nd.height; y++) {
      for (let x = 0; x < nd.width; x++) {
        const nv = pf[nd.width * y + x];
        if (nv) {
          const tx = lo + x, ty = to + y;
          if (tx >= 0 && ty >= 0 && tx < width && ty < height) {
            const idx = width * ty + tx;
            data[idx] = this.additive ? ((data[idx] + nv) & 0xff) : nv;
            changed++;
          }
        }
      }
    }

    // Meta zusammenführen: Raumstruktur (walls_info/seg_inf) aus I-Frame behalten,
    // frische Felder (robot/charger/tr/...) aus P-Frame überschreiben.
    const pMeta = this._parseMeta(inflated, pixEnd);
    const mergedMeta = Object.assign({}, cur.metaObj, pMeta);
    if (cur.metaObj.walls_info && !pMeta.walls_info) mergedMeta.walls_info = cur.metaObj.walls_info;
    if (cur.metaObj.seg_inf && !pMeta.seg_inf) mergedMeta.seg_inf = cur.metaObj.seg_inf;

    // Zustand aktualisieren
    cur.pixels = data;
    cur.dims = { left, top, width, height, gridSize: grid };
    cur.metaObj = mergedMeta;

    // Synthetischen I-Frame bauen: Header vom P-Frame (frische Roboter-/Ladepos),
    // aber frame_type=73 und gemergte Dims/Origin.
    const newHdr = Buffer.from(inflated.slice(0, HEADER_SIZE));
    newHdr.writeUInt8(73, 4);
    newHdr.writeInt16LE(width, 19);
    newHdr.writeInt16LE(height, 21);
    newHdr.writeInt16LE(left, 23);
    newHdr.writeInt16LE(top, 25);
    cur.header = newHdr;

    const metaBuf = Buffer.from(JSON.stringify(mergedMeta), 'utf8');
    const merged = Buffer.concat([newHdr, data, metaBuf]);
    const out = Buffer.from(pako.deflate(merged)).toString('base64');

    this.log.debug(`[MERGE] P-Frame gemergt: map=${h.mapId} frame=${h.frameId} -> ${width}x${height}, ${changed} Pixel geändert (${this.additive ? 'additiv' : 'ersetzen'})`);
    return out;
  }
}

module.exports = { MapMerger, readHeader, HEADER_SIZE };
