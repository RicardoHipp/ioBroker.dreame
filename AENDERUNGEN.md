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

### Die Raum-Angaben lassen sich während der Reinigung wegklicken
**Jetzt:** Läuft eine Reinigung, erscheint oben auf der Karte rechts neben dem Namen des
Roboters ein kleiner Knopf mit einem Auge. Damit blendet man die Angaben an den Räumen aus,
wenn man die Karte selbst sehen will; nochmal drücken bringt sie zurück. Nach dem Auftrag
verschwindet der Knopf wieder, und die Angaben sind automatisch wieder da.

### Die Reihenfolge der Räume ist die, in der man sie antippt
**Vorher:** Die gewählten Räume gingen nach ihrer internen Nummer sortiert an den Roboter —
in welcher Reihenfolge man sie angetippt hatte, spielte keine Rolle.
**Jetzt:** Der Roboter bekommt sie in genau der Reihenfolge, in der du sie ausgewählt hast.
Am Raum steht die Nummer in einem farbigen Kreis, du siehst also vorher, wie er fahren
wird. Tippst du einen Raum ab und wieder an, rutscht er ans Ende.

### Es werden wieder alle gewählten Räume gereinigt
**Vorher:** Wählte man mehrere Räume aus, fuhr der Roboter nur in den ersten und danach
zurück zur Station. Die übrigen wurden übersprungen — ohne Fehlermeldung.
**Jetzt:** Alle gewählten Räume werden abgearbeitet.

*(Ursache: Im Reinigungsbefehl steht je Raum ein fünftes Feld, das wie eine laufende
Nummer aussieht. Bei neueren Geräten muss dort aber überall eine 1 stehen — ein anderer
Wert bringt den Ablauf durcheinander. Betrifft auch das Original; als Fehlerbericht
formuliert.)*

### Saug- und Wischwege sind auf der Karte zu unterscheiden
**Vorher:** Die gefahrene Spur war überall eine gleich dünne Linie — ob der Roboter an
einer Stelle gesaugt oder gewischt hat, war nicht zu sehen.
**Jetzt:** Wie in der App und in Home Assistant: Gesaugte Strecken sind eine dünne Linie,
gewischte ein breiter, halbdurchsichtiger Balken. Wo beides gemacht wurde, liegt die dünne
Linie auf dem Balken. Der Balken endet an den Raumgrenzen, statt über Wände zu laufen.

### Raum-Einstellungen zeigen nur, was der Modus hergibt
**Vorher:** Im Fenster eines Raums ließen sich Saugstärke und Wassermenge immer
verstellen, auch wenn der Raum-Modus sie gar nicht nutzt. Eine Route gab es dort nicht.
**Jetzt:** Steht der Raum auf „Wischen", ist die Saugstärke gar nicht mehr da; steht er
auf „Saugen", fehlt die Wassermenge. Neu ist die **Route** — sie erscheint nur beim reinen
Wischen, denn nur dort wertet der Roboter sie je Raum aus. Zur Auswahl stehen Standard,
Intensiv und Tief; „Schnell" gibt es nur für die gesamte Reinigung, nicht je Raum.
Im Fenster steht also immer nur das, was für diesen Raum auch wirklich zählt.

Am Raum in der Karte erscheint die Route zusätzlich als Symbol. Die Zeichen zeigen — wie in
der App — das Fahrmuster selbst: je gründlicher die Route, desto enger die Bahnen. Auch das
nur bei Räumen, die ausschließlich gewischt werden.

### Die Route lässt sich einstellen
**Vorher:** Die Route aus der App (Schnell, Standard, Intensiv, Tief) gab es im Widget
nicht — man musste dafür in die App wechseln.
**Jetzt:** Es gibt eine eigene Kachel neben dem Modus. Sie zeigt immer, was am Gerät
eingestellt ist, und lässt sich auch während einer laufenden Reinigung ändern.
Angeboten wird nur, was zum Modus passt: „Intensiv" und „Tief" sind Wisch-Stufen und
tauchen beim reinen Saugen gar nicht erst auf. Fällt die eingestellte Route durch einen
Moduswechsel weg, springt sie auf Standard zurück — aber nur, wenn gerade nichts läuft.

### Saugstärke und Wassermenge wirken jetzt wirklich
**Vorher:** Die eingestellten Werte gingen nur im Startbefehl mit — dort steht je Raum ein
eigener Wert. Im einheitlichen Betrieb nimmt der Roboter davon aber nur einen einzigen und
wendet ihn auf alles an. Verstellte man die Kachel, passierte dadurch praktisch nichts.
**Jetzt:** Der Wert geht sofort ans Gerät, sobald man ihn ändert — genau wie der
Reinigungsmodus und genau wie in der App.

