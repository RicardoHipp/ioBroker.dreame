// Zieht die im Widget benutzten Icons aus icons/lucide.min.js und schreibt icons_ui.js.
// Aufruf:  node extractLucide.js
//
// Quelle: Lucide v1.21.0 — ISC License, Copyright (c) for portions of Lucide are held by
// Cole Bemis 2013-2022 as part of Feather (MIT). All other copyright (c) for Lucide are
// held by Lucide Contributors 2022. https://lucide.dev
//
// Warum nicht lucide.min.js direkt einbinden? Die Datei ist ~400 KB fuer knapp 2000 Icons,
// gebraucht wird eine Handvoll. Gleiches Vorgehen wie extractIcons.js bei den HA-Bildern:
// Quelle liegt daneben, ausgeliefert wird nur das Extrakt.
const fs = require('fs');
const L = require('./icons/lucide.min.js');

// Name im Widget -> Name in Lucide. Der linke Name beschreibt die AUFGABE, nicht das Motiv,
// damit ein spaeterer Motivwechsel nur hier stattfindet und nicht im ganzen Widget.
const AUS_LUCIDE = {
  einstellungen: 'Settings',      // Zahnrad: Kopfzeile + Raum-Badge
  zoomEin:       'Plus',
  zoomAus:       'Minus',
  zoomReset:     'RotateCcw',
  start:         'Play',           // derselbe Knopf zeigt je nach Zustand start oder pause
  pause:         'Pause',
  stop:          'Square',
  home:          'House',
  weiter:        'ChevronRight',  // Auswahlzeilen (vorher '›' als CSS-content)
  anAn:          'CircleCheck',   // Ansicht-Schalter ein (vorher '●' in Akzentfarbe)
  anAus:         'Circle',        // Ansicht-Schalter aus (vorher '●' in Grau)
  wasser:        'Droplet',       // Badge: Wassermenge
  wiederholung:  'Repeat',        // Badge: nur wenn > 1
  // --- Zustandsleiste / Verbrauchsmaterial / Behaelter ---
  akku:          'Battery',
  akkuLaedt:     'BatteryCharging',
  hauptbuerste:  'Brush',
  seitenbuerste: 'Fan',           // Sternbuerste, die sich dreht
  filter:        'Filter',
  sensoren:      'Radar',
  raeder:        'CircleDot',
  frischwasser:  'GlassWater',
  schmutzwasser: 'Droplets',
  staubbeutel:   'Trash2',
  mittel:        'FlaskConical',  // Reinigungsmittel
  wischtuch:     'Waves',
  warnung:       'TriangleAlert',
  statistik:     'ChartColumn',
  aufklappen:    'ChevronDown',
};

// Eigene Ableitung: Lucides AirVent zeigt Luft, die AUSstroemt — die beiden Wirbel enden
// offen. Fuer "saugen" bekommen sie oben je eine Pfeilspitze, damit die Richtung stimmt.
// Abgeleitetes Werk auf Basis von AirVent, was die ISC-Lizenz ausdruecklich erlaubt.
const EIGEN = {
  saugen: [
    '<path d="M18 17.5a2.5 2.5 0 1 1-4 2.03v-6"/>',
    '<path d="m12 13.5 2-2 2 2"/>',
    '<path d="M6 12H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/>',
    '<path d="M6 8h12"/>',
    '<path d="M6.6 15.572A2 2 0 1 0 10 17v-5.5"/>',
    '<path d="m8 13.5 2-2 2 2"/>',
  ].join(''),
};

function alsMarkup(def) {
  return def.map(([tag, attr]) =>
    '<' + tag + ' ' + Object.entries(attr).map(([k, v]) => `${k}="${v}"`).join(' ') + '/>'
  ).join('');
}

const raus = {};
for (const [eigen, lucide] of Object.entries(AUS_LUCIDE)) {
  if (!L[lucide]) throw new Error(`Icon "${lucide}" gibt es in lucide.min.js nicht`);
  raus[eigen] = alsMarkup(L[lucide]);
}
Object.assign(raus, EIGEN);

const zeilen = Object.entries(raus).map(([k, v]) => `  ${k}: '${v}',`).join('\n');
fs.writeFileSync(require('path').join(__dirname,'www','icons_ui.js'),
`// Bedien-Icons des Widgets. ERZEUGT von extractLucide.js — nicht von Hand aendern.
// Quelle: Lucide v1.21.0 (ISC) — https://lucide.dev
// "saugen" ist eine eigene Ableitung von Lucides AirVent (Pfeilspitzen an den Wirbeln).
//
// Alle Pfade liegen im Raster 24x24 und erwarten am <svg>: fill="none" stroke="currentColor"
// stroke-width="2" stroke-linecap="round" stroke-linejoin="round".
window.UI_ICONS = {
${zeilen}
};
`);

console.log(`www/icons_ui.js geschrieben — ${Object.keys(raus).length} Icons ` +
            `(${Object.keys(AUS_LUCIDE).length} aus Lucide, ${Object.keys(EIGEN).length} eigen)`);
