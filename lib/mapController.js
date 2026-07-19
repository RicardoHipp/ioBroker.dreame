// Karten-Steuerung des Adapters: alles, was zwischen Geraet, Cloud und States vermittelt.
//
// Abgrenzung zu den Nachbardateien: haDecode.js, haMap.js und mapMerge.js rechnen nur
// (Bytes rein, Karte raus) und kennen den Adapter nicht. Hier steht das Gegenstueck —
// Pakete entgegennehmen, Vollbilder anfordern, Ergebnisse in States schreiben.
//
// Warum ein Klassenrumpf, dessen Methoden angeheftet werden, statt einer eigenen Klasse
// mit `this.adapter.…`: die Methoden stammen unveraendert aus main.js und arbeiten
// durchgehend mit `this.log`, `this.setState`, `this.sendCommand`. Werden sie an den
// Adapter-Prototyp geheftet, ist `this` genau dasselbe wie vorher — die Verschiebung
// aendert damit KEINE einzige Zeile im Rumpf. Ein Umbau auf `this.adapter.…` haette
// hunderte Aenderungen bedeutet, und jede davon waere eine Fehlerquelle gewesen.
//
// Eingehaengt wird in main.js mit:  mapController.einhaengen(Dreame);

const _zlib = require('zlib');
const { MapMerger, readHeader, HEADER_SIZE } = require('./mapMerge');
const { DreameVacuumTaskStatus, deviceStatusFlags } = require('./haMap');
const { getRoomDisplayName } = require('./cleanset');
const { I18n } = require('@iobroker/adapter-core');

// Eigenschaften, an denen in HA das Neuzeichnen der Karte haengt (device.py 435, 500-506).
// Schluessel im Format siid-piid, passend zu PROPERTY_NAME_MAP in main.js.
const PROP_STATE = '2-1'; // HA DreameVacuumProperty.STATE
const PROP_STATUS = '4-1'; // HA DreameVacuumProperty.STATUS
const PROP_TASK_STATUS = '4-7'; // HA DreameVacuumProperty.TASK_STATUS
const PROP_CLEANING_PAUSED = '4-17'; // HA DreameVacuumProperty.CLEANING_PAUSED
const PROP_CUSTOMIZED_CLEANING = '4-26'; // HA DreameVacuumProperty.CUSTOMIZED_CLEANING
const PROP_AUTO_EMPTY_STATUS = '15-5'; // HA DreameVacuumProperty.AUTO_EMPTY_STATUS

// Traeger der Methoden. Wird nie selbst erzeugt — der Rumpf dient nur dazu, die
// Methoden im gleichen Wortlaut aufnehmen zu koennen wie in der Adapter-Klasse.
class MapController {
  // ===== Kartenhilfen: Frame-Diagnose, Eigenschaftsspeicher, Geraetestatus, Neuzeichnen =====
  /**
   * [FRAME-DIAG] Prüft, ob ein base64-Wert ein binärer Dreame-Karten-Frame ist,
   * und loggt Typ (73=I / 80=P), Größe und Dimensionen. Nur zur Analyse.
   */
  _diagFrame(tag, b64) {
    try {
      if (typeof b64 !== 'string' || b64.length < 20) {
        this.log.debug(`[FRAME-DIAG] ${tag}: kein/zu kurzer String (len=${b64 && b64.length})`);
        return;
      }
      let raw;
      try {
        raw = Buffer.from(_zlib.inflateSync(Buffer.from(b64.replace(/-/g, '+').replace(/_/g, '/'), 'base64')));
      } catch (e) {
        this.log.debug(`[FRAME-DIAG] ${tag}: NICHT inflatebar (wohl JSON/cleanset), b64-len=${b64.length}`);
        return;
      }
      if (raw.length < HEADER_SIZE) {
        this.log.debug(`[FRAME-DIAG] ${tag}: inflated, aber < Header (${raw.length})`);
        return;
      }
      const h = readHeader(raw);
      const typeStr = h.frameType === 73 ? 'I-Frame' : h.frameType === 80 ? 'P-Frame' : `? (${h.frameType})`;
      this.log.debug(
        `[FRAME-DIAG] ${tag}: ${typeStr} map=${h.mapId} frame=${h.frameId} ${h.width}x${h.height} grid=${h.gridSize} origin=(${h.originX},${h.originY}) rawLen=${raw.length}`,
      );
    } catch (e) {
      this.log.debug(`[FRAME-DIAG] ${tag}: Fehler ${e.message}`);
    }
  }

