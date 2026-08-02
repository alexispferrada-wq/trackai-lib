// Lectura de datos de Serato DJ (macOS)
// Serato DJ 4.x guarda biblioteca e historial en SQLite:
//   ~/Library/Application Support/Serato/Library/master.sqlite
// Tablas: history_session, history_entry (track sonando), asset (biblioteca).
// Se lee en modo SOLO LECTURA con el sqlite3 que trae macOS — no toca nada.
// Fallback: formato antiguo "database V2" binario para la biblioteca.
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const HOME = os.homedir();
const TRACKAI_DIR = path.join(HOME, '.trackai');
if (!fs.existsSync(TRACKAI_DIR)) {
  try { fs.mkdirSync(TRACKAI_DIR, { recursive: true }); } catch (_) {}
}
const SHADOW_DB  = path.join(TRACKAI_DIR, 'master-shadow.sqlite');
const SHADOW_WAL = path.join(TRACKAI_DIR, 'master-shadow.sqlite-wal');
const SHADOW_SHM = path.join(TRACKAI_DIR, 'master-shadow.sqlite-shm');
const CONFIG_FILE = path.join(TRACKAI_DIR, 'config.json');

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch (_) {}
  return {};
}

function saveConfig(cfg) {
  try {
    const current = loadConfig();
    const updated = { ...current, ...cfg };
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(updated, null, 2), 'utf8');
    return true;
  } catch (_) { return false; }
}

function findMasterDbPath() {
  const cfg = loadConfig();
  if (cfg.customSeratoDbPath && fs.existsSync(cfg.customSeratoDbPath)) {
    return cfg.customSeratoDbPath;
  }

  if (process.platform === 'win32') {
    const localWinPath = path.join(process.env.LOCALAPPDATA || path.join(HOME, 'AppData', 'Local'), 'Serato', 'Library', 'master.sqlite');
    if (fs.existsSync(localWinPath)) {
      return localWinPath;
    }
  } else {
    const localMacPath = path.join(HOME, 'Library', 'Application Support', 'Serato', 'Library', 'master.sqlite');
    if (fs.existsSync(localMacPath)) {
      return localMacPath;
    }
  }

  // 🔎 Auto-detección robusta primero (Serato 4 = master.sqlite, en Música/nube/externo)
  try {
    const det = require('./serato-detect').detectSeratoInstall();
    if (det.best && det.best.version === 4 && fs.existsSync(det.best.dbPath)) {
      return det.best.dbPath;
    }
  } catch (_) {}

  const candidates = [];
  if (process.platform === 'win32') {
    candidates.push(
      path.join(process.env.LOCALAPPDATA || path.join(HOME, 'AppData', 'Local'), 'Serato', 'Library', 'master.sqlite')
    );
  } else {
    candidates.push(
      path.join(HOME, 'Library', 'Application Support', 'Serato', 'Library', 'master.sqlite')
    );
  }

  candidates.push(
    // 2. Google Drive / CloudStorage
    path.join(HOME, 'Google Drive', 'Serato', 'Library', 'master.sqlite'),
    path.join(HOME, 'Google Drive', 'Mi unidad', 'Serato', 'Library', 'master.sqlite'),
    path.join(HOME, 'My Drive', 'Serato', 'Library', 'master.sqlite')
  );

  // Escanear ~/Library/CloudStorage/ (macOS)
  if (process.platform === 'darwin') {
    try {
      const cloudDir = path.join(HOME, 'Library', 'CloudStorage');
      if (fs.existsSync(cloudDir)) {
        const items = fs.readdirSync(cloudDir);
        for (const item of items) {
          if (item.startsWith('GoogleDrive-') || item.startsWith('OneDrive-') || item.startsWith('Dropbox')) {
            const driveBase = path.join(cloudDir, item);
            candidates.push(path.join(driveBase, 'My Drive', 'Serato', 'Library', 'master.sqlite'));
            candidates.push(path.join(driveBase, 'Mi unidad', 'Serato', 'Library', 'master.sqlite'));
            candidates.push(path.join(driveBase, 'Serato', 'Library', 'master.sqlite'));
          }
        }
      }
    } catch (_) {}
  }

  // Escanear /Volumes/ (Discos externos en macOS)
  if (process.platform === 'darwin') {
    try {
      if (fs.existsSync('/Volumes')) {
        const vols = fs.readdirSync('/Volumes');
        for (const v of vols) {
          candidates.push(path.join('/Volumes', v, 'Serato', 'Library', 'master.sqlite'));
          candidates.push(path.join('/Volumes', v, '_Serato_', 'Library', 'master.sqlite'));
        }
      }
    } catch (_) {}
  }

  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }

  return process.platform === 'win32' 
    ? path.join(process.env.LOCALAPPDATA || path.join(HOME, 'AppData', 'Local'), 'Serato', 'Library', 'master.sqlite')
    : path.join(HOME, 'Library', 'Application Support', 'Serato', 'Library', 'master.sqlite');
}

