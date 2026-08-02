const fs = require('fs');
const os = require('os');
const path = require('path');
const { readBeatgrid, readCues } = require('../src/seratoTags');

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

function b64WithLinebreaks(buf) {
  const b64 = buf.toString('base64').replace(/=+$/, '');
  return b64.replace(/(.{72})/g, '$1\n').replace(/\n$/, '');
}

function seratoPayload(name, data) {
  return Buffer.concat([
    Buffer.from('application/octet-stream\0', 'latin1'),
    Buffer.from('\0', 'latin1'),
    Buffer.from(name + '\0', 'latin1'),
    data,
  ]);
}

function buildFlac(entries) {
  const comments = [];
  for (const [key, buf] of entries) {
    const val = b64WithLinebreaks(buf);
    const c = Buffer.from(key + '=' + val);
    const len = Buffer.alloc(4);
    len.writeUInt32LE(c.length, 0);
    comments.push(len, c);
  }
  const vendor = Buffer.from('TrackAI test');
  const vLen = Buffer.alloc(4);
  vLen.writeUInt32LE(vendor.length, 0);
  const count = Buffer.alloc(4);
  count.writeUInt32LE(entries.length, 0);

  const block = Buffer.concat([vLen, vendor, count, ...comments]);
  const blockHeader = Buffer.from([0x84]); // last=1, type=4 VORBIS_COMMENT
  const bLen = Buffer.alloc(3);
  bLen[0] = (block.length >> 16) & 0xff;
  bLen[1] = (block.length >> 8) & 0xff;
  bLen[2] = block.length & 0xff;

  const streamInfo = Buffer.alloc(34).fill(0);
  const siLen = Buffer.alloc(3);
  siLen[0] = (streamInfo.length >> 16) & 0xff;
  siLen[1] = (streamInfo.length >> 8) & 0xff;
  siLen[2] = streamInfo.length & 0xff;

  return Buffer.concat([
    Buffer.from('fLaC'),
    Buffer.from([0x00]), siLen, streamInfo, // STREAMINFO (no last)
    blockHeader, bLen, block,
    Buffer.alloc(64),
  ]);
}

function buildM4a(entries) {
  const ilstChildren = [];
  for (const [atomName, buf] of entries) {
    const payload = seratoPayload(atomName === 'markersv2' ? 'Serato Markers2' : 'Serato BeatGrid', buf);
    const b64 = buf.toString('base64').replace(/=+$/, '');
    const val = atomName === 'beatgrid' ? Buffer.from(b64) : Buffer.from(b64.replace(/(.{72})/g, '$1\n').replace(/\n$/, ''));

    const makeChild = (type, content) => {
      const body = Buffer.concat([Buffer.alloc(4), content]);
      const size = Buffer.alloc(4);
      size.writeUInt32BE(8 + body.length, 0);
      return Buffer.concat([size, Buffer.from(type), body]);
    };

    const mean = makeChild('mean', Buffer.from('com.serato.dj'));
    const name = makeChild('name', Buffer.from(atomName));
    const data = makeChild('data', Buffer.concat([Buffer.alloc(4), val]));

    const freeform = Buffer.concat([mean, name, data]);
    const ffSize = Buffer.alloc(4);
    ffSize.writeUInt32BE(8 + freeform.length, 0);
    ilstChildren.push(Buffer.concat([ffSize, Buffer.from('----'), freeform]));
  }

  const ilst = Buffer.concat(ilstChildren);
  const ilstSize = Buffer.alloc(4);
  ilstSize.writeUInt32BE(8 + ilst.length, 0);
  const ilstAtom = Buffer.concat([ilstSize, Buffer.from('ilst'), ilst]);

  const meta = Buffer.concat([Buffer.alloc(4), ilstAtom]);
  const metaSize = Buffer.alloc(4);
  metaSize.writeUInt32BE(8 + meta.length, 0);
  const metaAtom = Buffer.concat([metaSize, Buffer.from('meta'), meta]);

  const udta = metaAtom;
  const udtaSize = Buffer.alloc(4);
  udtaSize.writeUInt32BE(8 + udta.length, 0);
  const udtaAtom = Buffer.concat([udtaSize, Buffer.from('udta'), udta]);

  const moov = udtaAtom;
  const moovSize = Buffer.alloc(4);
  moovSize.writeUInt32BE(8 + moov.length, 0);
  const moovAtom = Buffer.concat([moovSize, Buffer.from('moov'), moov]);

  const ftypBody = Buffer.from('isom\0\0\0\0isomiso2mp41');
  const ftypSize = Buffer.alloc(4);
  ftypSize.writeUInt32BE(8 + ftypBody.length, 0);
  const ftypAtom = Buffer.concat([ftypSize, Buffer.from('ftyp'), ftypBody]);

  return Buffer.concat([ftypAtom, moovAtom, Buffer.alloc(32)]);
}

describe('Serato tags en FLAC', () => {
  let file;
  beforeAll(() => {
    const bg = buildBeatgridBuffer([0.25, 2.25, 4.25], 95.5);
    file = path.join(os.tmpdir(), 'trackai-test.flac');
    fs.writeFileSync(file, buildFlac([['SERATO_BEATGRID', seratoPayload('Serato BeatGrid', bg)]]));
  });
  afterAll(() => { try { fs.unlinkSync(file); } catch (_) {} });

  test('Lee el beatgrid desde VORBIS_COMMENT', () => {
    const res = readBeatgrid(file);
    expect(res).not.toBeNull();
    expect(res.markers).toHaveLength(3);
    expect(res.markers[0].position).toBeCloseTo(0.25, 3);
    expect(res.markers[2].bpm).toBeCloseTo(95.5, 3);
  });
});

describe('Serato tags en M4A/MP4', () => {
  let file;
  beforeAll(() => {
    const bg = buildBeatgridBuffer([1.0], 100.0);
    file = path.join(os.tmpdir(), 'trackai-test.m4a');
    fs.writeFileSync(file, buildM4a([['beatgrid', seratoPayload('Serato BeatGrid', bg)]]));
  });
  afterAll(() => { try { fs.unlinkSync(file); } catch (_) {} });

  test('Lee el beatgrid desde atoms ---- de com.serato.dj', () => {
    const res = readBeatgrid(file);
    expect(res).not.toBeNull();
    expect(res.markers).toHaveLength(1);
    expect(res.markers[0].bpm).toBeCloseTo(100.0, 3);
  });
});