  /**
   * Laedt ein Karten-Objekt aus der Cloud und liefert es als base64-zlib-Frame-String
   * (robuste Byte-Erkennung: base64-Text / Rohbytes / Byte-Objekt). null bei Fehler.
   */
  async _downloadMapB64(objName, device) {
    try {
      const url = await this.getFile(objName, device);
      const resp = await this.requestClient({ method: 'get', url }).catch(() => null);
      if (!resp || !resp.data) return null;
      const data = resp.data;
      let buf = null;
      if (Buffer.isBuffer(data)) buf = data;
      else if (data instanceof ArrayBuffer) buf = Buffer.from(data);
      else if (typeof data === 'string') {
        const b1 = Buffer.from(data, 'base64');
        if (b1.length > 2 && b1[0] === 0x78) buf = b1;
        else {
          const b2 = Buffer.from(data, 'latin1');
          if (b2[0] === 0x78) buf = b2;
        }
      } else if (data && typeof data === 'object') {
        const ks = Object.keys(data).filter((k) => /^\d+$/.test(k)).map(Number).sort((a, b) => a - b);
        if (ks.length) buf = Buffer.from(ks.map((k) => data[k]));
      }
      if (buf && buf.length && buf[0] === 0x78) return buf.toString('base64');
    } catch (e) {
      this.log.debug('[MAP] _downloadMapB64: ' + (e && e.message));
    }
    return null;
  }

  /**
   * VSLAM-Geraete (Kamera-Navigation, z.B. Mijia 1C/1T, Dreame F9): die Kartendarstellung
   * dieses Forks ist NUR fuer Lidar-Roboter gebaut und getestet. Fuer VSLAM fehlen bewusst
   * (siehe PORT_STATUS.md, "VSLAM zurueckgestellt"): map_version-0-Auswahl, der
   * Karten-Optimizer (map.py 12503 ff.), die Docked-Ersatzkarte (device.py 3035-3056),
   * der Skalierungsfix (device.py 3274-3282) und die VSLAM-Icons. Ohne Testgeraet wird
   * das nicht blind portiert — erst wenn sich echte Nutzer melden.
   */
  _checkVslamSupport(did, lidarNavigation, model) {
    if (lidarNavigation) return;
    if (!this._vslamErrorShown) this._vslamErrorShown = {};
    if (this._vslamErrorShown[did]) return;
    this._vslamErrorShown[did] = true;
    this.log.error(
      `VSLAM-Geraet erkannt (${model || 'unbekanntes Modell'}): Kamera-/VSLAM-Roboter werden von der ` +
        `Kartendarstellung dieses Adapters nicht unterstuetzt (nicht eingebaut, ungetestet). ` +
        `Bei Interesse bitte ein Issue eroeffnen: https://github.com/RicardoHipp/ioBroker.dreame/issues`,
    );
  }

  /**
   * Eigenschaftsspeicher — Gegenstueck zu HAs `self._properties` im Geraeteobjekt.
   * TA2ks Adapter schreibt MQTT-Werte direkt in States und haelt sie nirgends; HA braucht
   * sie aber synchron und mit Vorgaengerwert, weil mehrere Entscheidungen genau daran
   * haengen (device.py _task_status_changed: `previous_task_status`).
   */
  _propertyChanged(did, siid, piid, value) {
    if (!did || siid == null || piid == null) return;
    const key = `${siid}-${piid}`;
    if (!this._props) this._props = {};
    if (!this._props[did]) this._props[did] = {};
    const previous = this._props[did][key];
    this._props[did][key] = value;
    if (previous === value) return; // HA feuert nur bei echter Aenderung

    // HA device.py 435 + 500-506: genau diese Eigenschaften sind an das Neuzeichnen
    // der Karte gekoppelt. Namen aus unserer Property-Tabelle (siehe oben im File).
    if (key === PROP_TASK_STATUS) {
      this._taskStatusChanged(did, previous, value);
    } else if (key === PROP_STATE || key === PROP_CUSTOMIZED_CLEANING || key === PROP_AUTO_EMPTY_STATUS) {
      // device.py 877-880 _map_property_changed: "Update last update time of the map when a
      // property associated with rendering map changed."
      this._mapPropertyChanged(did, previous);
    }
  }

  /** Aktueller Geraetestatus aus dem Speicher (HA: self.status.* in device.py). */
  _deviceStatus(did) {
    const p = (this._props && this._props[did]) || {};
    const num = (k) => (p[k] != null ? Number(p[k]) : null);
    return { taskStatus: num(PROP_TASK_STATUS), status: num(PROP_STATUS), cleaningPaused: !!num(PROP_CLEANING_PAUSED) };
  }