function getMasterDbPath() {
  return findMasterDbPath();
}

function resolveSqliteBin() {
  if (process.platform === 'win32') {
    const candidates = [
      path.join(process.resourcesPath || '', 'bin', 'sqlite3.exe'),
      path.join(__dirname, '..', 'bin', 'win32', 'sqlite3.exe')
    ];
    for (const c of candidates) {
      try { if (fs.existsSync(c)) return c; } catch (_) {}
    }
    return 'sqlite3.exe';
  }
  return fs.existsSync('/usr/bin/sqlite3') ? '/usr/bin/sqlite3' : 'sqlite3';
}
const SQLITE_BIN = resolveSqliteBin();

const TEMP_SHADOW_DIR = path.join(os.tmpdir(), 'trackai-shadow');
if (!fs.existsSync(TEMP_SHADOW_DIR)) {
  try { fs.mkdirSync(TEMP_SHADOW_DIR, { recursive: true }); } catch (_) {}
}
const TEMP_SHADOW_DB     = path.join(TEMP_SHADOW_DIR, 'master.sqlite');
const TEMP_SHADOW_DB_ALT = path.join(TEMP_SHADOW_DIR, 'master-shadow.sqlite');
const TEMP_SHADOW_WAL    = path.join(TEMP_SHADOW_DIR, 'master.sqlite-wal');
const TEMP_SHADOW_SHM    = path.join(TEMP_SHADOW_DIR, 'master.sqlite-shm');

function hasMasterDb() {
  const masterPath = getMasterDbPath();
  return fs.existsSync(masterPath) || fs.existsSync(SHADOW_DB) || fs.existsSync(TEMP_SHADOW_DB) || fs.existsSync(TEMP_SHADOW_DB_ALT);
}

// Copia el master.sqlite LIVE de Serato (+WAL/SHM) a una copia sombra, fusiona el WAL y
// la deja PLANA para leerla sin bloqueo. Con throttle: refresca a lo sumo cada ~1.2s
// (así sigue a Serato EN VIVO sin copiar en cada consulta del mismo tick).
let _lastRefresh = 0;
function refreshShadow(force) {
  const masterPath = getMasterDbPath();
  const now = Date.now();
  // Reusar la copia si es MUY reciente (evita copiar decenas de veces por tick).
  if (!force && (now - _lastRefresh) < 1200) {
    if (fs.existsSync(TEMP_SHADOW_DB)) return TEMP_SHADOW_DB;
    if (fs.existsSync(TEMP_SHADOW_DB_ALT)) return TEMP_SHADOW_DB_ALT;
    if (fs.existsSync(SHADOW_DB)) return SHADOW_DB;
  }
  const masterWal  = masterPath + '-wal';
  const masterShm  = masterPath + '-shm';
  const targets = [
    { db: TEMP_SHADOW_DB, wal: TEMP_SHADOW_WAL, shm: TEMP_SHADOW_SHM },
    { db: TEMP_SHADOW_DB_ALT, wal: TEMP_SHADOW_WAL, shm: TEMP_SHADOW_SHM },
    { db: SHADOW_DB, wal: SHADOW_WAL, shm: SHADOW_SHM }
  ];

  for (const t of targets) {
    try {
      if (!fs.existsSync(masterPath)) continue;
      fs.copyFileSync(masterPath, t.db);
      if (fs.existsSync(masterWal)) fs.copyFileSync(masterWal, t.wal);
      if (fs.existsSync(masterShm)) fs.copyFileSync(masterShm, t.shm);
      try {
        execFileSync(SQLITE_BIN, [t.db, 'PRAGMA wal_checkpoint(TRUNCATE);'], { encoding: 'utf8', timeout: 3000 });
      } catch (_) {}
      // Dejar la copia PLANA (sin -wal/-shm) para que -readonly la abra siempre.
      try { if (fs.existsSync(t.wal)) fs.unlinkSync(t.wal); } catch (_) {}
      try { if (fs.existsSync(t.shm)) fs.unlinkSync(t.shm); } catch (_) {}
      _lastRefresh = now;
      return t.db;
    } catch (_) {}
  }
  return null;
}

