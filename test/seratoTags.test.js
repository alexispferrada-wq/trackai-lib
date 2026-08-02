const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseBeatgrid, readBeatgrid, readCues, secondsToBeatPosition } = require('../src/seratoTags');

function buildBeatgridBuffer(positions, bpm) {
  const parts = [Buffer.from([0x01, 0x00])];
  const count = Buffer.alloc(4);
  count.writeUInt32BE(positions.length, 0);
  parts.push(count);
  for (let i = 0; i < positions.length; i++) {
    const pos = Buffer.alloc(4);
    pos.writeFloatBE(positions[i], 0);
    parts.push(pos);
    if (i === positions.length - 1) {
      const b = Buffer.alloc(4);
      b.writeFloatBE(bpm, 0);
      parts.push(b);
    } else {
      const beats = Buffer.alloc(4);
      beats.writeUInt32BE(4, 0);
      parts.push(beats);
    }
  }
  parts.push(Buffer.from([0x37]));
  return Buffer.concat(parts);
}

describe('BeatGrid de Serato', () => {
  test('Parse simple: 1 marker terminal (position + bpm)', () => {
    const buf = buildBeatgridBuffer([0.5], 128.0);
    const res = parseBeatgrid(buf);
    expect(res).not.toBeNull();
    expect(res.markers).toHaveLength(1);
    expect(res.markers[0].position).toBeCloseTo(0.5, 3);
    expect(res.markers[0].bpm).toBeCloseTo(128.0, 3);
    expect(res.markers[0].beatsToNext).toBeUndefined();
  });

  test('Parse multi-marker: no terminales tienen beatsToNext, el último bpm', () => {
    const buf = buildBeatgridBuffer([0.5, 2.5, 4.5], 126.5);
    const res = parseBeatgrid(buf);
    expect(res.markers).toHaveLength(3);
    expect(res.markers[0].beatsToNext).toBe(4);
    expect(res.markers[1].beatsToNext).toBe(4);
    expect(res.markers[2].bpm).toBeCloseTo(126.5, 3);
    expect(res.markers[2].beatsToNext).toBeUndefined();
    expect(res.markers[0].position).toBeCloseTo(0.5, 3);
    expect(res.markers[2].position).toBeCloseTo(4.5, 3);
  });

  test('Buffer corrupto o vacío devuelve null', () => {
    expect(parseBeatgrid(null)).toBeNull();
    expect(parseBeatgrid(Buffer.alloc(3))).toBeNull();
    expect(parseBeatgrid(Buffer.alloc(100))).toBeNull();
  });

  test('readBeatgrid en archivo MP3 sintético (GEOB ID3v2)', () => {
    const bgBuf = buildBeatgridBuffer([1.0, 5.0], 100.0);
    const body = Buffer.concat([
      Buffer.from([0x00]),
      Buffer.from('audio/mpeg\0', 'latin1'),
      Buffer.from('\0', 'latin1'),
      Buffer.from('Serato BeatGrid\0', 'latin1'),
      bgBuf,
    ]);
    const frame = Buffer.concat([
      Buffer.from('GEOB'),
      (() => { const s = Buffer.alloc(4); s.writeUInt32BE(body.length, 0); return s; })(),
      body,
    ]);
    const size = (() => { const s = Buffer.alloc(4); s.writeUInt32BE(frame.length, 0); return s; })();
    const mp3 = Buffer.concat([Buffer.from('ID3'), Buffer.from([0x03, 0x00, 0x00]), size, frame, Buffer.alloc(32)]);

    const file = path.join(os.tmpdir(), 'trackai-test-beatgrid.mp3');
    fs.writeFileSync(file, mp3);
    try {
      const res = readBeatgrid(file);
      expect(res).not.toBeNull();
      expect(res.markers).toHaveLength(2);
      expect(res.markers[1].bpm).toBeCloseTo(100.0, 3);
    } finally {
      fs.unlinkSync(file);
    }
  });
});

describe('secondsToBeatPosition', () => {
  test('Grid con markers uniformes: calcula beat y compás', () => {
    // 128 BPM → 0.46875s por beat; markers cada 4 beats (1.875s)
    const grid = {
      markers: [
        { position: 0.0, beatsToNext: 4 },
        { position: 1.875, beatsToNext: 4 },
        { position: 3.75, bpm: 128 },
      ],
    };
    const p1 = secondsToBeatPosition(grid, 0.4);
    expect(p1).not.toBeNull();
    expect(p1.beat).toBe(1);
    expect(p1.bar).toBe(1);

    const p2 = secondsToBeatPosition(grid, 2.5);
    expect(p2.beat).toBe(6); // 4 beats del primer marker + 2 en el segundo tramo
    expect(p2.bar).toBe(2);

    const p3 = secondsToBeatPosition(grid, 4.5);
    expect(p3.beat).toBeGreaterThan(6);
  });

  test('Fuera de rango o sin grid → null', () => {
    expect(secondsToBeatPosition(null, 5)).toBeNull();
    expect(secondsToBeatPosition({ markers: [] }, 5)).toBeNull();
    expect(secondsToBeatPosition({ markers: [{ position: 10, bpm: 128 }] }, 3)).toBeNull();
    expect(secondsToBeatPosition({ markers: [{ position: 0, bpm: 128 }] }, -1)).toBeNull();
  });
});
