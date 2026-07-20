'use strict';
/**
 * Kurzbefehle ("Shortcuts") fuer Saugroboter — Fork-Erweiterung.
 *
 * Der Adapter konnte Kurzbefehle schon vollstaendig: parseShortcuts() liest die Liste aus
 * Eigenschaft 4-48, dekodiert die Base64-Namen und legt je Kurzbefehl name/running/start
 * an; der Startknopf schickt siid 4, aiid 1 mit piid 1 = 25 und der ID. Beides war nur an
 * `isMower` gebunden. In main.js sind dafuer zwei Zeilen geweitet worden, mehr nicht.
 *
 * Neu ist hier nur, was der Adapter noch nicht hatte: Die Liste in 4-48 enthaelt lediglich
 * ID, Base64-Name und ob der Kurzbefehl laeuft — NICHT, was er tut. Das muss beim Geraet
 * erfragt werden, so wie HA es tut (device.py 5427-5480):
 *
 *     Aktion siid 4 / aiid 8, piid 10 = {"cmd":"GET_COMMAND_BY_ID","params":{"id":<ID>}}
 *
 * Die Antwort ist eine Liste von Teilaufgaben je Kurzbefehl, im selben Aufbau wie die
 * selects-Liste eines Raumreinigungsbefehls.
 */

// Aufbau einer Teilaufgabe, wie HA sie liest (device.py 5459-5470).
// item[0] ist die Segment-ID; die Bedeutung der uebrigen Felder ist dort abgelesen.
const AUFGABE = (item) => ({
  raum: item[0],
  saugstufe: item[1],
  // HA rechnet hier um: 2..4 -> 1..3, sonst 1 (device.py 5466)
  wasser: item[2] > 1 && item[2] < 5 ? item[2] - 1 : 1,
  wiederholungen: item[3],
  modus: item[4],
});

class Kurzbefehle {
  /**
   * Wird aus main.js aufgerufen, sobald Eigenschaft 4-48 hereinkommt.
   * Legt zuerst ueber die vorhandene parseShortcuts() die States an und holt danach die
   * Teilaufgaben nach.
   */
  async _kurzbefehleVacuum(did, value) {
    this.parseShortcuts(did, value);
    try {
      const liste = typeof value === 'string' ? JSON.parse(value) : value;
      if (!Array.isArray(liste) || !liste.length) return;
      for (const sc of liste) {
        if (sc && sc.id != null) await this._kurzbefehlDetails(did, sc.id);
      }
    } catch (e) {
      this.log.debug(`[KURZBEFEHL] Liste nicht lesbar: ${(e && e.message) || e}`);
    }
  }

  /**
   * Kurzbefehle aus dem zuletzt bekannten Wert von status.shortcuts aufbauen.
   *
   * Beim Adapterstart lief bisher gar nichts: Der Haken in main.js sitzt dort, wo das
   * GERAET meldet — und Eigenschaft 4-48 aendert sich fast nie, wird also kaum gepusht.
   * Die Sammelabfrage ueber HTTP liefert fuer Dienst 4 ebenfalls nicht zuverlaessig etwas.
   * Ergebnis: status.shortcuts hatte einen Wert, aber die shortcuts.<id>.*-States fehlten,
   * und der Startknopf schrieb ins Leere.
   */
  async _kurzbefehleNachholen(did) {
    try {
      const st = await this.getStateAsync(`${did}.status.shortcuts`);
      if (!st || st.val == null || st.val === '') {
        this.log.debug('[KURZBEFEHL] noch kein Wert in status.shortcuts');
        return;
      }
      await this._kurzbefehleVacuum(did, st.val);
    } catch (e) {
      this.log.debug(`[KURZBEFEHL] Nachholen fehlgeschlagen: ${(e && e.message) || e}`);
    }
  }

  /**
   * Teilaufgaben EINES Kurzbefehls beim Geraet erfragen und als JSON-State ablegen.
   * Fehlschlaege sind kein Drama: dann fehlt nur die Beschreibung, Name und Start bleiben.
   */
  async _kurzbefehlDetails(did, id) {
    // ID 25 ist bei HA fest die "individuelle Reinigung" und wird nicht abgefragt
    // (device.py 5445-5453) — das Geraet kennt dazu keine Teilaufgaben.
    if (Number(id) === 25) return;
    const pfad = `${did}.shortcuts.${id}.tasks`;
    try {
      const antwort = await this.sendCommand({
        did: did,
        method: 'action',
        params: {
          did: did,
          siid: 4,
          aiid: 8,
          in: [{ piid: 10, value: JSON.stringify({ cmd: 'GET_COMMAND_BY_ID', params: { id: Number(id) } }) }],
        },
      });
      this.log.debug(`[KURZBEFEHL] ${id} Antwort: ${JSON.stringify(antwort)}`);
      const res = antwort && (antwort.result !== undefined ? antwort.result : antwort);
      const out = res && Array.isArray(res.out) ? res.out : null;
      if (!out || !out.length || !out[0] || !out[0].value) {
        this.log.debug(`[KURZBEFEHL] ${id} keine Teilaufgaben in der Antwort`);
        return;
      }
      // Der Wert ist wieder JSON: eine Liste von Aufgaben-Gruppen, je Gruppe eine Liste
      // von Teilaufgaben.
      const roh = JSON.parse(out[0].value);
      const aufgaben = [];
      for (const gruppe of Array.isArray(roh) ? roh : []) {
        for (const item of Array.isArray(gruppe) ? gruppe : []) {
          if (Array.isArray(item) && item.length >= 5) aufgaben.push(AUFGABE(item));
        }
      }
      await this.extendObject(pfad, {
        type: 'state',
        common: {
          name: 'Was der Kurzbefehl tut (Raeume und Einstellungen)',
          type: 'string',
          role: 'json',
          read: true,
          write: false,
        },
        native: {},
      });
      await this.setStateAsync(pfad, JSON.stringify(aufgaben), true);
      this.log.info(`[KURZBEFEHL] ${id}: ${aufgaben.length} Teilaufgabe(n) gelesen`);
    } catch (e) {
      this.log.debug(`[KURZBEFEHL] ${id} Abfrage fehlgeschlagen: ${(e && e.message) || e}`);
    }
  }
}

/** Methoden auf die Adapterklasse legen — gleiches Muster wie lib/mapController.js. */
function einhaengen(Klasse) {
  for (const name of Object.getOwnPropertyNames(Kurzbefehle.prototype)) {
    if (name === 'constructor') continue;
    Klasse.prototype[name] = Kurzbefehle.prototype[name];
  }
}

module.exports = { einhaengen };