function runQuery(dbPath, sql) {
  const env = Object.assign({}, process.env, process.platform === 'win32' ? {} : { PATH: '/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin' });
  try {
    const out = execFileSync(SQLITE_BIN, ['-readonly', '-json', dbPath, sql], {
      encoding: 'utf8',
      maxBuffer: 128 * 1024 * 1024,
      timeout: 10000,
      env,
    });
    const trimmed = out.trim();
    return trimmed ? JSON.parse(trimmed) : [];
  } catch (err) {
    const msg = String(err.message || err.stderr || '');
    if (/authorization denied|operation not permitted|EPERM|EACCES/i.test(msg)) {
      const epErr = new Error('EPERM_SERATO: macOS denegó permiso para leer master.sqlite');
      epErr.isEperm = true;
      throw epErr;
    }
    throw err;
  }
}

function query(sql, retries = 2) {
  const masterPath = getMasterDbPath();
  const errors = [];

  // PRINCIPAL: refrescar la copia desde el master.sqlite LIVE y leer ESA.
  // (Antes leía la copia estática de /tmp del presync y NUNCA la actualizaba → se
  //  quedaba congelado en el track que había al compilar. Este es el fix.)
  const fresh = refreshShadow();
  if (fresh && fs.existsSync(fresh)) {
    try { return runQuery(fresh, sql); } catch (e) { errors.push('fresh:' + (e.message || '').substring(0, 80)); }
  }

  // Fallback: lectura directa del master (con FDA o bookmark de 1-clic).
  if (fs.existsSync(masterPath)) {
    try { return runQuery(masterPath, sql); } catch (e) { errors.push('direct:' + (e.message || '').substring(0, 80)); }
  }

  // Fallback: cualquier copia sombra que ya exista (aunque sea vieja, mejor que nada).
  for (const f of [TEMP_SHADOW_DB, TEMP_SHADOW_DB_ALT, SHADOW_DB]) {
    if (fs.existsSync(f)) {
      try { return runQuery(f, sql); } catch (e) { errors.push('shadow:' + (e.message || '').substring(0, 80)); }
    }
  }

  // Todos fallaron: lanzar error descriptivo
  const err = new Error('No se pudo leer Serato DB. Intentos: ' + errors.join(' | '));
  err.isEperm = errors.some(e => /EPERM|authorization|denied/i.test(e));
  throw err;
}

