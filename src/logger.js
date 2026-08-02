// Logger de depuración de TrackAI.
// Guarda TODO lo que pasa en vivo (cada track, cada sugerencia con sus scores,
// cambios de modo, errores) en un archivo de texto, para revisarlo después del set
// y seguir mejorando el sistema. Escribe también en consola.
//
// Los logs quedan en:  ~/Documents/TrackAI-Logs/trackai-<fecha>.log
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const LOG_DIR = path.join(os.homedir(), 'Documents', 'TrackAI-Logs');
let logFile = null;
let ready = false;

function init() {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    logFile = path.join(LOG_DIR, `trackai-${ts}.log`);
    ready = true;
    line('INIT', '════════ TrackAI — sesión de depuración iniciada ════════', {
      fecha: new Date().toISOString(),
      archivo: logFile,
      plataforma: process.platform,
      electron: process.versions.electron,
    });
    return logFile;
  } catch (e) {
    ready = false;
    console.error('⚠️  No se pudo iniciar el log a archivo:', e.message);
    return null;
  }
}

// Escribe una línea con tiempo, etiqueta, mensaje y (opcional) datos JSON.
function line(tag, msg, data) {
  const t = new Date().toISOString();
  let str = `[${t}] [${tag}] ${msg}`;
  if (data !== undefined) {
    try { str += ' ' + JSON.stringify(data); } catch (_) { str += ' [datos no serializables]'; }
  }
  console.log(str);
  if (ready && logFile) {
    try { fs.appendFileSync(logFile, str + '\n'); } catch (_) { /* no romper la app por un log */ }
  }
}

function getLogFile() { return logFile; }
function getLogDir() { return LOG_DIR; }

module.exports = { init, line, getLogFile, getLogDir, LOG_DIR };
