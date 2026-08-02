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

// ---------- FLAC: VORBIS_COMMENT ----------
// Los tags de Serato viven en el bloque VORBIS_COMMENT como SERATO_BEATGRID,
// SERATO_MARKERS_V2, etc. El valor es base64 (sin padding, con saltos de línea).
// Decodificado: "application/octet-stream\0" + "\0" + "<nombre>\0" + datos.
function extractFlacFrames(filePath) {
  const frames = {};
  let fd;
  try {
    const HEADER_BYTES = 2 * 1024 * 1024;
    fd = fs.openSync(filePath, 'r');
    const stat = fs.fstatSync(fd);
    const toRead = Math.min(HEADER_BYTES, stat.size);
    const buf = Buffer.alloc(toRead);
    fs.readSync(fd, buf, 0, toRead, 0);

    if (buf.toString('latin1', 0, 4) !== 'fLaC') return frames;
    let off = 4;
    let last = false;
    while (!last && off + 4 <= buf.length) {
      const head = buf[off];
      last = (head & 0x80) !== 0;
      const type = head & 0x7f;
      const len = (buf[off + 1] << 16) | (buf[off + 2] << 8) | buf[off + 3];
      off += 4;
      if (type === 4) { // VORBIS_COMMENT
        let p = off;
        const vendorLen = buf.readUInt32LE(p); p += 4;
        p += vendorLen;
        const count = buf.readUInt32LE(p); p += 4;
        for (let i = 0; i < count; i++) {
          if (p + 4 > buf.length) break;
          const clen = buf.readUInt32LE(p); p += 4;
          if (p + clen > buf.length) break;
          const comment = buf.toString('latin1', p, p + clen);
          p += clen;
          const eq = comment.indexOf('=');
          if (eq > 0) {
            const key = comment.slice(0, eq).toUpperCase();
            const val = comment.slice(eq + 1);
            if (key.indexOf('SERATO') === 0) {
              const decoded = decodeSeratoPayload(val);
              if (decoded && decoded.name) frames[decoded.name] = decoded.data;
            }
          }
        }
      }
      off += len;
    }
  } catch (_) {
    /* devolver lo que haya */
  } finally {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch (_) {} }
  }
  return frames;
}

// ---------- MP4/M4A: atoms "----" de com.serato.dj ----------
// En MP4/M4A los tags viven en moov > udta > meta > ilst > ---- (mean "com.serato.dj",
// name "beatgrid"/"markersv2"/...). El payload decodificado usa el mismo formato que FLAC.
function extractMp4Frames(filePath) {
  const frames = {};
  let fd;
  try {
    const HEADER_BYTES = 8 * 1024 * 1024;
    fd = fs.openSync(filePath, 'r');
    const stat = fs.fstatSync(fd);
    const toRead = Math.min(HEADER_BYTES, stat.size);
    const buf = Buffer.alloc(toRead);
    fs.readSync(fd, buf, 0, toRead, 0);

    const walkAtoms = (start, end) => {
      let off = start;
      while (off + 8 <= end) {
        let size = buf.readUInt32BE(off);
        const type = buf.toString('latin1', off + 4, off + 8);
        if (size === 1) {
          if (off + 16 > end) break;
          size = Number(buf.readBigUInt64BE(off + 8));
        } else if (size === 0) {
          size = end - off;
        }
        if (size < 8 || off + size > end) break;
        const bodyStart = off + 8;
        const bodyEnd = off + size;
        if (type === 'moov' || type === 'udta' || type === 'ilst') {
          walkAtoms(bodyStart, bodyEnd);
        } else if (type === 'meta') {
          walkAtoms(bodyStart + 4, bodyEnd); // meta tiene 4 bytes de version/flags
        } else if (type === '----') {
          const parsed = parseFreeformAtom(buf, bodyStart, bodyEnd);
          if (parsed && parsed.mean === 'com.serato.dj') {
            const name = seratoAtomName(parsed.name);
            if (name && parsed.data) {
              const decoded = decodeSeratoPayload(parsed.data.toString('latin1'));
              if (decoded && decoded.name) frames[decoded.name] = decoded.data;
            }
          }
        }
        off += size;
      }
    };
    walkAtoms(0, buf.length);
  } catch (_) {
    /* devolver lo que haya */
  } finally {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch (_) {} }
  }
  return frames;
}

function parseFreeformAtom(buf, start, end) {
  const out = { mean: '', name: '', data: null };
  let off = start;
  while (off + 8 <= end) {
    const size = buf.readUInt32BE(off);
    const type = buf.toString('latin1', off + 4, off + 8);
    if (size < 8 || off + size > end) break;
    const body = off + 8;
    if (type === 'mean') {
      out.mean = buf.toString('latin1', body + 4, off + size).replace(/\0+$/g, '');
    } else if (type === 'name') {
      out.name = buf.toString('latin1', body + 4, off + size).replace(/\0+$/g, '');
    } else if (type === 'data') {
      out.data = buf.subarray(body + 8, off + size); // saltar version/flags(4) + locale(4)
    }
    off += size;
  }
  return out;
}

function seratoAtomName(name) {
  const map = {
    'markersv2': 'Serato Markers2',
    'markers': 'Serato Markers_',
    'beatgrid': 'Serato BeatGrid',
    'overview': 'Serato Overview',
    'autgain': 'Serato Autotags',
  };
  return map[name] || null;
}

