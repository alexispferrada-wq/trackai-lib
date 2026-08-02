// trackai-lib — open core de TrackAI
// Lectura de la base de datos de Serato DJ Pro (master.sqlite), crates,
// tags Serato Markers2 y motor armónico Camelot. Todo en SOLO LECTURA.
'use strict';

const serato = require('./serato');
const seratoDetect = require('./serato-detect');
const crates = require('./crates');
const seratoTags = require('./seratoTags');
const harmonic = require('./harmonic');
const logger = require('./logger');

module.exports = {
  serato,
  seratoDetect,
  crates,
  seratoTags,
  harmonic,
  logger,
};
