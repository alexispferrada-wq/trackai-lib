# trackai-lib

**Open core de TrackAI** — librería en JavaScript puro para leer la base de datos de **Serato DJ Pro** y su ecosistema:

- 📚 `master.sqlite` (SQLite): biblioteca `asset`, historial `history_entry` / `history_session`, play counts
- 📦 Crates (`~/Music/_Serato_/Subcrates/*.crate`): formato binario tag/length
- 📍 Cue points (`Serato Markers2`) y **beatgrid** (`Serato BeatGrid`) en MP3/AIFF (ID3v2 GEOB), **FLAC** (VORBIS_COMMENT) y **M4A/MP4** (atoms `----` de `com.serato.dj`)
- 🎼 Motor armónico Camelot: clasificación de transiciones + compatibilidad de BPM

**Todo en SOLO LECTURA** — nunca modifica tu biblioteca de Serato. Probado contra Serato DJ Pro 4.x en macOS y Windows.

## Por qué existe

Esta es la parte pública de [TrackAI](https://trackai.cl), el copiloto de mezcla en vivo para Serato DJ que lee en tiempo real lo que estás tocando y te sugiere la mejor próxima canción (BPM + armonía + crates + historial). TrackAI usa esta librería para todo lo que sabe de Serato.

## Instalación

```bash
git clone https://github.com/alexispferrada-wq/trackai-lib.git
cd trackai-lib
npm install
```

O como paquete npm: `npm install @alexisferrada/trackai-lib`.

Sin dependencias de runtime (solo `jest` para tests). Requiere `sqlite3` en el PATH (macOS lo trae en `/usr/bin/sqlite3`; en Windows usa `bin/win32/sqlite3.exe` de tu instalación o el PATH).

## Uso rápido

```js
const { serato, crates, seratoTags, harmonic } = require('@alexisferrada/trackai-lib');

// 1) ¿Qué estás tocando ahora en Serato?
const np = serato.nowPlaying();
console.log(np.current); // { title, artist, bpm, key, ... }

// 2) Toda tu biblioteca (solo lectura)
const tracks = serato.loadLibrary();
console.log(tracks.length, 'tracks en tu biblioteca');

// 3) Tus crates
const c = crates.loadCrates();
console.log(c.crateNames); // ['Reggaeton', 'Oldschool', ...]

// 4) Cue points de un MP3 (Serato Markers2)
const cues = seratoTags.readCues('/path/to/track.mp3');
console.log(cues); // { cues: [{ index, posMs, color, name }], firstCueMs, lastCueMs }

// 5) Beatgrid (MP3/AIFF/FLAC/M4A/MP4) — posiciones de beats + BPM
const bg = seratoTags.readBeatgrid('/path/to/track.flac');
console.log(bg); // { markers: [{ position, beatsToNext } | { position, bpm }] }

// 6) Transiciones armónicas (rueda Camelot)
const t = harmonic.classifyTransition('8A', '9A');
console.log(t.type); // 'energy_up'
console.log(harmonic.bpmCompat(125, 125.5, 'auto', 6)); // { compatible: true, ... }
```

## Cómo lee la base de datos de Serato

Serato DJ Pro 4.x guarda biblioteca e historial en:

```
macOS:   ~/Library/Application Support/Serato/Library/master.sqlite
Windows: %LOCALAPPDATA%\Serato\Library\master.sqlite
```

Tablas principales:

| Tabla | Contenido |
|-------|-----------|
| `asset` | Biblioteca completa (name, artist, bpm, key, genre, album, portable_id, `dj_play_count`, ...) |
| `history_session` | Sesiones de reproducción (fecha, hora, duración) |
| `history_entry` | Cada track reproducido (start_time, end_time, deck, session_id, portable_id) |

Detalles que aprendimos al construir esto:

- **`portable_id`** es la llave para cruzar biblioteca ↔ historial ↔ crates.
- **`dj_play_count`** es el play count nativo en Serato 4 (en versiones viejas se deriva contando `history_entry`).
- Los nombres de columnas **cambian entre versiones de Serato** → la librería usa `PRAGMA table_info` y selecciona solo las columnas que existen (ver `detectAssetFields`).
- `master.sqlite` se lee **en vivo**: se copia a una sombra en `os.tmpdir()` con WAL checkpoint para no bloquear a Serato ni arriesgar corrupción.

Los crates viven en `~/Music/_Serato_/Subcrates/*.crate` (formato binario `tag(4) + len(uint32 BE) + payload`, chunks `otrk`/`ptrk` con rutas en UTF-16 BE). Los cue points están en el frame **GEOB** de ID3v2 llamado `Serato Markers2`, codificado en base64.

## Configuración

| Variable | Efecto |
|----------|--------|
| `SERATO_LIB_DIR` | Carpeta para config/caché (default `~/.trackai`). Útil si tu app quiere aislar el estado. |

Config JSON en `~/.trackai/config.json` (o `$SERATO_LIB_DIR/config.json`):
```json
{ "customSeratoDbPath": "/ruta/manual/master.sqlite", "customSeratoCratesDir": "/ruta/crates" }
```

## Tests

```bash
npm test   # 8 tests: Camelot, BPM compat, cues Markers2 con MP3 sintético
```

## Estructura

```
src/
  serato.js        # master.sqlite: ahora tocando, biblioteca, play stats (solo lectura)
  serato-detect.js # auto-detección de instalaciones de Serato (local/nube/externo)
  crates.js        # lectura de crates .crate
  seratoTags.js    # cue points Serato Markers2 (ID3v2 GEOB)
  harmonic.js      # rueda Camelot + compatibilidad BPM
  logger.js        # log a ~/Documents/TrackAI-Logs/
  index.js         # exports
test/
  harmonic.test.js
  seratoTags.test.js
```

## Licencia

MIT — ver [LICENSE](LICENSE).

---

Hecho con 🎧 para la comunidad de DJs. Si construyes algo con esto, [TrackAI](https://trackai.cl) se hace con [la app completa](https://trackai.cl): IA que aprende tus transiciones, carga automática al plato y análisis en vivo.