// ---------- Introspección de esquema ----------
// Serato cambia nombres de columnas entre versiones. En vez de adivinar,
// detectamos qué columnas EXISTEN y seleccionamos solo esas.
const _colCache = {};
function getColumns(table) {
  if (_colCache[table]) return _colCache[table];
  try {
    const rows = query("PRAGMA table_info('" + table.replace(/'/g, '') + "')");
    const cols = rows.map((r) => r.name);
    _colCache[table] = cols;
    return cols;
  } catch (_) {
    _colCache[table] = [];
    return [];
  }
}

// Devuelve el primer nombre de columna que exista de una lista de candidatos
function pickCol(cols, candidates) {
  const lower = cols.map((c) => c.toLowerCase());
  for (const cand of candidates) {
    const idx = lower.indexOf(cand.toLowerCase());
    if (idx !== -1) return cols[idx];
  }
  return null;
}

// Mapa de "campo interno" -> posibles nombres de columna en Serato
const ASSET_FIELD_CANDIDATES = {
  // ⭐ Serato DJ 4 guarda el play count nativo en dj_play_count (confirmado en el diagnóstico)
  playCount: ['dj_play_count', 'times_played', 'play_count', 'playcount', 'plays'],
  dateAdded: ['time_added', 'date_added', 'added_at', 'dateadded', 'time_created'],
  lastPlayed: ['dj_recently_played', 'last_played', 'last_played_at', 'lastplayed'],
  comment: ['comment', 'comments'],
  grouping: ['grouping', 'group', 'label'],
  rating: ['rating', 'stars'],
  year: ['year', 'release_year'],
  bitrate: ['file_bit_rate', 'bitrate', 'bit_rate'],
  lengthMs: ['length_ms', 'length', 'duration_ms', 'duration'],
  gain: ['gain', 'autogain', 'auto_gain', 'track_gain', 'replaygain'],
  // ⭐ key_value: tonalidad numérica de Serato (más confiable que el texto)
  keyValue: ['key_value'],
};

// Construye el mapa {campoInterno: columnaReal} para las columnas que existen
function detectAssetFields() {
  const cols = getColumns('asset');
  const map = {};
  for (const [field, cands] of Object.entries(ASSET_FIELD_CANDIDATES)) {
    const real = pickCol(cols, cands);
    if (real) map[field] = real;
  }
  return map;
}

// Extrae artista y título limpios analizando la fila y el nombre de archivo
function parseArtistTitle(r) {
  let title = String(r.name || r.file_name || '').trim();
  let artist = String(r.artist || '').trim();
  let fileName = String(r.file_name || (r.portable_id ? path.basename(r.portable_id) : '')).trim();

  // Si title es "TITULO DESCONOCIDO" o vacío, usar fileName sin extensión
  if (!title || /TITULO DESCONOCIDO/i.test(title)) {
    title = fileName.replace(/\.[a-z0-9]+$/i, '');
  }

  // Limpiar prefijos numéricos de Serato/carpetas (ej: "2013 - 2726 - [000] - " o "[090] - ")
  const stripPrefix = (str) =>
    str.replace(/^(?:\d{1,4}\s*[-–—]\s*)+/g, '')
       .replace(/^\[\d+\]\s*[-–—]?\s*/g, '')
       .trim();

  title = stripPrefix(title);
  fileName = stripPrefix(fileName);

  // Si el artista no es válido ('?', 'SIN ARTISTA', 'TITULO DESCONOCIDO', etc.)
  const isInvalidArtist = !artist || /^(?:\?|SIN ARTISTA|TITULO DESCONOCIDO|UNKNOWN|VARIOUS|VARIOS|WWW\..*|WWW)$/i.test(artist);

  if (isInvalidArtist) {
    const targetStr = title.includes(' - ') ? title : fileName;
    if (targetStr && targetStr.includes(' - ')) {
      const parts = targetStr.split(/\s*[-–—]\s*/);
      if (parts.length >= 2) {
        let extractedArtist = parts[0].trim().replace(/^\s*\[[^\]]*\]\s*/, '').trim();
        let extractedTitle = parts.slice(1).join(' - ').replace(/\.[a-z0-9]+$/i, '').trim();

        if (extractedArtist && extractedTitle) {
          artist = extractedArtist;
          title = extractedTitle;
        }
      }
    }
  }

  // Si tras el intento el artista sigue siendo inválido pero el título contiene " - "
  if ((!artist || artist === '?') && title.includes(' - ')) {
    const parts = title.split(/\s*[-–—]\s*/);
    if (parts.length >= 2) {
      artist = parts[0].replace(/^\s*\[[^\]]*\]\s*/, '').trim();
      title = parts.slice(1).join(' - ').replace(/\.[a-z0-9]+$/i, '').trim();
    }
  }

  // Quitar extensiones de archivo al final del título
  title = title.replace(/\.(mp3|m4a|wav|aiff|flac)$/i, '').trim();

  return { title, artist: artist || '?' };
}

// Normaliza una fila de history_entry/asset al formato interno de la app
function mapRow(r) {
  const parsed = parseArtistTitle(r);
  return {
    title: parsed.title,
    artist: parsed.artist,
    album: r.album || '',
    genre: r.genre || '',
    key: r.key || '',
    bpm: r.bpm != null ? String(r.bpm) : '',
    bpmNum: r.bpm != null ? Number(r.bpm) : null,
    portable_id: r.portable_id || '', // ⭐ AGREGADO: se usa en getFolder()
    path: r.portable_id ? '/' + String(r.portable_id).replace(/^\/+/, '') : '',
    startTime: r.start_time,
    endTime: r.end_time || Math.floor(Date.now() / 1000), // si aún está sonando, usa ahora
    deck: r.deck,
    sessionId: r.session_id,
    length_ms: r.length_ms || r.__lengthMs || null,
    // ---- Campos ricos (solo presentes si la columna existe en esta versión de Serato) ----
    playCount: r.__playCount != null ? Number(r.__playCount) : null,
    dateAdded: r.__dateAdded != null ? Number(r.__dateAdded) : null,
    lastPlayed: r.__lastPlayed != null ? Number(r.__lastPlayed) : null,
    comment: r.__comment || '',
    grouping: r.__grouping || '',
    rating: r.__rating != null ? Number(r.__rating) : null,
    year: r.__year != null ? Number(r.__year) : null,
    gain: r.__gain != null ? Number(r.__gain) : null,
    keyValue: r.__keyValue != null ? Number(r.__keyValue) : null,
  };
}