### Ausgegraut ist nur noch, was wirklich nicht geht
**Vorher:** Saugstärke und Wassermenge ließen sich nur anklicken, wenn vorher ein Raum
ausgewählt war — ohne Auswahl waren sie grau, ohne dass ersichtlich war, warum. Während
einer laufenden Reinigung waren sie ebenfalls gesperrt, während „Reinigung" und „Modus"
anklickbar blieben, also genau verkehrt herum.
**Jetzt:** Saugstärke und Wassermenge sind immer bedienbar — sie sind Geräteeinstellungen
und gelten auch ohne Auftrag, genau wie in der App. Während einer Fahrt wirken sie sofort
auf den laufenden Auftrag. Gesperrt ist nur noch, was der Modus nicht nutzt (keine
Wassermenge beim reinen Saugen) und was mitten im Auftrag nicht mehr sinnvoll ist:
Betriebsart und Modus legen fest, was für ein Auftrag unterwegs ist, und der Roboter
würde eine Änderung ohnehin erst beim nächsten Mal anwenden.

### Räume heißen so, wie man sie in der App genannt hat
**Vorher:** Räume ohne zugewiesenen Raumtyp hießen im Widget alle gleich, nämlich schlicht
„Raum" — bei mehreren neuen Räumen konnte man sie nicht auseinanderhalten. Ein selbst
vergebener Name wie „Esszimmer1" tauchte gar nicht auf.
**Jetzt:** Ein in der App vergebener Name wird angezeigt. Hat der Raum keinen eigenen
Namen, steht dort „Raum 8", „Raum 9" — also mit Nummer. Und gibt es mehrere Räume
desselben Typs, werden sie durchnummeriert: „Badezimmer" und „Badezimmer 2".

### Fehlermeldungen stehen im Klartext
**Vorher:** Bei einer Meldung des Roboters stand nur „Fehler 68" — nachschlagen musste man
selbst.
**Jetzt:** Dort steht, worum es geht, zum Beispiel „Wischpad demontieren" oder „Der
Frischwassertank ist nicht installiert". Die Texte sind unverändert aus der
Home-Assistant-Integration übernommen, damit sie zu dem passen, was andere Werkzeuge
anzeigen.

Außerdem wird unterschieden: Ein Teil der Meldungen ist gar kein Defekt, sondern nur ein
Hinweis. Die erscheinen gelb, echte Störungen rot.

Und Meldungen, die für das eigene Gerät gar nicht gelten, werden ganz weggelassen — etwa
die Erinnerung „Wischpad demontieren" bei Robotern mit Waschstation, die das Pad ja selbst
waschen und trocknen. Ebenso „Akku leer", solange der Roboter gerade lädt.

Eine Meldung ist außerdem neu übersetzt: Home Assistant zeigt nach dem Wischen „bitte das
Wischpad reinigen". Im englischen Original steht dort aber *washboard* — gemeint ist das
Waschbrett in der Station, nicht das Pad. Bei uns steht deshalb „Das Waschbrett des
Wischmopps reinigen".

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

### Bei einheitlicher Reinigung gilt ein Wert für alle Räume
Stellt man Saugstärke oder Wassermenge ein, gilt der Wert für alle gewählten Räume — auch
im gesendeten Reinigungsbefehl steht überall dieselbe Zahl. Unterschiedliche Werte je Raum
gibt es nur unter „Individuell pro Raum"; dann nutzt der Roboter das, was am Raum
gespeichert ist.

Getestet ist das an einem X40 Ultra: Dort wurden zwei Räume, denen ausdrücklich
verschiedene Saugstufen mitgegeben wurden, hörbar gleich gesaugt. Dieselbe Beobachtung
gibt es in der Home-Assistant-Integration (Issue #675) und im ioBroker-Forum. Dort wird
allerdings vermutet, dass es nicht alle Modelle betrifft.

Sollte dein Roboter unterschiedliche Werte je Raum tatsächlich umsetzen, bekommst du diese
Möglichkeit im Widget trotzdem nicht — was fehlt, ist die Zwischenform „einmalig anders,
ohne es zu speichern". Die bietet die Dreame-App selbst auch nicht an. Der Weg dorthin ist
„Individuell pro Raum" plus die Einstellungen am jeweiligen Raum.

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
