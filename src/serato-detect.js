// 🔎 Auto-detección de la instalación de Serato (portable, sin dependencias).
// Objetivo: que el usuario NO tenga que buscar archivos. Escanea los lugares típicos
// (Música, Soporte de Aplicaciones, nube, discos externos) y devuelve:
//   { found, best, all }  donde best = { version(3|4), dbPath, seratoDir, historyDir, source, mtime }
//
// Serato 4  → biblioteca en 'master.sqlite' (SQLite).
// Serato 3  → biblioteca en 'database V2' (binario) + historial en 'History/Sessions/*.session'.
//
// Este módulo es autónomo: PulseDJ (u otro front) puede requerirlo tal cual.
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

function home() { return process.env.HOME || os.homedir(); }
function exists(p) { try { return fs.existsSync(p); } catch (_) { return false; } }
function mtime(p) { try { return fs.statSync(p).mtimeMs || 0; } catch (_) { return 0; } }

// Lista de carpetas "_Serato_" candidatas, con una etiqueta amigable para el usuario.
function seratoDirs() {
  const H = home();
  const out = [];
  const add = (dir, source) => { if (dir) out.push({ dir, source }); };

  // 1) Local (lo más común)
  add(path.join(H, 'Music', '_Serato_'), 'Música (en este Mac)');

  // 2) Nube: ~/Library/CloudStorage/<Proveedor>/(Mi unidad|My Drive)?/_Serato_
  try {
    const cloud = path.join(H, 'Library', 'CloudStorage');
    if (exists(cloud)) {
      for (const item of fs.readdirSync(cloud)) {
        const base = path.join(cloud, item);
        const proveedor = item.replace(/-.*/, ''); // GoogleDrive, OneDrive, Dropbox...
        add(path.join(base, '_Serato_'), `Nube (${proveedor})`);
        add(path.join(base, 'Mi unidad', '_Serato_'), `Nube (${proveedor})`);
        add(path.join(base, 'My Drive', '_Serato_'), `Nube (${proveedor})`);
      }
    }
  } catch (_) {}

  // 3) Google Drive clásico (cross-platform)
  add(path.join(H, 'Google Drive', '_Serato_'), 'Nube (Google Drive)');
  add(path.join(H, 'Google Drive', 'Mi unidad', '_Serato_'), 'Nube (Google Drive)');

  // 3b) Windows: OneDrive + Google Drive en paths locales
  if (process.platform === 'win32') {
    add(path.join(H, 'OneDrive', '_Serato_'), 'Nube (OneDrive)');
    add(path.join(H, 'GoogleDrive', '_Serato_'), 'Nube (Google Drive)');
  }

  // 4) Discos externos (macOS): /Volumes/<Disco>/_Serato_
  if (process.platform === 'darwin') {
  try {
    if (exists('/Volumes')) {
      for (const v of fs.readdirSync('/Volumes')) {
        add(path.join('/Volumes', v, '_Serato_'), `Disco externo (${v})`);
      }
    }
  } catch (_) {}
  }

  return out;
}

// Dado una carpeta _Serato_, deduce versión y rutas.
function inspectSeratoDir(dir, source) {
  const master = path.join(dir, 'master.sqlite');
  const dbV2 = path.join(dir, 'database V2');
  const history = path.join(dir, 'History');
  const sessions = path.join(history, 'Sessions');
  const historyDir = exists(sessions) ? sessions : (exists(history) ? history : null);

  if (exists(master)) {
    return { version: 4, dbPath: master, seratoDir: dir, historyDir, source, mtime: mtime(master) };
  }
  if (exists(dbV2)) {
    return { version: 3, dbPath: dbV2, seratoDir: dir, historyDir, source, mtime: mtime(dbV2) };
  }
  return null;
}

/**
 * Detecta TODAS las instalaciones de Serato y elige la que se está usando
 * (la de modificación más reciente). No abre nada: solo mira el disco.
 */
function detectSeratoInstall() {
  const H = home();
  const results = [];

  // Serato 4 guarda el master.sqlite en Soporte de Aplicaciones
  const appSupport = path.join(H, 'Library', 'Application Support', 'Serato', 'Library', 'master.sqlite');
  if (exists(appSupport)) {
    results.push({ version: 4, dbPath: appSupport, seratoDir: path.dirname(appSupport), historyDir: null, source: 'Serato 4 (app)', mtime: mtime(appSupport) });
  }

  for (const { dir, source } of seratoDirs()) {
    if (!exists(dir)) continue;
    const info = inspectSeratoDir(dir, source);
    if (info) results.push(info);
  }

  // Dedup por dbPath
  const seen = new Set();
  const unique = results.filter((r) => (seen.has(r.dbPath) ? false : (seen.add(r.dbPath), true)));

  // Elegir la mejor:
  // 1. Preferir siempre la ubicación local nativa del Mac antes que la nube (Google Drive/OneDrive)
  // 2. Preferir versión de Serato (Serato 4)
  // 3. Modificación más reciente
  unique.sort((a, b) => {
    const isLocalA = a.source && (a.source.includes('app') || a.source.includes('Música'));
    const isLocalB = b.source && (b.source.includes('app') || b.source.includes('Música'));
    if (isLocalA && !isLocalB) return -1;
    if (!isLocalA && isLocalB) return 1;
    return (b.version - a.version) || (b.mtime - a.mtime);
  });

  return { found: unique.length > 0, best: unique[0] || null, all: unique };
}

// Resumen en lenguaje simple para mostrarle al DJ.
function describeInstall(best) {
  if (!best) return 'No encontré tu biblioteca de Serato automáticamente.';
  if (best.version < 4) return `Detecté Serato ${best.version} en ${best.source} — necesitas Serato 4 o superior.`;
  return `Encontré Serato ${best.version} en: ${best.source}`;
}

module.exports = { detectSeratoInstall, describeInstall, seratoDirs, inspectSeratoDir };
