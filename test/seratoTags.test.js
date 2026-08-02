const fs = require('fs');
const os = require('os');
const path = require('path');
const { readCues, extractGeobFrames } = require('../src/seratoTags');

function buildMarkerPayload(cues) {
  const entries = [];
  for (const c of cues) {
    const typeBuf = Buffer.from('CUE', 'latin1');
    const body = Buffer.alloc(4 + c.name.length + 13);
    body[0] = 0x00;
    body[1] = c.index;
    body.writeUInt32BE(c.posMs, 2);
    body[6] = 0x00;
    body[7] = c.color[0];
    body[8] = c.color[1];
    body[9] = c.color[2];
    body[10] = 0x00;
    body[11] = 0x00;
    const nameBuf = Buffer.from(c.name, 'utf8');
    nameBuf.copy(body, 12);
    body[12 + nameBuf.length] = 0x00;
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32BE(body.length, 0);
    entries.push(Buffer.concat([typeBuf, Buffer.from([0x00]), lenBuf, body]));
  }
  return Buffer.concat([Buffer.from([0x01, 0x01]), ...entries]);
}

function buildMarkers2Frame(cues) {
  const payload = buildMarkerPayload(cues);
  const b64 = payload.toString('base64');
  const data = Buffer.concat([Buffer.from([0x01, 0x01]), Buffer.from(b64)]);
  const body = Buffer.concat([
    Buffer.from([0x00]),
    Buffer.from('audio/mpeg\0', 'latin1'),
    Buffer.from('\0', 'latin1'),
    Buffer.from('Serato Markers2\0', 'latin1'), data,
  ]);
  const header = Buffer.from('GEOB');
  const size = Buffer.alloc(4);
  size.writeUInt32BE(body.length, 0);
  return Buffer.concat([header, size, body]);
}

function buildFakeMp3(cues) {
  const frame = buildMarkers2Frame(cues);
  const size = Buffer.alloc(4);
  size.writeUInt32BE(frame.length, 0);
  const header = Buffer.concat([Buffer.from('ID3'), Buffer.from([0x03, 0x00, 0x00]), size]);
  return Buffer.concat([header, frame, Buffer.alloc(64)]);
}

describe('Cue points Serato Markers2 (ID3v2)', () => {
  let tmpFile;

  beforeAll(() => {
    const cues = [
      { index: 0, posMs: 12000, color: [255, 0, 0], name: 'Intro' },
      { index: 3, posMs: 45000, color: [0, 255, 0], name: 'Drop' },
    ];
    tmpFile = path.join(os.tmpdir(), 'trackai-test-cues.mp3');
    fs.writeFileSync(tmpFile, buildFakeMp3(cues));
  });

  afterAll(() => { try { fs.unlinkSync(tmpFile); } catch (_) {} });

  test('Extrae el frame GEOB de un MP3 sintético', () => {
    const frames = extractGeobFrames(tmpFile);
    expect(frames['Serato Markers2']).toBeTruthy();
  });

  test('Lee los cue points correctamente', () => {
    const res = readCues(tmpFile);
    expect(res).not.toBeNull();
    expect(res.cues).toHaveLength(2);
    expect(res.cues[0].posMs).toBe(12000);
    expect(res.cues[0].name).toBe('Intro');
    expect(res.cues[1].posMs).toBe(45000);
    expect(res.cues[1].color).toBe('#00ff00');
    expect(res.firstCueMs).toBe(12000);
    expect(res.lastCueMs).toBe(45000);
  });

  test('Ordena los cues por posición', () => {
    const res = readCues(tmpFile);
    const positions = res.cues.map((c) => c.posMs);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });
});
