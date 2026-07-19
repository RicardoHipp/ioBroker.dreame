# Gefundene Fehler im Original-Adapter (TA2k/ioBroker.dreame)

Alle hier gefundenen Fehler stecken auch im Original, nicht nur im Fork. Getestet mit
einem **Dreame X40 Ultra** (`dreame.vacuum.r2449k`), Adapterstand 0.3.24.

Referenz für die Vergleiche: [Tasshack/dreame-vacuum](https://github.com/Tasshack/dreame-vacuum),
die Home-Assistant-Integration für dieselben Geräte.

---

## 1. Es wird nur der erste ausgewählte Raum gereinigt

**Datei:** `main.js`, `_buildCustomRoomCleaningSelects()`

**Fehler:** Im Reinigungsbefehl steht je Raum ein fünftes Feld, das der Adapter als
laufende Nummer füllt (1, 2, 3 …).

```js
selects.push([cbObj.native.roomId, 1, suctionLevel, waterVolume, selectIdx]);
selectIdx++;
```

Bei Geräten, die individuelle Raum-Einstellungen beherrschen, muss dort für **jeden** Raum
eine `1` stehen. HA schreibt dazu ausdrücklich (`device.py` 4696-4698):

```python
[segment_id, max(1, repeat), fan, water, 1 if self.capability.customized_cleaning else index]
##  Sending index other than 1 breaks the operation of 5th gen devices
```

**Beobachtung:** Mit zwei ausgewählten Räumen ging raus

```json
{"selects":[[4,1,1,5,1],[6,1,1,15,2]]}
```

Der Roboter reinigte Raum 4, fuhr danach zur Station und hielt den Auftrag für erledigt.
Raum 6 wurde übersprungen, ohne Fehlermeldung.

**Behebung:** Fähigkeit an der Eigenschaft `4-26` in der Gerätebeschreibung erkennen und
das Feld dann fest auf 1 setzen.

---

## 2. Reinigungsmodus 0 und 2 wirken vertauscht

**Datei:** `lib/specs/cleaning.js` bzw. der Ort, an dem `CLEANING_MODE_ENCODE` /
`CLEANING_MODE_DECODE` angewandt werden

**Fehler:** Der State `remote.cleaning-mode` ist beschriftet mit

```
0 = Staubsaugen | 1 = Wischen | 2 = Staubsaugen + Wischen | 3 = nach dem Saugen wischen
```

Das ist dieselbe Nummerierung wie in HA und für sich richtig. Auf der Leitung tauschen
Geräte mit **anhebbarem Wischmopp** jedoch 0 und 2. Ohne Übersetzung wählt man im
Objektbaum „Staubsaugen" und der Roboter wischt.

HA übersetzt genau an der Schreibstelle (`device.py` 2054-2060):

```python
if self.capability.mop_pad_lifting:
    if cleaning_mode == 2:   values[0] = 0
    elif cleaning_mode == 0: values[0] = 2
    else:                    values[0] = cleaning_mode
```

Beim Lesen entsprechend zurück.

**Fähigkeit erkennen** — HA (`types.py` 3226):

```python
self.mop_pad_lifting = bool(
    self.mop_pad_lifting or self.mop_pad_lifting_plus or self.mop_pad_unmounting
    or (self.self_wash_base and self.auto_empty_base)
)
```

Die letzte Bedingung genügt in der Praxis: Waschstation (`4-25`) **und** Absaugstation
(`15-5`) vorhanden.

**Anmerkung:** Der Kommentar im Adapter zeigt, dass die Sache halb erkannt war —
`value & 3` deckt die zwei Bits solcher Geräte bereits ab, nur die Vertauschung fehlt.

---

## 3. Schalter lassen sich nicht umlegen

**Datei:** `main.js`, Schreibpfad in `onStateChange`

**Fehler:** States vom Typ `boolean` mit der Rolle `switch` werden als `true`/`false`
gesendet. Das Gerät lehnt das ab (`code: -1`) und meldet keinen Fehler nach oben — der
Schalter springt im Objektbaum kommentarlos zurück.

**Nachgewiesen** an `customized-cleaning` (`4-26`):

```
value: true → code -1
value: 1    → code 0
```

**Behebung:** Bei `common.type === 'boolean'` als `1`/`0` senden. Nach der
State-Definition richten, nicht nach dem Laufzeitwert.

---

## 4. Raum-Einstellungen landen im falschen Raum

**Datei:** `main.js`, Verarbeitung der `cleanset`-States

**Fehler:** Zum Zuordnen wird `RoomOrder` benutzt — die Reihenfolge, in der die Räume
gereinigt werden. Gemeint ist aber die Segment-ID des Raums. Beide stimmen nur zufällig
überein.

**Folge:** Ändert man die Saugstärke der Küche, wird sie im Wohnzimmer gesetzt.

**Behebung:** Die echte Segment-ID benutzen (`native.roomId` am Objekt), ersatzweise das
letzte Pfadsegment, das ohnehin der cleanset-Schlüssel ist.

---

## 5. Sentry-Fehlermeldung ohne Wirkung dokumentiert

**Datei:** `README.md`

Kein Fehler im Code, nur ein Hinweis: Die README enthält den Standardabsatz, dass der
Adapter Fehler per Sentry meldet. `io-package.json` enthält zwar einen `plugins.sentry`-
Block, aber der Absatz stammt aus der Vorlage für neue Adapter — er stand schon in der
README, bevor absehbar war, ob die Funktion je benutzt wird. Wer die Datenübertragung
bewerten will, findet dort keine belastbare Aussage.

---

## Hinweis zur Herkunft

Gefunden beim Bau eines Karten-Widgets auf Basis dieses Adapters
(https://github.com/RicardoHipp/ioBroker.dreame). Punkt 1 bis 4 sind dort behoben; die
Änderungen sind klein und lassen sich übernehmen. Alle Vergleichsstellen in der
HA-Integration sind mit Datei und Zeilennummer angegeben, damit sie nachprüfbar sind.
