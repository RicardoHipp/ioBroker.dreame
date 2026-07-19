# Änderungen gegenüber dem Original-Adapter

Dieser Adapter ist ein Fork von [TA2k/ioBroker.dreame](https://github.com/TA2k/ioBroker.dreame).
Hier steht in normaler Sprache, **was anders ist und was man davon hat** — nicht auf Code-Ebene.
Technische Details zur Portierung stehen in `PORT_STATUS.md`.

---

## Karte

### Die Karte zeigt jetzt alles, was der Roboter kennt
**Vorher:** Die Karte zeigte im Wesentlichen Wände und Räume. Vieles, was der Roboter
eigentlich mitschickt, wurde beim Einlesen verworfen.
**Jetzt:** Möbel, Teppiche, Sperrzonen, Wischsperren, virtuelle Wände, Türen, Hindernisse,
Raumnamen und Raumfarben werden gelesen und stehen zur Verfügung — dieselben Daten, die auch
die Dreame-App und Home Assistant anzeigen.

### Die Karte läuft live mit, statt zu ruckeln
**Vorher:** Während der Reinigung kam nur ab und zu eine komplette neue Karte.
**Jetzt:** Der Adapter setzt die kleinen Zwischen-Updates des Roboters laufend zusammen.
Die Fahrspur wächst mit, die gereinigte Fläche füllt sich flüssig — wie in der App.

### Die Fahrspur hinkt nicht mehr hinterher
**Vorher:** Der Roboter war auf der Karte schon weiter, die Spur kam verzögert nach.
**Jetzt:** Die aktuelle Position wird an die Spur angehängt, solange der Roboter fährt.
Spur und Roboter passen zusammen.

### Räume, die gerade nicht gereinigt werden, sind grau
**Vorher:** Alle Räume sahen während einer Reinigung gleich aus.
**Jetzt:** Nur die Räume des laufenden Auftrags sind farbig, der Rest ist grau — man sieht
auf einen Blick, was der Roboter gerade abarbeitet. Nach Auftragsende werden alle wieder normal.

### Sperrzonen, Möbel und Roboter sitzen pixelgenau
**Vorher:** Sperrzonen und Möbel lagen ein bis zwei Pixel neben ihrer echten Position.
**Jetzt:** Alles sitzt exakt so wie in der App und in Home Assistant.

### Die Karte friert nicht mehr ein, wenn der Roboter steht
**Vorher:** Sobald der Roboter in der Station stand, kamen keine Kartendaten mehr — der
zuletzt gezeigte Zustand blieb hängen (z. B. blieben Räume grau, obwohl die Reinigung
längst fertig war).
**Jetzt:** Der Adapter merkt sich den Gerätezustand und zeichnet die Karte auch dann neu,
wenn gerade keine neuen Kartendaten kommen.

---

## Bedienung / Fehler behoben

### Schalter lassen sich endlich aus ioBroker heraus umlegen
**Vorher:** Schalter wie „Benutzerdefinierte Reinigung" konnte man in ioBroker zwar
umstellen, am Gerät passierte aber nichts — ohne Fehlermeldung.
**Jetzt:** Sie werden im richtigen Format gesendet und greifen.
*(Betrifft auch das Original; als Fehlerbericht formuliert.)*

### Raum-Einstellungen aus der App sind sofort sichtbar
**Vorher:** Stellte man in der Dreame-App die Einstellung eines Raums um (Saugstärke,
Wassermenge, Saugen/Wischen), blieb der Wert in ioBroker veraltet — teils tagelang. Er
aktualisierte sich erst, wenn der Roboter das nächste Mal tatsächlich gereinigt hat.
Ein Karten-Abruf half nicht.
**Jetzt:** Die Änderung ist innerhalb von Sekunden in ioBroker zu sehen. Der Adapter merkt,
wenn das Gerät neue Einstellungen bereitstellt, und holt sie sich aktiv.
*(Während einer laufenden Reinigung wird bewusst nicht nachgeladen — da kommen die Werte
ohnehin mit den Kartendaten.)*

### Mopp-Trocknung lässt sich starten und beenden
**Vorher:** Für die Mopp-Trocknung gab es keinen Schalter. Man konnte sie weder anstoßen
noch abbrechen — der vorhandene Knopf „Mopp waschen" löste immer einen Waschgang aus,
auch wenn man eigentlich trocknen wollte.
**Jetzt:** Zwei neue Schalter unter `remote`: „Start Mop Drying" und „Stop Mop Drying".
Praktisch vor allem der zweite, denn die Trocknung startet nach jedem Waschgang von
selbst und läuft lange — jetzt kann man sie vorzeitig beenden.
*(Hintergrund: Der Roboter kennt für Waschen und Trocknen nur einen einzigen Befehl und
unterscheidet sie über einen Zusatzwert. Ohne die neuen Schalter ließ sich dieser
Zusatzwert gar nicht mitschicken.)*

### Raum-Einstellungen landen im richtigen Raum
**Vorher:** Änderte man die Einstellung eines Raums (Saugstärke, Wasser, Modus), wurde
teilweise ein **anderer** Raum verstellt — z. B. Änderung an der Küche landete im Wohnzimmer.
**Jetzt:** Die Einstellung geht an den Raum, den man auch gemeint hat.
*(Betrifft auch das Original; als Fehlerbericht formuliert.)*

### Menüs lassen sich auch mit dem Finger öffnen
**Vorher:** Auf dem Tablett blitzte das Stationsmenü beim Antippen nur kurz auf und war
sofort wieder weg. Mit der Maus am PC ging es.
**Jetzt:** Es bleibt offen. Außerdem ist die Fläche über der Ladestation größer geworden
und wächst mit der eingestellten Anzeigegröße mit, und ein Antippen wird nicht mehr als
Verschieben der Karte gewertet, wenn der Finger dabei ein paar Pixel verrutscht.

### Die Karte lässt sich drehen
**Jetzt:** Im Zahnrad-Menü gibt es **Karte drehen** mit 0°, 90°, 180° und 270°. Nützlich,
wenn die Karte auf einem Wandtablett anders herum stehen soll, als der Roboter sie liefert.

**Die Raumnamen und die Symbole an den Räumen drehen sich nicht mit** — sie bleiben immer
waagerecht lesbar. Der Roboter dreht sich dagegen mit, sonst zeigte seine Fahrtrichtung
in die falsche Richtung.

### Farben und Hintergrund lassen sich einstellen
**Vorher:** Hell oder dunkel richtete sich immer nach dem Gerät, der Hintergrund war
immer gefüllt.
**Jetzt:** Im Zahnrad-Menü gibt es **Farben** (Automatisch, Hell, Dunkel) und
**Hintergrund** (Gefüllt, Transparent). Transparent heißt: der Hintergrund der VIS-Seite
scheint durch, nur Dialoge, Kacheln und die Karte selbst bleiben deckend.

Beides merkt sich jedes Gerät für sich, wie schon die Anzeigegröße.

Wer das Widget in VIS **mehrfach** einbetten will — etwa hell in einer Ansicht und dunkel
in einer anderen — kann die Einstellungen an die Adresse hängen. Dafür gibt es unten im
Zahnrad-Menü den aufklappbaren Punkt „Adresse mit diesen Einstellungen" mit einer fertigen
Adresse zum Kopieren. Werte in der Adresse haben Vorrang vor den gespeicherten.

### Mehr Platz für die Karte
**Vorher:** Über der Karte lag eine Titelzeile, die nur den Namen des Widgets zeigte.
**Jetzt:** Die Zeile ist weg, die Karte bekommt die Höhe. Der Name des Roboters steht
links oben auf der Karte, der Verbindungszustand rechts oben, und das Zahnrad für die
Einstellungen sitzt rechts neben der Überschrift „Reinigung".

### Die Bedienung lässt sich größer stellen
**Vorher:** Menü, Regler und die Beschriftungen auf der Karte hatten eine feste Größe.
Auf einem Tablett an der Wand war das zu klein zum Treffen.
**Jetzt:** Im Zahnrad-Menü gibt es **Anzeigegröße** mit den Stufen 100 bis 200 %. Größer
werden die rechte Spalte, die Kopfzeile, die Dialoge und die Beschriftungen an den Räumen —
samt der Flächen, auf die man tippt.

Die Karte selbst bleibt davon unberührt: die zoomt man weiter mit den Fingern, und beim
Öffnen ist sie wie bisher ganz zu sehen.

Die Einstellung merkt sich jedes Gerät für sich. Das Tablett kann also auf 150 % stehen,
während der Rechner bei 100 % bleibt.

### Verbrauchsmaterial und Meldungen stehen neben der Karte
**Vorher:** Rechts standen nur die Koordinaten von Roboter und Ladestation — Zahlen, die
im Alltag niemand braucht.
**Jetzt:** Dort steht, wie viel von Hauptbürste, Seitenbürste, Filter und Sensoren noch
übrig ist, als Balken mit Prozentwert. Unter 20 % wird der Balken gelb, unter 10 % rot —
man sieht also im Vorbeigehen, was demnächst fällig ist.

Darüber erscheinen Meldungen, aber **nur wenn wirklich etwas anliegt**: voller
Schmutzwassertank, leerer Frischwassertank, voller Staubbeutel, fehlendes Reinigungsmittel,
Gerätefehler. Ist alles in Ordnung, sieht man dort nichts.

Ganz unten lässt sich die Statistik aufklappen: Anzahl der Reinigungen, gesamte Fläche,
gesamte Dauer und das Datum der ersten Reinigung.

Angezeigt wird immer nur das, was der eigene Roboter auch meldet. Geräte mit Wischwalze,
Silberionen-Modul oder Abstreifer bekommen ihre Zeilen automatisch dazu.

### Die Zoom-Knöpfe auf der Karte reagieren
**Vorher:** Die drei Knöpfe unten rechts (+, −, Ansicht zurücksetzen) taten nichts.
Zoomen ging nur mit dem Mausrad, und die Ansicht ließ sich gar nicht zurücksetzen.
**Jetzt:** Alle drei funktionieren — auch mit dem Finger.

---

## Bekannte Einschränkungen

### Ältere Roboter ohne Laser (VSLAM) werden nicht unterstützt
Geräte, die per Kamera statt per Laser navigieren (z. B. Mijia 1C/1T, Dreame F9), werden
von der Kartendarstellung dieses Forks **nicht** unterstützt. Statt einer falschen Karte
kommt eine klare Fehlermeldung ins Log. Grund: Für diese Geräte fehlt uns ein Testgerät —
blind gebaut würde es niemandem helfen.

### „Wischen nach Saugen" geht nur für alle Räume gemeinsam
Das ist keine Einschränkung des Adapters, sondern des Roboters: Pro Raum kann man nur
Saugen, Wischen oder beides gleichzeitig wählen. „Erst alles saugen, dann alles wischen"
ist ein Ablauf für die ganze Wohnung.

---

## In Arbeit

- **Bedienung der Raumreinigung im Karten-Widget:** Räume anklicken und je Raum festlegen,
  wie gereinigt wird (Saugen/Wischen, Wassermenge). Konzept steht, Umsetzung offen.

---

## Hinweis für Einträge in dieser Datei

Jeder neue Eintrag beschreibt **was der Nutzer merkt**, nicht wie es gebaut ist:
- Überschrift = der Nutzen oder das behobene Ärgernis, in normaler Sprache
- **Vorher:** / **Jetzt:** — was war das Problem, was ist jetzt anders
- Fachbegriffe nur, wenn sie im ioBroker-Objektbaum wirklich so heißen

Technische Details (welche HA-Funktion portiert wurde, welche Zeilen, was noch fehlt)
gehören nach `PORT_STATUS.md`, nicht hierher.