// Decodifica el payload base64 de FLAC/MP4 al formato común:
// "application/octet-stream\0" + "\0" + "<nombre>\0" + datos
function decodeSeratoPayload(b64) {
  try {
    const clean = String(b64 || '').replace(/[^A-Za-z0-9+/=]/g, '');
    if (!clean) return null;
    const decoded = Buffer.from(clean, 'base64');
    let i = 0;
    const readNullTerm = () => {
      const start = i;
      while (i < decoded.length && decoded[i] !== 0x00) i++;
      const s = decoded.toString('latin1', start, i);
      i++; // saltar el null
      return s;
    };
    readNullTerm();                     // mime ("application/octet-stream")
    readNullTerm();                     // filename (vacío)
    const name = readNullTerm();        // "Serato Markers2", "Serato BeatGrid", ...
    return { name, data: decoded.subarray(i) };
  } catch (_) {
    return null;
  }
}

// Dispatcher por extensión de archivo: MP3/AIFF (ID3v2 GEOB), FLAC (VORBIS), MP4/M4A (atoms)
function extractSeratoFrames(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return {};
  const lower = filePath.toLowerCase();
  if (/\.(flac)$/i.test(lower)) return extractFlacFrames(filePath);
  if (/\.(m4a|mp4|aac)$/i.test(lower)) return extractMp4Frames(filePath);
  return extractGeobFrames(filePath);
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
 * Devuelve info de cues del archivo dado. MP3/AIFF/FLAC/M4A/MP4 (degrada a null).
 * { cues: [{index,posMs,color,name}], firstCueMs, lastCueMs } | null
 */
function readCues(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return null;
    if (!/\.(mp3|aif|aiff|flac|m4a|mp4)$/i.test(filePath)) return null; // formato no soportado (beta)
    const frames = extractSeratoFrames(filePath);
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

// ---------- Serato BeatGrid ----------
// Formato (serato-tags): 2 bytes versión + uint32 BE (cantidad de markers) + markers + 1 byte footer.
// - Marker terminal (el último): position(float32 BE, segundos) + bpm(float32 BE)
// - Markers no terminales: position(float32 BE) + beatsToNext(uint32 BE)
function parseBeatgrid(buf) {
  try {
    if (!buf || buf.length < 7) return null;
    const count = buf.readUInt32BE(2);
    if (count <= 0 || buf.length < 6 + count * 8 + 1) return null;
    let off = 6;
    const markers = [];
    for (let i = 0; i < count; i++) {
      const position = buf.readFloatBE(off);
      off += 4;
      if (i === count - 1) {
        const bpm = buf.readFloatBE(off);
        off += 4;
        markers.push({ position, bpm });
      } else {
        const beatsToNext = buf.readUInt32BE(off);
        off += 4;
        markers.push({ position, beatsToNext });
      }
    }
    return { markers };
  } catch (_) {
    return null;
  }
}

/**
 * Lee el beatgrid del archivo (MP3/AIFF/FLAC/M4A/MP4).
 * { markers: [{position(seg), bpm?} | {position, beatsToNext?}] } | null
 */
function readBeatgrid(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return null;
    if (!/\.(mp3|aif|aiff|flac|m4a|mp4)$/i.test(filePath)) return null;
    const frames = extractSeratoFrames(filePath);
    let bg = frames['Serato BeatGrid'];
    if (!bg) {
      const key = Object.keys(frames).find((k) => /BeatGrid/i.test(k));
      if (key) bg = frames[key];
    }
    if (!bg) return null;
    return parseBeatgrid(bg);
  } catch (_) {
    return null;
  }
}

// Convierte una posición en SEGUNDOS a beat/compás usando el beatgrid.
// Devuelve { beat (1-based), bar (compás, 4/4) } o null si no hay grid o está fuera de rango.
function secondsToBeatPosition(beatgrid, seconds) {
  try {
    if (!beatgrid || !beatgrid.markers || !beatgrid.markers.length) return null;
    if (typeof seconds !== 'number' || !isFinite(seconds) || seconds < 0) return null;
    const markers = beatgrid.markers;
    if (seconds < markers[0].position) return null;

    let beat = 1; // primer beat del grid
    for (let i = 0; i < markers.length; i++) {
      const m = markers[i];
      const next = markers[i + 1] || null;
      const sectionStart = m.position;

      if (!next) {
        // Último marker: se extiende con su BPM
        const bpm = m.bpm;
        if (!bpm || bpm <= 0) return { beat, bar: Math.ceil(beat / 4), positionSeconds: seconds };
        const secPerBeat = 60 / bpm;
        const extra = Math.floor((seconds - sectionStart) / secPerBeat);
        return { beat: beat + extra, bar: Math.ceil((beat + extra) / 4), positionSeconds: seconds };
      }

      const sectionEnd = next.position;
      if (seconds < sectionEnd) {
        const beatsToNext = m.beatsToNext || 1;
        const secPerBeat = (sectionEnd - sectionStart) / beatsToNext;
        const extra = Math.floor((seconds - sectionStart) / secPerBeat);
        return { beat: beat + extra, bar: Math.ceil((beat + extra) / 4), positionSeconds: seconds };
      }
      beat += (m.beatsToNext || 1);
    }
    return null;
  } catch (_) {
    return null;
  }
}

module.exports = { readCues, readBeatgrid, parseBeatgrid, secondsToBeatPosition, extractGeobFrames, extractSeratoFrames };