// Track "sonando ahora": última entrada del historial + resto de la sesión
function nowPlaying() {
  const masterPath = getMasterDbPath();
  const isCustom = Boolean(loadConfig().customSeratoDbPath);
  const hasTmpShadow = fs.existsSync(TEMP_SHADOW_DB);
  const hasHomeShadow = fs.existsSync(SHADOW_DB);
  const dbSource = hasTmpShadow ? 'shadow(/tmp)' : hasHomeShadow ? 'shadow(~/.trackai)' : 'directo';
  const activeDbPath = hasTmpShadow ? TEMP_SHADOW_DB : hasHomeShadow ? SHADOW_DB : masterPath;

  if (!hasMasterDb()) {
    return {
      error: '🎧 No se encontró master.sqlite de Serato. Abre Serato DJ Pro primero.',
      masterDbPath: masterPath,
      activeDbPath,
      dbSource,
      sessionFile: masterPath,
      isCustomPath: isCustom,
      lastCheck: new Date().toLocaleTimeString()
    };
  }
  try {
    const rows = query('SELECT * FROM history_entry ORDER BY id DESC LIMIT 1');
    if (!rows.length) {
      return {
        error: '🎵 Historial listo. Reproduce una canción en Serato para sugerirte la siguiente.',
        masterDbPath: masterPath,
        activeDbPath,
        dbSource,
        sessionFile: masterPath,
        isCustomPath: isCustom,
        lastCheck: new Date().toLocaleTimeString()
      };
    }
    const current = mapRow(rows[0]);
    const histRows = query(
      'SELECT * FROM history_entry WHERE session_id = ' + Number(rows[0].session_id) + ' ORDER BY id'
    );
    return {
      current,
      history: histRows.map(mapRow),
      sessionFile: masterPath,
      masterDbPath: masterPath,
      activeDbPath,
      dbSource,
      isCustomPath: isCustom,
      lastCheck: new Date().toLocaleTimeString()
    };
  } catch (err) {
    try {
      const logger = require('./logger');
      logger.line('ERROR', 'nowPlaying master.sqlite', { msg: err.message, path: masterPath, dbSource });
    } catch (_) {}
    const isEperm = err.isEperm || /authorization denied|operation not permitted|EPERM|EACCES/i.test(err.message || '');
    return {
      isEperm,
      error: isEperm
        ? '🔒 macOS bloqueó el acceso. Ejecuta: npm run sync en el Terminal.'
        : '📡 Conectando con Serato DJ...',
      masterDbPath: masterPath,
      activeDbPath,
      dbSource,
      sessionFile: masterPath,
      isCustomPath: isCustom,
      rawError: err.message,
      lastCheck: new Date().toLocaleTimeString()
    };
  }
}

// ---------- Biblioteca ----------
// Estadísticas de reproducción DERIVADAS del historial real (history_entry).
// Serato no guarda un "play count" global en asset, pero SÍ registra cada play.
// Devuelve Map(portable_id -> { plays, lastPlayed(seg) })
function getPlayStats() {
  const stats = new Map();
  if (!hasMasterDb()) return stats;
  try {
    const rows = query(
      "SELECT portable_id, COUNT(*) AS plays, MAX(start_time) AS last_played " +
      "FROM history_entry WHERE portable_id IS NOT NULL AND portable_id != '' " +
      "GROUP BY portable_id"
    );
    for (const r of rows) {
      const pid = String(r.portable_id).replace(/^\/+/, '');
      stats.set(pid, {
        plays: Number(r.plays) || 0,
        lastPlayed: r.last_played != null ? Number(r.last_played) : null,
      });
    }
  } catch (err) {
    console.log('⚠️  getPlayStats falló:', err.message);
  }
  return stats;
}

