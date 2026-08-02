// Motor armónico avanzado — rueda de Camelot completa + compatibilidad de BPM
// Clasifica la transición entre la canción actual y una candidata:
//   perfect  → misma tonalidad (Camelot igual)
//   energy   → +1 / -1 en la rueda (misma letra)  → sube/baja energía suave
//   relative → mismo número, cambia A/B (mayor<->menor)
//   boost    → +2 (mismo tono, salto de energía notorio)
//   dominant → +7 (quinta, subidón grande) / -7 idem
//   mood     → -3 (cambio de ánimo, arriesgado pero usado)
//   none     → sin relación armónica
'use strict';

const KEY_TO_CAMELOT = {
  'c': '8B', 'am': '8A',
  'db': '3B', 'c#': '3B', 'bbm': '3A', 'a#m': '3A',
  'd': '10B', 'bm': '10A',
  'eb': '5B', 'd#': '5B', 'cm': '5A',
  'e': '12B', 'c#m': '12A', 'dbm': '12A',
  'f': '7B', 'dm': '7A',
  'f#': '2B', 'gb': '2B', 'd#m': '2A', 'ebm': '2A',
  'g': '9B', 'em': '9A',
  'ab': '4B', 'g#': '4B', 'fm': '4A',
  'a': '11B', 'f#m': '11A', 'gbm': '11A',
  'bb': '6B', 'a#': '6B', 'gm': '6A',
  'b': '1B', 'g#m': '1A', 'abm': '1A',
};

function toCamelot(key) {
  if (!key) return null;
  const k = String(key).trim().toLowerCase();
  if (/^\d{1,2}[ab]$/.test(k)) return k.toUpperCase();
  const norm = k.replace(/\s*(maj|major)$/, '').replace(/\s*(min|minor|m)$/, 'm').replace(/\s+/g, '');
  return KEY_TO_CAMELOT[norm] || null;
}

function parseCamelot(c) {
  if (!c) return null;
  const m = String(c).toUpperCase().match(/^(\d{1,2})([AB])$/);
  if (!m) return null;
  return { num: parseInt(m[1], 10), letter: m[2] };
}

// distancia circular en la rueda (0..6)
function wheelDist(a, b) {
  const d = Math.abs(a - b);
  return Math.min(d, 12 - d);
}

// paso circular con signo (-6..+6): cuántos pasos de a hacia b
function wheelStep(a, b) {
  let d = b - a;
  while (d > 6) d -= 12;
  while (d < -6) d += 12;
  return d;
}

/**
 * Clasifica la transición armónica de "from" (actual) a "to" (candidata).
 * Devuelve { type, score, label, emoji } — score 0..1 (qué tan mezclable es).
 */
function classifyTransition(fromKey, toKey) {
  const a = parseCamelot(toCamelot(fromKey));
  const b = parseCamelot(toCamelot(toKey));
  if (!a || !b) return { type: 'unknown', score: 0, label: '—', emoji: '' };

  const sameLetter = a.letter === b.letter;
  const step = wheelStep(a.num, b.num); // signed
  const dist = wheelDist(a.num, b.num);

  // Perfecta: mismo Camelot exacto
  if (a.num === b.num && sameLetter) {
    return { type: 'perfect', score: 1.0, label: 'Perfecta', emoji: '🎯' };
  }
  // Relativa: mismo número, distinta letra (mayor<->menor)
  if (a.num === b.num && !sameLetter) {
    return { type: 'relative', score: 0.9, label: 'Relativa', emoji: '🔄' };
  }
  // Energía: ±1 misma letra
  if (sameLetter && dist === 1) {
    return step > 0
      ? { type: 'energy_up', score: 0.85, label: 'Energía +', emoji: '⚡' }
      : { type: 'energy_down', score: 0.8, label: 'Energía −', emoji: '🌊' };
  }
  // Boost: +2 misma letra (subidón notorio, muy usado)
  if (sameLetter && step === 2) {
    return { type: 'boost', score: 0.7, label: 'Boost +2', emoji: '🚀' };
  }
  // Dominante / quinta: +7 = +1 en realidad ya cubierto; la "quinta" en Camelot es ±1.
  // Salto de 7 posiciones (mood cambio fuerte) misma letra:
  if (sameLetter && dist === 7 % 12) {
    return { type: 'dominant', score: 0.55, label: 'Dominante', emoji: '🔥' };
  }
  // Mood: -3 misma letra (cambio de ánimo, arriesgado)
  if (sameLetter && step === -3) {
    return { type: 'mood', score: 0.5, label: 'Mood −3', emoji: '🎭' };
  }
  // Diagonal cercana: dist 1 con cambio de letra (aceptable con cuidado)
  if (!sameLetter && dist === 1) {
    return { type: 'diagonal', score: 0.45, label: 'Diagonal', emoji: '↗️' };
  }
  return { type: 'none', score: 0, label: 'Sin match', emoji: '' };
}

