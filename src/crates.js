// Lectura de CRATES de Serato (grupos curados por el DJ)
// Los crates viven en ~/Music/_Serato_/Subcrates/*.crate (y Crates/ en versiones viejas).
// Formato binario tipo "tag(4) + len(uint32 BE) + payload". Cada track es un chunk 'otrk'
// que dentro tiene 'ptrk' con la RUTA del archivo en UTF-16 BE.
// Todo va envuelto en try/catch: si algo falla, devolvemos estructuras vacías.
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const HOME = os.homedir();
const CONFIG_FILE = path.join(HOME, '.trackai', 'config.json');

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch (_) {}
  return {};
}

function findCratesDirs() {
  const cfg = loadConfig();
  const validDirs = [];

  if (cfg.customSeratoCratesDir && fs.existsSync(cfg.customSeratoCratesDir)) {
    validDirs.push(cfg.customSeratoCratesDir);
  }

  if (cfg.customSeratoDbPath) {
    const dbDir = path.dirname(cfg.customSeratoDbPath);
    const seratoDir = path.dirname(dbDir);
    const sub1 = path.join(seratoDir, 'Subcrates');
    const sub2 = path.join(path.dirname(seratoDir), '_Serato_', 'Subcrates');
    
    if (fs.existsSync(sub1) && !validDirs.includes(sub1)) validDirs.push(sub1);
    if (fs.existsSync(sub2) && !validDirs.includes(sub2)) validDirs.push(sub2);
  }

  const candidates = [
    path.join(HOME, 'Music', '_Serato_', 'Subcrates'),
    path.join(HOME, 'Music', '_Serato_', 'Crates'),
    path.join(HOME, 'Google Drive', '_Serato_', 'Subcrates'),
    path.join(HOME, 'Google Drive', 'Mi unidad', '_Serato_', 'Subcrates'),
    path.join(HOME, 'My Drive', '_Serato_', 'Subcrates'),
  ];

  try {
    const cloudDir = path.join(HOME, 'Library', 'CloudStorage');
    if (fs.existsSync(cloudDir)) {
      const items = fs.readdirSync(cloudDir);
      for (const item of items) {
        if (item.startsWith('GoogleDrive-') || item.startsWith('OneDrive-') || item.startsWith('Dropbox')) {
          const driveBase = path.join(cloudDir, item);
          candidates.push(path.join(driveBase, 'My Drive', '_Serato_', 'Subcrates'));
          candidates.push(path.join(driveBase, 'Mi unidad', '_Serato_', 'Subcrates'));
          candidates.push(path.join(driveBase, '_Serato_', 'Subcrates'));
        }
      }
    }
  } catch (_) {}

  if (process.platform === 'darwin') {
  try {
    if (fs.existsSync('/Volumes')) {
      const vols = fs.readdirSync('/Volumes');
      for (const v of vols) {
        candidates.push(path.join('/Volumes', v, '_Serato_', 'Subcrates'));
        candidates.push(path.join('/Volumes', v, 'Serato', 'Subcrates'));
      }
    }
  } catch (_) {}
  }

  for (const c of candidates) {
    if (fs.existsSync(c) && !validDirs.includes(c)) validDirs.push(c);
  }

  return validDirs;
}

function utf16be(buf) {
  if (!buf || buf.length < 2) return '';
  const copy = Buffer.from(buf);
  if (copy.length % 2 !== 0) return copy.toString('utf8');
  return copy.swap16().toString('utf16le').replace(/\0+$/g, '');
}

// Extrae las rutas de tracks (ptrk) de un buffer .crate
function parseCrateBuffer(buf) {
  const paths = [];
  let i = 0;
  while (i + 8 <= buf.length) {
    const tag = buf.toString('latin1', i, i + 4);
    const len = buf.readUInt32BE(i + 4);
    if (len < 0 || len > buf.length - i - 8) break;
    const body = buf.subarray(i + 8, i + 8 + len);
    if (tag === 'otrk') {
      // Dentro del track buscar 'ptrk'
      let j = 0;
      while (j + 8 <= body.length) {
        const t2 = body.toString('latin1', j, j + 4);
        const l2 = body.readUInt32BE(j + 4);
        if (l2 < 0 || l2 > body.length - j - 8) break;
        if (t2 === 'ptrk') {
          const p = utf16be(body.subarray(j + 8, j + 8 + l2));
          if (p) paths.push(p);
        }
        j += 8 + l2;
      }
    }
    i += 8 + len;
  }
  return paths;
}

// Normaliza una ruta para poder cruzar con la biblioteca (comparamos por sufijo)
function normPath(p) {
  return String(p || '').replace(/^\/+/, '').toLowerCase();
}

// Nombre legible del crate a partir del nombre de archivo.
// Serato usa "%%" para subcarpetas: "Sets%%Peak Time.crate" -> "Peak Time"
function crateNameFromFile(filename) {
  const base = filename.replace(/\.crate$/i, '');
  const parts = base.split('%%');
  return parts[parts.length - 1] || base;
}

/**
 * Carga todos los crates. Devuelve:
 *  - crateNames: [string]
 *  - pathToCrates: Map(normPath -> [crateName])
 *  - crateToPaths: Map(crateName -> [normPath])
 */
function loadCrates() {
  const result = { crateNames: [], pathToCrates: new Map(), crateToPaths: new Map(), count: 0 };
  const dirs = findCratesDirs();
  if (!dirs || dirs.length === 0) return result;

  for (const dir of dirs) {
    let files = [];
    try {
      files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.crate'));
    } catch (_) {
      continue;
    }

    for (const file of files) {
      try {
        const name = crateNameFromFile(file);
        const buf = fs.readFileSync(path.join(dir, file));
        const paths = parseCrateBuffer(buf).map(normPath).filter(Boolean);
        if (!paths.length) continue;
        
        if (!result.crateNames.includes(name)) result.crateNames.push(name);
        
        const existingPaths = result.crateToPaths.get(name) || [];
        result.crateToPaths.set(name, existingPaths.concat(paths));
        
        for (const p of paths) {
          if (!result.pathToCrates.has(p)) result.pathToCrates.set(p, []);
          if (!result.pathToCrates.get(p).includes(name)) {
            result.pathToCrates.get(p).push(name);
          }
        }
      } catch (_) { /* saltar crate corrupto */ }
    }
  }
  
  result.count = result.crateNames.length;
  return result;
}

// Dado un portable_id / path de la biblioteca, devuelve los crates a los que pertenece.
// Cruce por sufijo: la ruta del crate suele terminar igual que el path de la biblioteca.
function cratesForPath(cratesData, libPath) {
  if (!cratesData || !libPath) return [];
  const target = normPath(libPath);
  if (!target) return [];
  // match exacto primero
  if (cratesData.pathToCrates.has(target)) return cratesData.pathToCrates.get(target);
  // match por sufijo (más flexible)
  const found = [];
  for (const [p, names] of cratesData.pathToCrates.entries()) {
    if (p.endsWith(target) || target.endsWith(p)) {
      for (const n of names) if (!found.includes(n)) found.push(n);
    }
  }
  return found;
}

const SERATO_DIR = path.join(HOME, 'Music', '_Serato_');
const SUBCRATES_DIR = path.join(SERATO_DIR, 'Subcrates');
const CRATES_DIR = path.join(SERATO_DIR, 'Crates');

module.exports = { loadCrates, cratesForPath, findCratesDirs, SUBCRATES_DIR, CRATES_DIR };