  /**
   * 1:1-Port von device.py `_map_property_changed` (877-880).
   * HA: "Update last update time of the map when a property associated with rendering map
   * changed." — nur wenn ein Vorgaengerwert existierte.
   */
  _mapPropertyChanged(did, previousProperty) {
    if (!this.mapMerger || previousProperty === undefined) return;
    this.mapMerger.setDeviceStatus(this._deviceStatus(did));
    this._refreshMap(did);
  }

  /**
   * 1:1-Port von device.py `_task_status_changed` (1127-1160, Karten-Teil).
   * HA-Kommentar: "Task status is a very important property and must be listened to trigger
   * necessary actions when a task started or ended".
   *
   * ➖ NICHT portiert: HAs Buchhaltung im selben Block (1159-1215) — cleanup_started/
   * cleanup_completed, Reinigungsverlauf-Trigger, CleanGenius-Wiederherstellung,
   * cleaning_route-Ruecksetzung, Cruise-Point-Behandlung. Das speist HA-Sensoren und
   * -Automationen, nicht die Karte. (In PORT_STATUS.md vermerkt.)
   */
  _taskStatusChanged(did, previousTaskStatus, taskStatus) {
    if (!this.mapMerger || previousTaskStatus === undefined) return;
    const T = DreameVacuumTaskStatus;
    const prev = Number(previousTaskStatus);
    const now = Number(taskStatus);
    this.mapMerger.setDeviceStatus(this._deviceStatus(did));

    const current = this.mapMerger.current;
    if (!current || current.dirty) return; // HA: `if current_map is not None and not current_map.dirty`

    let merged = null;
    if (prev === T.COMPLETED) {
      if (
        now === T.AUTO_CLEANING ||
        now === T.ZONE_CLEANING ||
        now === T.SEGMENT_CLEANING ||
        now === T.SPOT_CLEANING ||
        now === T.CRUISING_PATH ||
        now === T.CRUISING_POINT
      ) {
        // Clear path on current map on cleaning start as implemented on the app
        merged = this.mapMerger.clearPath();
      } else if (now === T.FAST_MAPPING) {
        // Clear current map on mapping start as implemented on the app
        merged = this.mapMerger.resetMap();
      } else {
        merged = this.mapMerger.refresh();
      }
    } else {
      merged = this.mapMerger.refresh();
    }
    if (merged) {
      this.log.debug(`[MERGE] task_status ${prev} -> ${now}: Karte neu gebaut`);
      this._writeMerged(did, merged).catch((e) => this.log.debug('[MERGE] refresh: ' + (e && e.message)));
    }
  }

  /**
   * HAs `refresh_map` nutzt einen 0.2s-Timer als Sammelfenster (map.py 1919-1921), damit
   * mehrere Eigenschaftsaenderungen aus einem MQTT-Paket nur ein Neuzeichnen ausloesen.
   */
  _refreshMap(did) {
    if (this._refreshTimer) clearTimeout(this._refreshTimer);
    this._refreshTimer = setTimeout(() => {
      this._refreshTimer = null;
      if (!this.mapMerger) return;
      const merged = this.mapMerger.refresh();
      if (merged) this._writeMerged(did, merged).catch((e) => this.log.debug('[MERGE] refresh: ' + (e && e.message)));
    }, 200);
  }

  /** Schreibt die gemergte Karte als CloudData-Blob (Format wie dreamehome) in einen State. */
  async _writeMerged(did, mergedB64) {
    if (!mergedB64) return;
    const id = `${did}.map.mergedCloud`;
    await this.setObjectNotExistsAsync(id, {
      type: 'state',
      common: { name: 'Gemergte Live-Karte (CloudData-Format)', type: 'string', role: 'json', read: true, write: false },
      native: {},
    });
    await this.setStateAsync(id, JSON.stringify({ mapstr: [{ id: 0, name: '', angle: '0', map: mergedB64 }], curr_id: 1 }), true);
  }


  // ===== Raum-Einstellungen aus dem cleanset in States schreiben =====

