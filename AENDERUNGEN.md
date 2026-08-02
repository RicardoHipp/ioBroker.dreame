# Änderungen in dieser Fassung

Diese Datei beschreibt, was dieser Build gegenüber dem Original von TA2k
zusätzlich kann — in Alltagssprache, also **was man als Nutzer davon merkt**.

Der Build heißt in der Admin-Oberfläche `0.4.0+fork.1`: alles aus der
Originalversion 0.4.0, plus die unten aufgeführten Punkte. Die technische
Begründung jeder Änderung steht als Kommentar im Code und in der jeweiligen
Commit-Nachricht; hier steht nur, was sich für dich ändert.

Diese Datei gibt es **nur in dieser Fassung**. Die einzelnen Features werden
TA2k jeweils einzeln als Vorschlag angeboten — dort beschreibt sie die
Beschreibung des Vorschlags, nicht diese Datei.

---

## Reinigung: Einstellungen je Raum benutzen

**Was war:** Der Roboter speichert für jeden Raum eigene Einstellungen —
Saugstärke, Feuchtigkeit, wie oft gefahren wird und so weiter. Der Adapter
konnte diese Werte schon lange lesen und schreiben, aber im Widget kam man
nicht an sie heran. Man konnte nur einen Wert für die ganze Wohnung setzen.

**Was jetzt geht:**

* Im Reinigungs-Bereich gibt es oben die neue Auswahl **Reinigung**:
  * **Einheitlich** — ein Wert gilt für alle Räume. So war es bisher.
  * **Individuell pro Raum** — jeder Raum wird nach seinen eigenen,
    gespeicherten Einstellungen gereinigt.

* Steht die Auswahl auf *Individuell pro Raum*, trägt jeder Raum auf der Karte
  ein **Zahnrad** in seiner Info-Blase. Tippt man darauf, öffnen sich die
  Einstellungen genau dieses Raums direkt im Panel — kein Pop-up, das die
  Karte verdeckt. Über den Pfeil links oben geht es zurück.

* Einstellbar je Raum: **Modus** (Saugen, Wischen, Saugen und Wischen),
  **Saugstärke**, **Route**, **Feuchtigkeit** und **Wiederholung** (1× bis 3×).

* Die Info-Blasen auf der Karte zeigen jetzt die Werte des jeweiligen Raums
  statt überall denselben — man sieht also auf einen Blick, wo stärker
  gesaugt oder feuchter gewischt wird. Ändert man etwas, zieht die Blase
  sofort nach.

* Auf die Raumfläche zu tippen wählt den Raum weiterhin nur aus. Nur das
  Zahnrad öffnet die Einstellungen — Auswählen und Einstellen kommen sich
  also nicht in die Quere.

**Wichtig:** Die Einstellungen werden **im Roboter gespeichert**, nicht nur im
Widget. Sie stehen danach genauso in der Dreame-App und bleiben erhalten.
Umgekehrt gilt: Was du in der App je Raum einstellst, siehst du hier.

**Nebenbei behoben:** Sobald man Räume ausgewählt hatte, ließ sich die
Modus-Kachel (Saugen/Wischen/…) nicht mehr bedienen. Das war zu streng —
ein Test mit zwei ausgewählten Räumen und "Wischen" hat beide Räume gewischt,
der Modus gilt also sehr wohl. Die Kachel ist jetzt nur noch im Betrieb
*Individuell pro Raum* gesperrt, denn dort wird der Modus je Raum eingestellt.

**Anzeige:** Beim Wechsel zwischen der normalen Ansicht und den
Raum-Einstellungen bleibt alles an seinem Platz — die Bedienelemente sitzen in
beiden Ansichten an derselben Stelle, und was für den gewählten Modus nicht
gilt (zum Beispiel Feuchtigkeit beim reinen Saugen), wird ausgegraut und mit
"nicht verfügbar" beschriftet statt ausgeblendet. Dadurch springt beim
Umschalten nichts mehr.
