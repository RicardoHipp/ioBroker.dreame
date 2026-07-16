'use strict';
/*
 * HA-Port: Dreame-Karten-Dekoder
 * ==============================
 * 1:1-Portierung aus:
 *   dreame-vacuum (Home Assistant Integration) von Tasshack
 *   https://github.com/Tasshack/dreame-vacuum
 *   Copyright (c) 2022 Tasshack — MIT License
 *
 * Referenz: dreame/map.py  (DreameVacuumMapDecoder._get_pixel_type, get_segments)
 *           dreame/types.py (MapPixelType)
 *
 * MIT License — the above copyright notice and this permission notice shall be
 * included in all copies or substantial portions of the Software.
 * -----------------------------------------------------------------------------
 *
 * WICHTIG: Diese Datei bildet HAs Logik EXAKT ab (gleiche Verzweigungen, gleiche
 * Zahlen). Keine eigenen Erfindungen, keine Vereinfachungen. Wenn etwas nicht
 * passt, ist es ein Port-Fehler und gegen map.py zu prüfen — nicht "kreativ" zu fixen.
 */

// types.py: class MapPixelType(IntEnum)
const MapPixelType = {
  OUTSIDE: 0,
  WIFI_WALL: 2,
  WIFI_UNREACHED: 10,
  WIFI_POOR: 11,
  WIFI_LOW: 12,
  WIFI_HIGH: 13,
  WIFI_EXCELLENT: 14,
  WALL: 255,
  FLOOR: 254,
  NEW_SEGMENT: 253,
  UNKNOWN: 252,
  OBSTACLE_WALL: 251,
};

/**
 * map.py: DreameVacuumMapDecoder._get_pixel_type(map_data, pixel)
 * @param {{version:number, frame_map:boolean, saved_map_status:number}} mapData
 * @param {number} pixel Roh-Byte
 * @returns {[number, boolean]} [pixelType, carpet]
 */
function getPixelType(mapData, pixel) {
  if (mapData.version === 3) {
    const carpet = (pixel & 0x80) !== 0;
    const segment_id = pixel & 0x1f;

    if (segment_id === 0) return [MapPixelType.OUTSIDE, carpet];

    const wall = (pixel >> 5) & 0x03;
    if (wall === 3) return [200 + segment_id, carpet];

    if (segment_id === 31) {
      if (wall > 0) return [MapPixelType.WALL, carpet];
      if (mapData.saved_map_status === 1 || mapData.saved_map_status === 0) {
        return [MapPixelType.NEW_SEGMENT, carpet];
      }
      return [MapPixelType.FLOOR, carpet];
    }

    if (wall > 0) return [100 + segment_id, carpet];

    return [segment_id, carpet];
  }

  if (mapData.frame_map) {
    const carpet = (pixel & 0x03) === 3;
    let segment_id = pixel >> 2;

    if (segment_id > 0 && segment_id < 64) {
      if (segment_id === 63) return [MapPixelType.WALL, carpet];
      if (segment_id === 62) return [MapPixelType.FLOOR, carpet];
      if (segment_id === 61) return [MapPixelType.UNKNOWN, carpet];
      return [segment_id, carpet];
    }

    segment_id = pixel & 0x03;
    // as implemented on the app
    if (segment_id === 1 || segment_id === 3) return [MapPixelType.NEW_SEGMENT, carpet];
    if (segment_id === 2) return [MapPixelType.WALL, carpet];
  } else if (mapData.version === 0) {
    const carpet = (pixel & 0x03) === 3;
    const segment_id = pixel & 0x7f;
    if (segment_id === 1 || segment_id === 3) return [MapPixelType.NEW_SEGMENT, carpet];
    else if (segment_id === 2) return [MapPixelType.WALL, carpet];
  } else {
    const carpet = (pixel & 0x40) === 64;
    const segment_id = pixel & 0x3f;
    if (pixel >> 7) {
      return [segment_id ? 100 + segment_id : MapPixelType.WALL, carpet];
    }

    if (segment_id > 0) {
      if (mapData.saved_map_status === 1 || mapData.saved_map_status === 0) {
        // as implemented on the app
        if (segment_id === 1 || segment_id === 3) return [MapPixelType.NEW_SEGMENT, carpet];
        if (segment_id === 2) return [MapPixelType.WALL, carpet];
        return [MapPixelType.OUTSIDE, false];
      }
      return [segment_id, carpet];
    }
  }

  return [MapPixelType.OUTSIDE, false];
}