  /**
   * Schreibt die Einstellungen EINES Raums aus dem cleanset in die States.
   * Herausgeloest aus setMapInfos, damit derselbe Code auch beim Nachladen des
   * Karten-Objekts (object_name, siid 6-3) genutzt werden kann — sonst waeren die
   * Raum-Einstellungen nur so aktuell wie der letzte Kartenframe.
   *
   * @param In_path  z.B. "<did>.map."
   * @param key      "cleanset"
   * @param Subkey   Raum-/Segment-ID (der cleanset-Schluessel)
   * @param Subvalue [Level, WaterVolume, Repeat, RoomOrder, CleaningMode, Route]
   */
  async _applyCleansetRoom(In_path, key, Subkey, Subvalue, quelle = 'Kartenframe') {
    const pathMap = In_path + key + '.' + Subkey;
    this.log.debug(`[CLEANSET] Raum ${Subkey} aktualisiert (Quelle: ${quelle}): ${JSON.stringify(Subvalue)}`);
    const _mapDid = In_path.split('.')[0];
    const _areaInfo = this._areaInfoByDid[_mapDid];
    if (!_areaInfo && !this._loggedMissingAreaInfo[_mapDid]) {
      this._loggedMissingAreaInfo[_mapDid] = true;
      this.log.debug(
        `Room names not yet available for device ${_mapDid} - waiting for map data via getMap(). Using generic room numbers until next successful map fetch.`,
      );
    }
    const _roomResult = getRoomDisplayName(Subkey, _areaInfo ? _areaInfo[Subkey] : null);
    let _roomName;
    if (_roomResult.type === 'custom') {
      _roomName = _roomResult.value;
    } else if (_roomResult.type === 'predefined') {
      const _translated = I18n.getTranslatedObject(_roomResult.nameKey);
      if (_roomResult.indexSuffix > 0) {
        _roomName = Object.fromEntries(
          Object.entries(_translated).map(([lang, val]) => [lang, `${val} ${_roomResult.indexSuffix}`]),
        );
      } else {
        _roomName = _translated;
      }
    } else {
      _roomName = _roomResult.value;
    }
    await this.extendObject(pathMap, {
      type: 'channel',
      common: {
        name: _roomName,
      },
      // roomId = echte Raum-/Segment-ID (der cleanset-Schluessel Subkey).
      // Wird beim Schreiben ans Geraet gebraucht; NICHT die RoomOrder (Reihenfolge)
      // verwenden – die kollidiert mit fremden Raum-Schluesseln (Kueche Order 4 =
      // Wohnzimmer Schluessel 4) und schrieb die Aenderung in den falschen Raum.
      native: { roomId: Number(Subkey) },
    });
    //this.log.info(' Long subkey ' + Subvalue.length + ' / ' + Subvalue[3]);
    if (Subvalue.length == 6) {
      if (UpdateCleanset) {
        const did = In_path.split('.')[0];
        const cleansetDevice = this.deviceArray.find((d) => String(d.did) === String(did));
        const isMowerDevice = this.isMower(cleansetDevice);
        for (let i = 0; i < Subvalue.length; i += 1) {
          //1: DreameLevel, 2: DreameWaterVolume, 3: DreameRepeat, 4: DreameRoomNumber, 5: DreameCleaningMode, 6: Route
          //map-req[{"piid": 2,"value": "{\"req_type\":1,\"frame_type\":I,\"force_type\":1}"}]
          let pathMap = In_path + key + '.' + Subkey + '.RoomSettings';
          this.getType(JSON.stringify(Subvalue), pathMap);
          this.setState(pathMap, JSON.stringify(Subvalue), true);
          pathMap = In_path + key + '.' + Subkey + '.RoomOrder';
          this.getType(parseFloat(Subvalue[3]), pathMap);
          this.setState(pathMap, parseFloat(Subvalue[3]), true);
          if (!isMowerDevice) {
            pathMap = In_path + key + '.' + Subkey + '.Level';
            this.setcleansetPath(pathMap, DreameLevel);
            this.setState(pathMap, Subvalue[0], true);
            pathMap = In_path + key + '.' + Subkey + '.CleaningMode';
            this.setcleansetPath(pathMap, DreameCleaningMode);
            this.setState(pathMap, Subvalue[4], true);
            pathMap = In_path + key + '.' + Subkey + '.WaterVolume';
            this.setcleansetPath(pathMap, DreameWaterVolume);
            this.setState(pathMap, Subvalue[1], true);
          }
          pathMap = In_path + key + '.' + Subkey + '.Repeat';
          this.setcleansetPath(pathMap, DreameRepeat);
          this.setState(pathMap, Subvalue[2], true);
          pathMap = In_path + key + '.' + Subkey + '.Route';
          this.setcleansetPath(pathMap, DreameRoute);
          this.setState(pathMap, Subvalue[5], true);
          pathMap = In_path + key + '.' + Subkey + '.Cleaning';
          await this.setcleansetPath(pathMap, DreameRoomClean);
          const Cleanstates = await this.getStateAsync(pathMap);
          if (Cleanstates == null) {
            this.setStateAsync(pathMap, 0, true);
          }
        }
      }
    }
  }

