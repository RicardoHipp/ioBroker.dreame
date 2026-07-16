'use strict';
/*
 * Dreame-Karten-Merge (HA-Port)
 * =============================
 * Logik portiert aus:
 *   dreame-vacuum (Home Assistant Integration) von Tasshack
 *   https://github.com/Tasshack/dreame-vacuum
 *   Copyright (c) 2022 Tasshack — MIT License
 *
 * Referenz: dreame/map.py (_get_pixel_type, decode_map_data_from_partial)
 *
 * MIT License — the above copyright notice and this permission notice shall be
 * included in all copies or substantial portions of the Software.
 * -----------------------------------------------------------------------------
 *
 * Ablauf (wie HA):
 *   I-Frame (73) = komplette Karte  -> Raster aus getPixelType() aufbauen
 *   P-Frame (80) = Teilstueck       -> Union-Bounding-Box, Basis kopieren, Teil ueberlagern
 *
 * Beide Frame-Arten der Live-/Arbeitskarte gehoeren in HAs `frame_map`-Zweig (Pixel >> 2).
 * Empirisch geprueft an echten Geraetedaten: nur dieser Zweig liefert die korrekten
 * Raum-Nummern (1-7, passend zu seg_inf) und WALL. Deshalb frame_map = true.
 *
 * Das Raster enthaelt HA-Pixeltypen:
 *   0 = OUTSIDE (leer) | 1..63 = Raum-Segment | 252 = UNKNOWN
 *   253 = NEW_SEGMENT  | 254 = FLOOR          | 255 = WALL
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
const { getPixelType, MapPixelType, setSegmentColorIndex } = require('./haMap');

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
  constructor(opts = {}) {
    this.log = opts.log || { debug() {}, info() {}, warn() {} };
    // Karten-Version wie HA map_version(): aus Geraete-Faehigkeiten; Standard 1,
    // map_v2-Geraete = 3. Per Option konfigurierbar (opts.mapVersion).
    this.mapVersion = opts.mapVersion || 1;
    // current: { data:Uint8Array(ROH-Bytes wie HA map_data.data), grid:Uint8Array(HA-Pixeltyp),
    //            carpet:Uint8Array, dims, metaObj, headerBase }
    this.current = null;
    this.trPoints = [];  // aufgesammelte Fahrspur (Weltkoord) ueber P-Frames hinweg
    this.trLastFrame = -1;
    // Frame-Sequenz wie HA _add_map_data: P-Frames nur in Reihenfolge (frame_id+1)
    // anwenden; Luecken werden gepuffert, bei zu grosser Luecke neue Karte anfordern.
    this.currentFrameId = null;
    this.currentMapId = null;
    this.pQueue = new Map();      // frame_id -> geparster Frame
    this.needMapRequest = false;  // Aufrufer soll eine frische Komplett-Karte holen
    this.requestPFrame = null;    // Aufrufer soll diesen P-Frame nachfordern {mapId, frameId}
  }

  reset() {
    this.current = null;
    this.trPoints = [];
    this.trLastFrame = -1;
    this.currentFrameId = null;
    this.currentMapId = null;
    this.pQueue = new Map();
    this.needMapRequest = false;
    this.requestPFrame = null;
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

  /**
   * HA-MapData-Kontext fuer getPixelType.
   * frame_map wie HA (map.py 4301): I-Frame -> meta.fsm == 1; P-Frame -> immer true (5695).
   * saved_map_status = meta.ris; version = Geraete-Version (map_version).
   */
  _mapCtx(meta, isPFrame) {
    return {
      version: this.mapVersion,
      frame_map: isPFrame ? true : Boolean(meta && meta.fsm === 1),
      saved_map_status: meta && meta.ris,
    };
  }

  // Roher Dreame-tr-String -> Punkte (Weltkoord). L=relativ, l=absolute Linie, M/W/S=absoluter Break.
  _decodeTr(trStr) {
    if (!trStr || typeof trStr !== 'string') return [];
    const re = /([MWSLl])(-?\d+),(-?\d+)/g;
    let m; const pts = []; let cx = 0, cy = 0;
    while ((m = re.exec(trStr))) {
      const op = m[1], x = +m[2], y = +m[3];
      if (op === 'L') { cx += x; cy += y; pts.push({ x: cx, y: cy, operator: 'L' }); }
      else if (op === 'l') { cx = x; cy = y; pts.push({ x: cx, y: cy, operator: 'L' }); }
      else { cx = x; cy = y; pts.push({ x: cx, y: cy, operator: op }); }
    }
    return pts;
  }

  // Fahrspur aufsammeln: I-Frame traegt die komplette Session-Spur -> ersetzen.
  // P-Frames tragen kurze Stuecke -> anhaengen; Frame-ID-Ruecksprung = neue Sitzung -> Reset.
  _accumulateTr(h, meta, isIFrame) {
    const pts = this._decodeTr(meta && meta.tr);
    if (isIFrame) {
      if (pts.length) this.trPoints = pts;
      this.trLastFrame = h.frameId;
      return;
    }
    if (h.frameId < this.trLastFrame - 2) this.trPoints = [];
    this.trLastFrame = h.frameId;
    if (pts.length) {
      for (const p of pts) this.trPoints.push(p);
      if (this.trPoints.length > 8000) this.trPoints = this.trPoints.slice(-8000);
    }
  }

  /**
   * HA-Port: saved-map merge (map.py ~4873ff, saved_map_status==2) + Feld-Parsing.
   * Liest die eingebettete gespeicherte Karte (meta.rism) und uebernimmt daraus alles,
   * was HA/App aus der gespeicherten Karte zeichnet. Ergebnis landet in meta.ha.
   */
  _mergeSavedMapData(meta, inflated) {
    let saved = {};
    if (meta.rism) {
      try {
        const R = Buffer.from(pako.inflate(Buffer.from(String(meta.rism).replace(/-/g, '+').replace(/_/g, '/'), 'base64')));
        if (R.length >= HEADER_SIZE) {
          const rh = readHeader(R);
          saved = this._parseMeta(R, HEADER_SIZE + rh.width * rh.height);
        }
      } catch (e) {
        this.log.debug('[MERGE] rism inflate: ' + e.message);
      }
    }

    // Segmentnamen/-struktur (Live-Karte hat kein seg_inf/walls_info)
    if (!meta.seg_inf && saved.seg_inf) meta.seg_inf = saved.seg_inf;
    if (!meta.walls_info && saved.walls_info) meta.walls_info = saved.walls_info;

    const ha = {};
    // Farb-Indizes wie die App (set_segment_color_index, 4 Farben)
    ha.colorIndex = setSegmentColorIndex(meta.seg_inf);
    // ausgeblendete Raeume (delsr -> hidden_segments)
    if (Array.isArray(saved.delsr) && saved.delsr.length) ha.hiddenSegments = saved.delsr;

    // Moebel: funiture_info (gespeichert) bevorzugt, sonst ai_furniture_user/new/ai_furniture (live)
    // funiture_info-Zeile: [id, type, ?, w, h, ?, cx, cy, ?, angle, ...]; Typ-Swap 8<->25 (map.py 4957)
    const furn = [];
    if (Array.isArray(saved.funiture_info)) {
      for (const f of saved.funiture_info) {
        if (!Array.isArray(f) || f.length < 8 || !(f[3] > 0 && f[4] > 0)) continue;
        let t = parseInt(f[1], 10);
        if (t === 8) t = 25; else if (t === 25) t = 8;
        // seg = Raum-Nummer (HA: furniture[13]) — fuer "Moebel mit Raum ausblenden"
        furn.push({ x: f[6], y: f[7], w: f[3], h: f[4], type: t, angle: f.length > 9 && f[9] ? f[9] : 0, seg: f.length >= 14 && f[13] ? f[13] : 0 });
      }
    }
    if (!furn.length) {
      // ai_furniture-Zeile: [cx, cy, type, ?, x0, y0, w, h, (angle), (scale)] (map.py 5000ff)
      const src = meta.ai_furniture_user && meta.ai_furniture_user.length ? meta.ai_furniture_user
        : meta.ai_furniture_new && meta.ai_furniture_new.length ? meta.ai_furniture_new
        : meta.ai_furniture;
      const isPlainAi = src === meta.ai_furniture;
      if (Array.isArray(src)) {
        for (const f of src) {
          if (!Array.isArray(f) || f.length < 4) continue;
          const t = parseInt(f[2], 10);
          let angle = f.length >= 9 ? parseFloat(f[8]) : 0;
          if (isPlainAi) { if (angle === 180) angle = 0; else if (angle === 0) angle = 180; }
          furn.push({ x: f[0], y: f[1], w: f.length >= 8 ? Math.abs(f[6]) : 0, h: f.length >= 8 ? Math.abs(f[7]) : 0, type: t, angle, seg: f[3] ? parseInt(f[3], 10) : 0 });
        }
      }
    }
    if (furn.length) ha.furnitures = furn;

    // Vorhaenge: "curtain" oder "ct" als Objekt mit line (map.py: curtains = curtain ?? ct)
    const curt = (saved.curtain && saved.curtain.line) ? saved.curtain.line
      : (saved.ct && saved.ct.line) ? saved.ct.line
      : (meta.curtain && meta.curtain.line) ? meta.curtain.line : null;
    if (Array.isArray(curt) && curt.length) ha.curtains = curt;

    // Virtuelle Waende / Sperrzonen / Nutzer-Teppiche (vw: line/rect/mop/addcpt/nocpt)
    const vw = saved.vw || meta.vw;
    if (vw) {
      if (Array.isArray(vw.line) && vw.line.length) ha.virtualWalls = vw.line;
      if (Array.isArray(vw.rect) && vw.rect.length) ha.noGo = vw.rect;
      if (Array.isArray(vw.mop) && vw.mop.length) ha.noMop = vw.mop;
      if (Array.isArray(vw.addcpt) && vw.addcpt.length) ha.carpets = vw.addcpt;
      if (Array.isArray(vw.nocpt) && vw.nocpt.length) ha.deletedCarpets = vw.nocpt;
    }

    // Erkannte Teppiche: carpet_polygon = {id: [coords[], seg?, hiddenFlag?]} (map.py 5285ff)
    const cpoly = saved.carpet_polygon || meta.carpet_polygon;
    if (cpoly && typeof cpoly === 'object') {
      const dc = [];
      for (const [id, c] of Object.entries(cpoly)) {
        if (!Array.isArray(c) || !Array.isArray(c[0]) || c[0].length < 8) continue;
        dc.push({ id: parseInt(id, 10), polygon: c[0], hidden: !(c.length <= 2 || c[2] === 0) });
      }
      if (dc.length) ha.detectedCarpets = dc;
    }

    meta.ha = ha;
  }

  /** Baut aus dem laufenden Raster einen synthetischen I-Frame (base64/zlib). */
  _buildFrame() {
    const m = this.current;
    const hdr = Buffer.from(m.headerBase); // vom letzten Frame (frische robot/charger im Header)
    hdr.writeUInt8(73, 4); // frame_type = I
    hdr.writeInt16LE(m.dims.width, 19);
    hdr.writeInt16LE(m.dims.height, 21);
    hdr.writeInt16LE(m.dims.left, 23);
    hdr.writeInt16LE(m.dims.top, 25);
    const pixels = Buffer.from(m.grid); // ein Byte = HA-Pixeltyp
    const metaObj = Object.assign({}, m.metaObj);
    metaObj.trpts = this.trPoints.map((p) => [p.x, p.y, p.operator === 'L' ? 0 : 1]);
    // Roboter-Blickrichtung aus dem Frame-Header (Offset 9) — HA dreht das Icon danach
    if (metaObj.ha) metaObj.ha.robotAngle = m.headerBase.readInt16LE(9);
    // HA: carpet_pixels — Teppich-Zellen als Raster-Indizes (Widget legt Schleier drueber)
    if (m.carpet) {
      const cp = [];
      for (let i = 0; i < m.carpet.length; i++) if (m.carpet[i]) cp.push(i);
      metaObj.carpetPx = cp;
    }
    delete metaObj.tr;   // rohes tr-Stueck raus (durch trpts ersetzt)
    delete metaObj.rism; // grosse eingebettete Referenzkarte nicht mitschleppen
    const meta = Buffer.from(JSON.stringify(metaObj), 'utf8');
    return Buffer.from(pako.deflate(Buffer.concat([hdr, pixels, meta]))).toString('base64');
  }

  /**
   * Verarbeitet einen rohen Karten-Frame (base64/zlib).
   * Frame-Sequenz wie HA _add_map_data (map.py ~690-785): map_id-Wechsel und
   * Frame-Luecken werden erkannt; bei Luecke wird gepuffert, bei zu grosser Luecke
   * this.needMapRequest gesetzt (Aufrufer holt frische Komplett-Karte).
   * @returns {string|null} base64 des gemergten Frames (HA-Pixeltypen), oder null.
   */
  process(b64) {
    const parsed = this._parseFrame(b64);
    if (!parsed) return null;
    const h = parsed.h;

    if (h.frameType === 73) {
      // HA: aelterer I-Frame (timestamp) wird uebersprungen — schuetzt davor, dass die
      // veraltete gespeicherte Karte eine frischere Live-Basis ueberschreibt.
      if (this.current) {
        const curTs = this.current.metaObj && this.current.metaObj.timestamp_ms;
        const newTs = parsed.meta.timestamp_ms;
        if (!(newTs && (!curTs || newTs >= curTs))) {
          this.log.debug(`[MERGE] I-Frame uebersprungen (timestamp ${newTs} < ${curTs})`);
          return null;
        }
      }
      this._applyIFrame(parsed);
      this._drainQueue();
      return this._buildFrame();
    }

    if (h.frameType !== 80) return null;

    // --- P-Frame-Sequenzregeln (HA _add_map_data) ---
    if (!this.current) {
      this.log.debug(`[MERGE] P-Frame (map=${h.mapId}) ohne Basiskarte -> Karte anfordern`);
      this.needMapRequest = true;
      return null;
    }
    if (this.currentMapId !== null && h.mapId !== this.currentMapId) {
      // HA: bei Map-ID-Wechsel current-IDs nullen, neue Frames PUFFERN und I-Karte
      // anfordern — die gepufferten Frames werden nach der neuen Basis angewandt.
      this.log.debug(`[MERGE] Map-ID-Wechsel ${this.currentMapId} -> ${h.mapId} -> puffern, frische Karte anfordern`);
      this.pQueue.clear();
      this.currentFrameId = null;
      this.currentMapId = null;
      this.pQueue.set(h.frameId, parsed);
      this.needMapRequest = true;
      return null;
    }
    if (this.currentFrameId === null) {
      // Warten auf neue I-Basis (nach Map-Wechsel): nur puffern
      this.pQueue.set(h.frameId, parsed);
      if (this.pQueue.size > 16) this.pQueue.clear();
      this.needMapRequest = true;
      return null;
    }
    if (h.frameId <= this.currentFrameId) {
      this.log.debug(`[MERGE] P-Frame ${h.frameId} <= ${this.currentFrameId} -> uebersprungen`);
      return null;
    }
    if (h.frameId !== this.currentFrameId + 1) {
      this.pQueue.set(h.frameId, parsed);
      if (this.pQueue.size > 8) {
        // grosse Luecke -> komplette Karte neu (HA: _request_map)
        this.log.debug(`[MERGE] ${this.pQueue.size} P-Frames in Luecke -> Karte anfordern`);
        this.pQueue.clear();
        this.needMapRequest = true;
      } else {
        // kleine Luecke -> fehlenden P-Frame GEZIELT nachfordern (HA: _request_next_p_map)
        this.requestPFrame = { mapId: this.currentMapId, frameId: this.currentFrameId + 1 };
      }
      return null;
    }

    this._applyPFrame(parsed);
    this._drainQueue();
    return this._buildFrame();
  }

  /** base64/zlib-Frame -> {h, inflated, meta, ctx, pixStart, pixEnd} oder null */
  _parseFrame(b64) {
    const inflated = this._inflate(b64);
    if (!inflated || inflated.length < HEADER_SIZE) return null;
    const h = readHeader(inflated);
    const pixStart = HEADER_SIZE;
    const pixEnd = HEADER_SIZE + h.width * h.height;
    if (inflated.length < pixEnd) {
      this.log.debug(`[MERGE] Frame zu kurz (${inflated.length} < ${pixEnd})`);
      return null;
    }
    const meta = this._parseMeta(inflated, pixEnd);
    const ctx = this._mapCtx(meta, h.frameType === 80);
    return { h, inflated, meta, ctx, pixStart, pixEnd };
  }

  /** Gepufferte P-Frames in Reihenfolge abarbeiten (HA _unqueue_partial_map) */
  _drainQueue() {
    // Frames einer anderen Karten-Session verwerfen (z.B. nach neuem I-Frame)
    for (const [k, p] of [...this.pQueue.entries()]) {
      if (this.currentMapId !== null && p.h.mapId !== this.currentMapId) this.pQueue.delete(k);
    }
    while (this.currentFrameId !== null && this.pQueue.has(this.currentFrameId + 1)) {
      const next = this.pQueue.get(this.currentFrameId + 1);
      this.pQueue.delete(this.currentFrameId + 1);
      this._applyPFrame(next);
    }
    for (const k of [...this.pQueue.keys()]) {
      if (this.currentFrameId !== null && k <= this.currentFrameId) this.pQueue.delete(k);
    }
  }

  /** I-Frame anwenden: komplette Karte = neue Basis */
  _applyIFrame(parsed) {
    const { h, inflated, meta, ctx, pixStart } = parsed;
    const n = h.width * h.height;
    const data = new Uint8Array(n);   // ROH-Bytes behalten (HA map_data.data) — P-Frames sind DELTAS darauf!
    const grid = new Uint8Array(n);
    const carpet = new Uint8Array(n); // HA: carpet_pixels (Flag aus _get_pixel_type)
    for (let i = 0; i < n; i++) {
      const v = inflated[pixStart + i];
      data[i] = v;
      const [t, isCarpet] = getPixelType(ctx, v);
      grid[i] = t;
      if (isCarpet) carpet[i] = 1;
    }
    // Gespeicherte Karte (meta.rism) VOLLSTAENDIG uebernehmen — wie HA bei
    // saved_map_status==2 (map.py ~4873ff): Zonen, Teppiche, Vorhaenge, Moebel,
    // ausgeblendete Raeume, Segmentnamen, Farb-Indizes.
    this._mergeSavedMapData(meta, inflated);
    this.current = {
      data,
      grid,
      carpet,
      dims: { left: h.originX, top: h.originY, width: h.width, height: h.height, gridSize: h.gridSize },
      metaObj: meta,
      headerBase: Buffer.from(inflated.slice(0, HEADER_SIZE)),
    };
    this.currentFrameId = h.frameId;
    this.currentMapId = h.mapId;
    this._accumulateTr(h, meta, true);
    this.log.debug(`[MERGE] I-Frame Basis: map=${h.mapId} frame=${h.frameId} ${h.width}x${h.height}`);
  }

  /** P-Frame anwenden: Deltas auf den Roh-Puffer (Sequenz wurde in process() geprueft) */
  _applyPFrame(parsed) {
    const { h, inflated, meta, ctx, pixStart, pixEnd } = parsed;
    const cur = this.current;
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
      this.log.warn(`[MERGE] ungueltige Zielgroesse ${width}x${height} -> uebersprungen`);
      this.currentFrameId = h.frameId; // Sequenz nicht blockieren
      return;
    }

    const data = new Uint8Array(width * height);   // ROH-Puffer (HA: np.zeros uint8)
    const grid = new Uint8Array(width * height);
    const carpet = new Uint8Array(width * height);

    // 1) alten ROH-Puffer + Raster (+ Teppich-Ebene) an seinen Offset kopieren
    let lo = Math.round((cd.left - left) / cd.gridSize);
    let to = Math.round((cd.top - top) / cd.gridSize);
    for (let y = 0; y < cd.height; y++) {
      for (let x = 0; x < cd.width; x++) {
        const gx = lo + x, gy = to + y;
        if (gx >= 0 && gy >= 0 && gx < width && gy < height) {
          const si = cd.width * y + x, di = width * gy + gx;
          if (cur.data) data[di] = cur.data[si];
          grid[di] = cur.grid[si];
          if (cur.carpet) carpet[di] = cur.carpet[si];
        }
      }
    }

    // 2) P-Frame anwenden — 1:1 HA decode_p_map_data_from_partial:
    //    "P map only returns difference between its previous frame."
    //    version 3: Wert direkt setzen; sonst: DELTA auf den alten ROH-Wert ADDIEREN,
    //    dann den NEUEN Rohwert dekodieren. (Genau das fehlte: Ersetzen statt Addieren
    //    erzeugte Geister-Segmente/blaue Flaechen.)
    lo = Math.round((nd.left - left) / grid_);
    to = Math.round((nd.top - top) / grid_);
    const pf = inflated.slice(pixStart, pixEnd);
    let changed = 0;
    for (let y = 0; y < nd.height; y++) {
      for (let x = 0; x < nd.width; x++) {
        const newData = pf[nd.width * y + x];
        if (!newData) continue;
        const gx = lo + x, gy = to + y;
        if (gx < 0 || gy < 0 || gx >= width || gy >= height) continue;
        const di = width * gy + gx;
        // HA: new_value = new_data (v3)  |  data[new_index] + new_data (sonst)
        const newValue = ctx.version === 3 ? newData : data[di] + newData;
        data[di] = newValue & 0xff; // numpy-uint8-Zuweisung (wrap); getPixelType bekommt wie HA int(new_value)
        const [t, isCarpet] = getPixelType(ctx, newValue);
        grid[di] = t;
        carpet[di] = isCarpet ? 1 : 0; // HA: carpet_pixels add/remove
        changed++;
      }
    }

    // Meta: Raumstruktur (walls_info/seg_inf) aus I-Frame behalten, Rest aus P-Frame
    const mergedMeta = Object.assign({}, cur.metaObj, meta);
    if (cur.metaObj.walls_info && !meta.walls_info) mergedMeta.walls_info = cur.metaObj.walls_info;
    if (cur.metaObj.seg_inf && !meta.seg_inf) mergedMeta.seg_inf = cur.metaObj.seg_inf;

    cur.data = data;
    cur.grid = grid;
    cur.carpet = carpet;
    cur.dims = { left, top, width, height, gridSize: grid_ };
    cur.metaObj = mergedMeta;
    cur.headerBase = Buffer.from(inflated.slice(0, HEADER_SIZE)); // frische robot/charger

    this.currentFrameId = h.frameId;
    this.currentMapId = h.mapId;
    this._accumulateTr(h, meta, false);
    this.log.debug(`[MERGE] P-Frame gemergt: map=${h.mapId} frame=${h.frameId} +${changed}px -> ${width}x${height}`);
  }
}

module.exports = { MapMerger, readHeader, HEADER_SIZE, MapPixelType };
