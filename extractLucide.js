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
  // Die Reinigungsrouten stehen weiter unten unter EIGEN — dafuer gibt es weder in Lucide
  // noch in HAs Material-Icons etwas Brauchbares, s. Kommentar dort.
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

// --- Reinigungsrouten: aus icons/routen/*.svg ---
// Vorbild ist die Dreame-App, nicht HA. HA nimmt Sinnbilder (select.py 168-173:
// Wellenlinie, Doppelpfeil, Heizspirale, Lieferwagen). Die App zeigt stattdessen das
// FAHRMUSTER selbst — je gruendlicher die Route, desto enger die Bahnen —, und das ist
// ohne Beschriftung lesbar. Die vier Vorlagen wurden dafuer nachgezeichnet (Inkscape).
//
// Die Pfaddaten werden bewusst NICHT umgeschrieben: sie wandern unveraendert ins Ergebnis,
// davor kommt nur ein <g transform> aus Verschiebung und Massstab. Ein frueherer Versuch
// hat die Pfade zerlegt und neu zusammengesetzt (Teilpfade trennen, Zahlen runden,
// relativ->absolut) — dabei gingen Formen kaputt. Geparst wird hier nur zum MESSEN;
// ein Messfehler aendert die Groesse, nicht die Form.
//
// Anders als die Lucide-Icons sind das FLAECHEN, keine Striche. Sie brauchen am <svg>
// fill="currentColor" statt stroke — siehe svgIkon()/uiIcon() im Widget.
const ROUTEN = { routeSchnell: 'schnell', routeStandard: 'standard',
                 routeIntensiv: 'intensiv', routeTief: 'tief' };
const RAND = 1.5;   // Luft ringsum im 24er-Raster

function pfadBbox(d) {
  const tok = d.match(/[A-Za-z]|-?\d*\.?\d+(?:[eE][-+]?\d+)?/g) || [];
  const ARG = { m:2, l:2, h:1, v:1, c:6, s:4, q:4, t:2, a:7, z:0 };
  let x = 0, y = 0, sx = 0, sy = 0, cur = 'm', i = 0;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  const P = (px, py) => { minX = Math.min(minX, px); maxX = Math.max(maxX, px);
                          minY = Math.min(minY, py); maxY = Math.max(maxY, py); };
  while (i < tok.length) {
    if (/[A-Za-z]/.test(tok[i])) {
      cur = tok[i]; i++;
      if (cur.toLowerCase() === 'z') { x = sx; y = sy; continue; }
      if (i >= tok.length) break;
    }
    const n = ARG[cur.toLowerCase()];
    if (!n) { i++; continue; }
    const a = []; for (let k = 0; k < n; k++) a.push(parseFloat(tok[i++]));
    const rel = cur === cur.toLowerCase(), C = cur.toUpperCase();
    if (C === 'M') { x = rel ? x+a[0] : a[0]; y = rel ? y+a[1] : a[1]; sx = x; sy = y; P(x, y);
                     cur = rel ? 'l' : 'L'; }          // weitere Paare nach m sind lineto
    else if (C === 'L' || C === 'T') { x = rel ? x+a[0] : a[0]; y = rel ? y+a[1] : a[1]; P(x, y); }
    else if (C === 'H') { x = rel ? x+a[0] : a[0]; P(x, y); }
    else if (C === 'V') { y = rel ? y+a[0] : a[0]; P(x, y); }
    else if (C === 'C') { P(rel ? x+a[0] : a[0], rel ? y+a[1] : a[1]);
                          P(rel ? x+a[2] : a[2], rel ? y+a[3] : a[3]);
                          x = rel ? x+a[4] : a[4]; y = rel ? y+a[5] : a[5]; P(x, y); }
    else if (C === 'S' || C === 'Q') { P(rel ? x+a[0] : a[0], rel ? y+a[1] : a[1]);
                          x = rel ? x+a[2] : a[2]; y = rel ? y+a[3] : a[3]; P(x, y); }
    else if (C === 'A') { x = rel ? x+a[5] : a[5]; y = rel ? y+a[6] : a[6]; P(x, y); }
  }
  return { minX, maxX, minY, maxY };
}

// Erst alle vier einlesen und vermessen, dann erst umrechnen: der Massstab wird gemeinsam
// festgelegt (s.u.), dafuer muessen alle Groessen vorliegen.
const gemessen = {};
for (const [name, datei] of Object.entries(ROUTEN)) {
  const pfad = require('path').join(__dirname, 'icons', 'routen', datei + '.svg');
  const svg = fs.readFileSync(pfad, 'utf8');
  const treffer = [...svg.matchAll(/<path\b[\s\S]*?\/>/g)];
  if (treffer.length !== 1) throw new Error(`${datei}.svg: ${treffer.length} Pfade, erwartet genau 1`);
  const d = treffer[0][0].match(/d="([^"]*)"/)[1];
  const b = pfadBbox(d);
  gemessen[name] = { d, b, w: b.maxX - b.minX, h: b.maxY - b.minY };
}

const feld = 24 - 2 * RAND;
// EIN gemeinsamer Massstab fuer alle vier, abgeleitet vom groessten (den gerahmten).
// Frueher wurde jedes Icon einzeln auf die Kastengroesse hochgerechnet — dann erscheinen
// die Bahnen bei "Schnell" viel groesser als bei "Standard", obwohl es dieselben sind:
// ohne Rahmen ist die Form kleiner und wurde staerker vergroessert.
const massstab = Math.min(...Object.values(gemessen).map((g) => feld / Math.max(g.w, g.h)));

for (const [name, g] of Object.entries(gemessen)) {
  const s = massstab;
  const dx = RAND + (feld - g.w * s) / 2 - g.b.minX * s;   // in beiden Achsen zentriert
  const dy = RAND + (feld - g.h * s) / 2 - g.b.minY * s;
  EIGEN[name] = `<g transform="translate(${+dx.toFixed(4)} ${+dy.toFixed(4)}) scale(${+s.toFixed(6)})">`
              + `<path d="${g.d}"/></g>`;
}

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