  // ===== Karten-Objekt nachladen und cleanset daraus uebernehmen =====
  /**
   * Laedt das Karten-Objekt hinter einem object_name (siid 6-3) und uebernimmt die darin
   * enthaltenen Raum-Einstellungen (cleanset) in die States.
   *
   * Hintergrund: Aendert man in der App die Einstellung eines Raums, pusht das Geraet sofort
   * einen neuen object_name — die Werte selbst stecken aber im dahinterliegenden Cloud-Objekt
   * (zlib-komprimiertes JSON mit u.a. dem Feld "cleanset"). Ohne dieses Nachladen waeren die
   * Raum-Einstellungen nur so aktuell wie der letzte Kartenframe, der ein cleanset trug —
   * praktisch also nur nach einer Reinigung. HA macht dasselbe (map.py handle_properties ->
   * _add_cloud_map_data).
   *
   * Bewusst NUR das cleanset: Kartendaten (rism, robot, tr, ...) kommen ueber die Live-Frames,
   * der Rest des Objekts sind Statistiken bzw. Felder, die es schon als eigene Properties gibt.
   */
  async _loadCleansetFromObject(objName, device) {
    try {
      const url = await this.getFile(objName, device);
      if (!url) return;
      const res = await this.requestClient({
        method: 'get',
        headers: { Accept: '*/*', 'Accept-Language': 'de-de', Connection: 'keep-alive',
          'User-Agent': 'Dreame_Smarthome/1043 CFNetwork/1240.0.4 Darwin/20.6.0' },
        url,
      });
      const raw = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
      // Objekt ist base64+zlib (Anfang "eF" = 0x78 0x9c)
      let b64 = raw.replace(/-/g, '+').replace(/_/g, '/');
      b64 += '='.repeat((4 - (b64.length % 4)) % 4);
      const inflated = zlib.inflateSync(Buffer.from(b64, 'base64')).toString('latin1');
      await this._applyCleansetFromInflated(inflated, String(device.did), 'Nachladen', objName);
    } catch (e) {
      this.log.debug(`[CLEANSET] Nachladen von ${objName} fehlgeschlagen: ${(e && e.message) || e}`);
    }
  }

  /**
   * Nimmt den ENTPACKTEN Inhalt eines Karten-Objekts und uebernimmt daraus die
   * Raum-Einstellungen (Feld "cleanset") in die States.
   *
   * Getrennt vom Laden, weil derselbe Inhalt an zwei Stellen anfaellt:
   *   - beim object_name-Push (App-Aenderung, siehe _loadCleansetFromObject)
   *   - beim Adapterstart in getMap(), wo das Objekt ohnehin geladen wird
   * Beim Start kommt naemlich kein Push — ohne das blieben Aenderungen, die waehrend
   * der Adapter aus war gemacht wurden, unbemerkt.
   */
  async _applyCleansetFromInflated(inflated, did, quelle, objName = '') {
    const j = inflated.indexOf('{');
    if (j < 0) return 0;
    let obj;
    try {
      obj = JSON.parse(inflated.slice(j));
    } catch (e) {
      return 0;
    }
    if (!obj || obj.cleanset === undefined) return 0;
    // cleanset ist ein JSON-String: {"<raumId>":[Level,Wasser,Wdh,Reihenfolge,Modus,Route], ...}
    const cs = typeof obj.cleanset === 'string' ? JSON.parse(obj.cleanset) : obj.cleanset;
    if (!cs || typeof cs !== 'object') return 0;
    let n = 0;
    for (const [roomId, arr] of Object.entries(cs)) {
      if (!Array.isArray(arr) || arr.length !== 6) continue;
      await this._applyCleansetRoom(`${did}.map.`, 'cleanset', roomId, arr, quelle);
      n++;
    }
    if (n) this.log.debug(`[CLEANSET] ${n} Raeume uebernommen (Quelle: ${quelle}${objName ? ', ' + objName : ''})`);
    return n;
  }


}

/**
 * Heftet die Methoden oben an die Adapter-Klasse. Class-Methoden sind nicht
 * aufzaehlbar, deshalb geht das nicht mit Object.assign, sondern nur ueber
 * getOwnPropertyNames.
 *
 * @param {Function} Klasse  die Adapter-Klasse (main.js: Dreame)
 */
function einhaengen(Klasse) {
  for (const name of Object.getOwnPropertyNames(MapController.prototype)) {
    if (name === 'constructor') continue;
    Klasse.prototype[name] = MapController.prototype[name];
  }
}

module.exports = { einhaengen };