function loadLibrary() {
  if (hasMasterDb()) {
    try {
      const base = ['name', 'file_name', 'artist', 'album', 'genre', 'key', 'bpm', 'portable_id'];
      // Agregar columnas ricas detectadas, con alias __campo para que mapRow las lea
      const fields = detectAssetFields();
      const aliasMap = {
        playCount: '__playCount', dateAdded: '__dateAdded', lastPlayed: '__lastPlayed',
        comment: '__comment', grouping: '__grouping', rating: '__rating',
        year: '__year', gain: '__gain', lengthMs: '__lengthMs', keyValue: '__keyValue',
      };
      const extra = [];
      for (const [field, col] of Object.entries(fields)) {
        const alias = aliasMap[field];
        if (alias) extra.push('"' + col + '" AS ' + alias);
      }
      const selectCols = base.concat(extra).join(', ');
      const rows = query(
        'SELECT ' + selectCols +
        ' FROM asset WHERE COALESCE(is_missing, 0) = 0 AND COALESCE(is_corrupt, 0) = 0'
      );
      if (rows.length) {
        _lastDetectedFields = Object.keys(fields);
        const mapped = rows.map(mapRow);
        // ¿Serato ya trae el play count nativo (dj_play_count)?
        const hasNativePC = !!fields.playCount;
        // Enriquecer con historial: play count (si no hay nativo) y última vez tocada (siempre)
        try {
          const stats = getPlayStats();
          _lastPlayStatsCount = stats.size;
          for (const t of mapped) {
            const pid = String(t.portable_id || '').replace(/^\/+/, '');
            const st = stats.get(pid);
            if (!hasNativePC) {
              // Sin columna nativa: derivar del historial (0 = nunca tocada)
              t.playCount = st ? st.plays : (t.playCount != null ? t.playCount : 0);
            } else if (t.playCount == null) {
              t.playCount = 0;
            }
            // La última vez tocada del historial es más precisa (timestamp real)
            if (st && st.lastPlayed) t.lastPlayed = st.lastPlayed;
          }
        } catch (_) { /* si falla, quedan con lo que trajo la columna */ }
        return mapped;
      }
    } catch (err) {
      console.log('⚠️  loadLibrary con columnas ricas falló, uso columnas base:', err.message);
      // Reintento solo con columnas base (por si un alias rompió)
      try {
        const rows = query(
          'SELECT name, file_name, artist, album, genre, key, bpm, portable_id ' +
          'FROM asset WHERE COALESCE(is_missing, 0) = 0 AND COALESCE(is_corrupt, 0) = 0'
        );
        if (rows.length) return rows.map(mapRow);
      } catch (_) { /* caer al formato antiguo */ }
    }
  }
  return loadLibraryLegacy();
}

let _lastDetectedFields = [];
let _lastPlayStatsCount = 0;
function getDetectedFields() { return _lastDetectedFields.slice(); }
function getPlayStatsCount() { return _lastPlayStatsCount; }
// Devuelve TODAS las columnas de la tabla asset (para diagnóstico/descubrir campos)
function getAssetColumns() { return getColumns('asset'); }

// ---------- Fallback: "database V2" binario (Serato <= 3.x) ----------
function utf16be(buf) {
  if (!buf || buf.length < 2) return '';
  const copy = Buffer.from(buf);
  if (copy.length % 2 !== 0) return copy.toString('utf8');
  return copy.swap16().toString('utf16le').replace(/\0+$/g, '');
}

const TRACK_TAGS = {
  pfil: 'path', tsng: 'title', tart: 'artist',
  tbpm: 'bpm', tkey: 'key', tgen: 'genre', tlen: 'length',
};

function parseTrackChunk(body) {
  const t = {};
  let i = 0;
  while (i + 8 <= body.length) {
    const tag = body.toString('latin1', i, i + 4);
    const len = body.readUInt32BE(i + 4);
    const name = TRACK_TAGS[tag];
    if (name) t[name] = utf16be(body.subarray(i + 8, i + 8 + len));
    i += 8 + len;
  }
  if (t.bpm) t.bpmNum = parseFloat(t.bpm) || null;
  return t;
}

function loadLibraryLegacy() {
  const dbFile = process.platform === 'win32'
    ? path.join(HOME, 'Music', '_Serato_', 'database V2')
    : path.join(HOME, 'Music', '_Serato_', 'database V2'); // It's actually the same in both!
    
  if (!fs.existsSync(dbFile)) return [];
  const buf = fs.readFileSync(dbFile);
  const tracks = [];
  let i = 0;
  while (i + 8 <= buf.length) {
    const tag = buf.toString('latin1', i, i + 4);
    const len = buf.readUInt32BE(i + 4);
    if (len > buf.length - i - 8) break;
    if (tag === 'otrk') {
      const t = parseTrackChunk(buf.subarray(i + 8, i + 8 + len));
      if (t.title || t.path) tracks.push(t);
    }
    i += 8 + len;
  }
  return tracks;
}

module.exports = {
  nowPlaying, loadLibrary, hasMasterDb, getMasterDbPath, MASTER_DB: getMasterDbPath(),
  getColumns, detectAssetFields, getDetectedFields,
  getPlayStats, getPlayStatsCount, getAssetColumns,
  loadConfig, saveConfig,
};
