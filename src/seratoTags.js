// [BETA] Lectura de CUE POINTS y BEATGRID desde los tags "Serato Markers2" del archivo.
// Serato guarda los cues en un frame GEOB de ID3v2 (MP3/AIFF) llamado "Serato Markers2",
// codificado en base64. Este módulo lo parsea SOLO para el track actual (1 archivo),
// así que el costo es mínimo. Todo va en try/catch: ante cualquier duda devuelve null.
//
// Nota: implementado y probado contra el formato ID3v2 (MP3). Para FLAC/MP4 degrada a null.
// Es una función de asistencia visual ("por dónde salir"), nunca bloquea la app.
'use strict';

const fs = require('fs');

// ---------- ID3v2: encontrar frames GEOB ----------
function readSyncsafe(buf, off) {
  return (buf[off] << 21) | (buf[off + 1] << 14) | (buf[off + 2] << 7) | buf[off + 3];
}

// Extrae { description -> Buffer } de todos los frames GEOB del archivo MP3
function extractGeobFrames(filePath) {
  const frames = {};
  let fd;
  try {
    // Leer solo el inicio del archivo (los tags ID3 van al principio). 2MB es de sobra.
    const HEADER_BYTES = 2 * 1024 * 1024;
    fd = fs.openSync(filePath, 'r');
    const stat = fs.fstatSync(fd);
    const toRead = Math.min(HEADER_BYTES, stat.size);
    const buf = Buffer.alloc(toRead);
    fs.readSync(fd, buf, 0, toRead, 0);

    if (buf.toString('latin1', 0, 3) !== 'ID3') return frames;
    const majorVersion = buf[3];                 // 3 = ID3v2.3, 4 = ID3v2.4
    const size = readSyncsafe(buf, 6);           // tamaño del tag (syncsafe)
    let i = 10;
    const end = Math.min(10 + size, buf.length);

    while (i + 10 <= end) {
      const id = buf.toString('latin1', i, i + 4);
      if (!/^[A-Z0-9]{4}$/.test(id)) break; // padding o fin
      // ⭐ v2.4 usa tamaños "syncsafe"; v2.3 usa uint32 normal
      const frameSize = majorVersion >= 4 ? readSyncsafe(buf, i + 4) : buf.readUInt32BE(i + 4);
      const contentStart = i + 10;
      if (frameSize <= 0 || contentStart + frameSize > buf.length) break;

      if (id === 'GEOB') {
        const body = buf.subarray(contentStart, contentStart + frameSize);
        const parsed = parseGeob(body);
        if (parsed && parsed.description) frames[parsed.description] = parsed.data;
      }
      i = contentStart + frameSize;
    }
  } catch (_) {
    /* devolver lo que haya */
  } finally {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch (_) {} }
  }
  return frames;
}

// Un frame GEOB: encoding(1) + mime(null-term) + filename(null-term) + description(null-term) + data
function parseGeob(body) {
  try {
    let i = 1; // saltar byte de encoding
    const readNullTerm = () => {
      const start = i;
      while (i < body.length && body[i] !== 0x00) i++;
      const s = body.toString('latin1', start, i);
      i++; // saltar el null
      return s;
    };
    readNullTerm();                    // mime type
    readNullTerm();                    // filename
    const description = readNullTerm(); // "Serato Markers2", "Serato BeatGrid", etc.
    const data = body.subarray(i);
    return { description, data };
  } catch (_) {
    return null;
  }
}

// ---------- Serato Markers2 → cue points ----------
function decodeMarkers2(data) {
  // data: 0x01 0x01 seguido de base64 (con posibles \n). Puede haber \x00 al final.
  try {
    let str = data.toString('latin1');
    // quitar prefijo de versión y espacios/nulos
    str = str.replace(/^\x01\x01/, '');
    str = str.replace(/\x00+$/g, '');
    const b64 = str.replace(/[^A-Za-z0-9+/=]/g, '');
    const payload = Buffer.from(b64, 'base64');
    return parseMarkers2Payload(payload);
  } catch (_) {
    return [];
  }
}

function parseMarkers2Payload(buf) {
  const cues = [];
  try {
    // payload: 0x01 0x01, luego entradas: nombre(null-term) + len(uint32 BE) + body
    let i = 2;
    while (i < buf.length) {
      // nombre de entrada
      const start = i;
      while (i < buf.length && buf[i] !== 0x00) i++;
      const name = buf.toString('latin1', start, i);
      i++; // null
      if (i + 4 > buf.length) break;
      const len = buf.readUInt32BE(i); i += 4;
      if (len < 0 || i + len > buf.length) break;
      const body = buf.subarray(i, i + len);
      i += len;

      if (name === 'CUE') {
        // body: 0x00, index(1), pos(uint32 BE ms), 0x00, color(3), 0x00 0x00, name(null-term)
        try {
          const index = body[1];
          const posMs = body.readUInt32BE(2);
          const r = body[7], g = body[8], b = body[9];
          let n = '';
          let k = 12;
          const ns = k;
          while (k < body.length && body[k] !== 0x00) k++;
          n = body.toString('utf8', ns, k);
          cues.push({
            index,
            posMs,
            color: '#' + [r, g, b].map((x) => (x || 0).toString(16).padStart(2, '0')).join(''),
            name: n || ('Cue ' + (index + 1)),
          });
        } catch (_) { /* saltar cue corrupto */ }
      }
      if (name === '') break;
    }
  } catch (_) { /* parcial */ }
  return cues.sort((a, b) => a.posMs - b.posMs);
}

/**
 * Devuelve info de cues del archivo dado. SOLO MP3 por ahora (degrada a null).
 * { cues: [{index,posMs,color,name}], firstCueMs, lastCueMs } | null
 */
function readCues(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return null;
    if (!/\.(mp3|aif|aiff)$/i.test(filePath)) return null; // formato no soportado (beta)
    const frames = extractGeobFrames(filePath);
    // Buscar el frame de markers de forma flexible (por si trae bytes extra en la descripción)
    let markers = frames['Serato Markers2'];
    if (!markers) {
      const key = Object.keys(frames).find((k) => /Serato Markers2/i.test(k));
      if (key) markers = frames[key];
    }
    if (!markers) return null;
    const cues = decodeMarkers2(markers);
    if (!cues.length) return null;
    return {
      cues,
      firstCueMs: cues[0].posMs,
      lastCueMs: cues[cues.length - 1].posMs,
    };
  } catch (_) {
    return null;
  }
}

module.exports = { readCues, extractGeobFrames };
