// Extrahiert die Roboter-/Ladestation-Icons aus HAs resources.py (base64-PNGs)
// und schreibt sie als www/icons.js fuer das Karten-Widget.
// Quelle: dreame-vacuum (Tasshack, MIT) — dreame/resources.py
//
// Die Moebelbilder gehen NICHT als base64 mit, sondern als einzelne, verkleinerte
// PNG-Dateien nach www/furniture/. Begruendung siehe unten beim Moebel-Teil.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const SRC = '../HA_Dreame/custom_components/dreame_vacuum/dreame/resources.py';
const WWW = path.join(__dirname, 'www');
const src = fs.readFileSync(SRC, 'utf8');

function grab(name) {
  const i = src.indexOf(name);
  if (i < 0) return null;
  const q1 = src.indexOf('"', i);
  if (q1 < 0) return null;
  const q2 = src.indexOf('"', q1 + 1);
  if (q2 < 0) return null;
  return src.slice(q1 + 1, q2);
}

// Dreame-Icon-Set, helles Theme (unser X40 = Lidar-Roboter) + Zustands-Badges
const WANT = {
  ROBOT: 'MAP_ROBOT_LIDAR_IMAGE_DREAME_LIGHT',
  CHARGER: 'MAP_CHARGER_IMAGE_DREAME',
  ST_CLEANING: 'MAP_ROBOT_CLEANING_IMAGE',
  ST_CHARGING: 'MAP_ROBOT_CHARGING_IMAGE',
  ST_WARNING: 'MAP_ROBOT_WARNING_IMAGE',
  ST_SLEEPING: 'MAP_ROBOT_SLEEPING_IMAGE',
  ST_WASHING: 'MAP_ROBOT_WASHING_IMAGE',
  ST_DRYING: 'MAP_ROBOT_DRYING_IMAGE',
  // Stations-Zustaende, die HA ebenfalls anzeigt (map.py 10908-10996)
  ST_EMPTYING: 'MAP_ROBOT_EMPTYING_IMAGE',
  ST_HOT_WASHING: 'MAP_ROBOT_HOT_WASHING_IMAGE',
  ST_HOT_DRYING: 'MAP_ROBOT_HOT_DRYING_IMAGE',
  ST_DUST_BAG_DRYING: 'MAP_ROBOT_DUST_BAG_DRYING_IMAGE',
};

const out = [];
out.push('// HA-Icons (Dreame-Set, hell) — extrahiert aus dreame-vacuum resources.py');
out.push('// Copyright (c) 2022 Tasshack — MIT License. Erzeugt von extractIcons.js.');
out.push('window.HA_ICONS = {');
for (const [key, name] of Object.entries(WANT)) {
  const b64 = grab(name);
  if (!b64) { console.log(name, '-> nicht gefunden'); continue; }
  const buf = Buffer.from(b64, 'base64');
  const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
  console.log(name.padEnd(36), '->', key, `${w}x${h}`, '| b64:', b64.length);
  out.push(`  ${key}: 'data:image/png;base64,${b64}',`);
}
out.push('};');
const icoPath = path.join(WWW, 'icons.js');
fs.writeFileSync(icoPath, out.join('\n') + '\n');
console.log('www/icons.js geschrieben:', fs.statSync(icoPath).size, 'Bytes');

// --- Moebel-Bilder: FURNITURE_TYPE_TO_IMAGE -> einzelne PNG-Dateien ---
//
// HA haelt diese Bilder als base64 in resources.py, weil es die Karte SERVERSEITIG
// rendert — die Einzelbilder verlassen den Server nie. Wir zeichnen im Browser, also
// muss jedes Byte ueber die Leitung. Als base64-Skript waeren das 1,5 MB bei jedem
// Seitenaufruf, auch fuer die Moebeltypen, die in der Wohnung gar nicht vorkommen.
//
// Deshalb: je Typ eine Datei, die der Browser einzeln (und zwischengespeichert) laedt.
// Zusaetzlich verkleinert — die Originale sind bis 1632x1322 Pixel gross, dargestellt
// werden sie mit wenigen Dutzend bis einigen hundert Pixeln.
const MAX_KANTE = 400;
const fStart = src.indexOf('FURNITURE_TYPE_TO_IMAGE');
const fBlock = src.slice(fStart, src.indexOf('\n}', fStart));
const furnDir = path.join(WWW, 'furniture');
fs.mkdirSync(furnDir, { recursive: true });
for (const alt of fs.readdirSync(furnDir)) if (alt.endsWith('.png')) fs.unlinkSync(path.join(furnDir, alt));

const re = /(\d+):\s*"([A-Za-z0-9+/=]+)"/g;
let m, count = 0;
while ((m = re.exec(fBlock))) {
  fs.writeFileSync(path.join(furnDir, `${m[1]}.png`), Buffer.from(m[2], 'base64'));
  count++;
}

// Verkleinern mit Python/Pillow. Bewusst KEIN npm-Paket dafuer: sharp & Co. bringen
// plattformabhaengige Binaerdateien mit, und das hier ist ein reines Build-Werkzeug.
// Fehlt Pillow, bleiben die Originale liegen — das Widget funktioniert trotzdem.
const py = `
import glob, os
from PIL import Image
ges = 0
for f in glob.glob(os.path.join(r'${furnDir.replace(/\\/g, '\\\\')}', '*.png')):
    im = Image.open(f)
    if max(im.size) > ${MAX_KANTE}:
        im.thumbnail((${MAX_KANTE}, ${MAX_KANTE}), Image.LANCZOS)
    im.save(f, 'PNG', optimize=True)
    ges += os.path.getsize(f)
print(round(ges / 1024))
`;
let kb = null;
try {
  kb = execFileSync('python', ['-c', py], { encoding: 'utf8' }).trim();
} catch (e) {
  console.log('  Hinweis: Verkleinern uebersprungen (Python/Pillow nicht verfuegbar) —', e.message.split('\n')[0]);
}
console.log(`www/furniture/: ${count} PNG-Dateien${kb ? `, zusammen ${kb} KB (max ${MAX_KANTE} px)` : ' (unverkleinert)'}`);