/**
 * map.py: DreameVacuumMapDecoder.get_segments(map_data)
 * Baut die Segment-Liste (Raum-ID -> Bounding-Box) aus dem pixel_type-Raster.
 * "100+seg" (Raum-Zelle mit Wand) wird auf die Basis-Raum-ID normalisiert.
 * @param {{pixelType:Int16Array|Array, width:number, height:number, version:number}} m
 */
function getSegments(m) {
  const segments = {};
  const maxSeg = m.version === 3 ? 32 : 64;
  for (let y = 0; y < m.height; y++) {
    for (let x = 0; x < m.width; x++) {
      let segment_id = m.pixelType[m.width * y + x];
      if (segment_id > 100 && segment_id < 200) segment_id = segment_id - 100;

      if (segment_id > 0 && segment_id < maxSeg) {
        if (!segments[segment_id]) {
          segments[segment_id] = { id: segment_id, coords: [x, y, x, y] };
          continue;
        }
        const s = segments[segment_id];
        if (x < s.coords[0]) s.coords[0] = x;
        else if (x > s.coords[2]) s.coords[2] = x;
        if (y < s.coords[1]) s.coords[1] = y;
        else if (y > s.coords[3]) s.coords[3] = y;
      }
    }
  }
  return segments;
}

/**
 * map.py: DreameVacuumMapDecoder.set_segment_color_index — "as implemented on the app".
 * Vergibt 4 Farb-Indizes (0-3): Segmente nach Nachbaranzahl (absteigend, dann ID) sortiert,
 * je Segment die am wenigsten benutzte Farbe, die kein Nachbar traegt.
 * @param {Object} segInf meta.seg_inf ({id:{nei_id:[...]}}), version 1/2 (kein walls_info-Zweig)
 * @returns {Object<number,number>} segment_id -> color_index (0..3)
 */
function setSegmentColorIndex(segInf) {
  if (!segInf) return {};
  const segmentInfo = Object.entries(segInf).map(([k, v]) => [parseInt(k, 10), v && v.nei_id, 0]);
  // _compare_segment_neighbors: mehr Nachbarn zuerst; bei Gleichstand kleinere ID
  segmentInfo.sort((r1, r2) => {
    const alen = r1[1] ? r1[1].length : 0;
    const blen = r2[1] ? r2[1].length : 0;
    if (alen === blen) return r1[0] - r2[0];
    return blen - alen;
  });
  const areaColorIndex = {};
  for (const segment of segmentInfo) {
    const usedIds = [];
    if (segment[1]) {
      for (const nid of segment[1]) {
        if (areaColorIndex[nid] !== undefined) usedIds.push(areaColorIndex[nid]);
      }
    }
    const areaColorNum = [0, 1, 2, 3].map((i) => [i, 0]);
    for (const j of Object.values(areaColorIndex)) areaColorNum[j][1]++;
    // _compare_colors: seltener benutzte zuerst; bei Gleichstand kleinerer Index
    areaColorNum.sort((c1, c2) => (c1[1] !== c2[1] ? c1[1] - c2[1] : c1[0] - c2[0]));
    for (const areaColor of areaColorNum) {
      if (!usedIds.includes(areaColor[0])) { areaColorIndex[segment[0]] = areaColor[0]; break; }
    }
    if (areaColorIndex[segment[0]] === undefined) areaColorIndex[segment[0]] = 0;
  }
  return areaColorIndex;
}

/**
 * map.py: DreameVacuumMapRenderer._check_carpet (Polygon-Teil) — Ray-Casting-Test.
 * @param {number} x Weltkoordinate
 * @param {number} y Weltkoordinate
 * @param {number[]} polygon [x1,y1,x2,y2,...] Weltkoordinaten
 */
function pointInPolygon(x, y, polygon) {
  let check = false;
  const n = polygon.length;
  for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
    const sx = polygon[i], sy = polygon[i + 1];
    const tx = polygon[j], ty = polygon[j + 1];
    if (sx === x && sy === y && tx === x && ty === y) return true;
    if (sy === ty && sy === y && ((sx > x && tx < x) || (sx < x && tx > x))) return true;
    if ((sy < y && ty >= y) || (sy >= y && ty < y)) {
      const xx = sx + ((y - sy) * (tx - sx)) / (ty - sy);
      if (xx === x) return true;
      if (xx > x) check = !check;
    }
  }
  return check;
}

module.exports = { MapPixelType, getPixelType, getSegments, setSegmentColorIndex, pointInPolygon };