// Devuelve las tonalidades compatibles (para la mini-rueda de la UI)
function compatibleKeys(fromKey) {
  const a = parseCamelot(toCamelot(fromKey));
  if (!a) return null;
  const up = ((a.num % 12) + 1);
  const down = (a.num - 1 < 1 ? 12 : a.num - 1);
  const boost = ((a.num + 1) % 12) + 1; // +2
  const other = a.letter === 'A' ? 'B' : 'A';
  return {
    current: a.num + a.letter,
    perfect: a.num + a.letter,
    relative: a.num + other,
    energyUp: up + a.letter,
    energyDown: down + a.letter,
    boost: boost + a.letter,
  };
}

// ---------- BPM ----------
// Compatibilidad de BPM considerando el Live BPM (ritmo real en vivo) y multiplicadores de tiempo.
// Devuelve { compatible, pct, pitchShiftPct, targetBpm, type } donde type: 'same' | 'double' | 'half' | 'triplet' | 'none'
function pitchLimitForMode(mode = 'auto') {
  switch (mode) {
    case 'safe': return 2.0;
    case 'fresh': return 5.0;
    case 'up_only': return 7.0;
    case 'symmetric': return 6.0;
    case 'auto':
    default: return 3.0;
  }
}

function bpmCompat(fromBpm, toBpm, mode = 'auto', tolerancePct = 6, allowMultiples = true) {
  if (!fromBpm || !toBpm) return { compatible: false, pct: null, pitchShiftPct: null, type: 'none' };
  const pitchLimit = pitchLimitForMode(mode);
  
  const variants = allowMultiples ? [
    { mult: 1, type: 'same' },
    { mult: 2, type: 'double' },    // candidato al doble (ej: live 70 -> cand 140)
    { mult: 0.5, type: 'half' },    // candidato a la mitad (ej: live 140 -> cand 70)
    { mult: 1.5, type: 'triplet' }, // tresillo (ej: live 100 -> cand 150)
  ] : [
    { mult: 1, type: 'same' },
  ];
  let best = { compatible: false, pct: Infinity, pitchShiftPct: null, targetBpm: null, type: 'none' };
  
  for (const v of variants) {
    const target = fromBpm * v.mult;
    const pitchShift = ((target - toBpm) / toBpm) * 100; // Cuánto pitch mover en toBpm para llegar a target
    const pct = Math.abs(target - toBpm) / target * 100;
    
    let isCompatible = false;
    if (mode === 'up_only') {
      // Siempre Arriba: Pitch shift debe ser positivo (acelerar), o máximo una pequeñísima caída imperceptible (-0.3%)
      // Límite de aceleración: +7% (o pitchLimit del modo)
      isCompatible = pitchShift >= -0.3 && pitchShift <= pitchLimit;
    } else if (mode === 'symmetric') {
      // Simétrico: Tolerancia en ambas direcciones
      isCompatible = pct <= tolerancePct && Math.abs(pitchShift) <= pitchLimit;
    } else {
      // auto, ultra_ia, etc
      isCompatible = pct <= tolerancePct && Math.abs(pitchShift) <= pitchLimit;
    }

    if (isCompatible && pct < best.pct) {
      best = {
        compatible: true,
        pct: Math.round(pct * 10) / 10,
        pitchShiftPct: Math.round(pitchShift * 10) / 10,
        targetBpm: Math.round(target * 10) / 10,
        type: v.type,
      };
    }
  }
  return best;
}

// ¿Necesita un track "puente" por salto grande de BPM? (>tol y no double/half)
function needsBridge(fromBpm, toBpm, mode = 'auto', tolerancePct = 6) {
  const c = bpmCompat(fromBpm, toBpm, mode, tolerancePct);
  if (c.compatible) return false;
  if (!fromBpm || !toBpm) return false;
  const directPct = Math.abs(fromBpm - toBpm) / fromBpm * 100;
  return directPct > tolerancePct;
}

module.exports = {
  toCamelot, parseCamelot, classifyTransition, compatibleKeys,
  bpmCompat, needsBridge, wheelStep, wheelDist,
};
