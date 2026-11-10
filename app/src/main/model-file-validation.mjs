import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

function fail(extension) {
  throw new Error(`File signature does not match or structure is invalid for ${extension}.`);
}

function validateFbx(bytes) {
  if (bytes.length < 64 || bytes.length > 512 * 1024 * 1024) throw new Error('FBX file is truncated or exceeds the model limit.');
  if (bytes.subarray(0, 23).equals(Buffer.from('Kaydara FBX Binary  \x00\x1a\x00', 'binary'))) {
    const version = bytes.readUInt32LE(23);
    if (version < 7000 || version > 8000) throw new Error('FBX version is unsupported.');
    const wide = version >= 7500, record = wide ? 25 : 13, limit = BigInt(bytes.length), names = new Set();
    let offset = 27, complete = false;
    while (offset + record <= bytes.length) {
      const end = wide ? bytes.readBigUInt64LE(offset) : BigInt(bytes.readUInt32LE(offset));
      const propertyLength = wide ? bytes.readBigUInt64LE(offset + 16) : BigInt(bytes.readUInt32LE(offset + 8));
      const nameLength = bytes[offset + (wide ? 24 : 12)];
      if (end === 0n) { complete = true; break; }
      if (end > limit || end < BigInt(offset + record + nameLength) || propertyLength > end - BigInt(offset + record + nameLength)) throw new Error('FBX node bounds are invalid.');
      names.add(bytes.toString('utf8', offset + record, offset + record + nameLength));
      offset = Number(end);
    }
    if (!complete || !names.has('Objects')) throw new Error('FBX object structure is incomplete.');
    return;
  }
  const text = bytes.toString('utf8');
  if (!/FBXHeaderExtension\s*:/i.test(text) || !/Objects\s*:/i.test(text) || !/(Geometry|Model)\s*:/i.test(text)) throw new Error('ASCII FBX object structure is incomplete.');
}

/** Hash and validate one managed model from the same bounded read stream. */
export async function validateModelFile(input) {
  const before = fs.lstatSync(input.file), extension = input.extension;
  const limits = { '.obj': 128 * 1024 * 1024, '.fbx': 512 * 1024 * 1024, '.glb': 512 * 1024 * 1024, '.blend': 2 * 1024 * 1024 * 1024 };
  const limit = limits[extension];
  if (!limit) throw new Error(`Unsupported model extension: ${extension}.`);
  if (!before.isFile() || before.isSymbolicLink() || fs.realpathSync.native(input.file) !== path.resolve(input.file) || before.size < 1 || before.size > limit) {
    if (extension === '.fbx') throw new Error('FBX file is truncated or exceeds the model limit.');
    if (extension === '.obj') throw new Error('OBJ validation exceeds 128 MB.');
    throw new Error('Managed model is missing, unsafe, or exceeds the model limit.');
  }
  const bytes = Buffer.allocUnsafe(extension === '.blend' ? 0 : before.size), header = Buffer.alloc(32), hash = crypto.createHash('sha256');
  let offset = 0;
  for await (const chunk of fs.createReadStream(input.file, { highWaterMark: 1024 * 1024 })) {
    if (offset + chunk.length > before.size) throw new Error('Managed model changed size while it was being checked.');
    if (offset < 32) chunk.copy(header, offset, 0, Math.min(chunk.length, 32 - offset));
    if (bytes.length) chunk.copy(bytes, offset);
    hash.update(chunk);
    offset += chunk.length;
  }
  const after = fs.lstatSync(input.file);
  if (offset !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs || after.ino !== before.ino || after.dev !== before.dev || hash.digest('hex') !== input.hash) {
    throw new Error('Managed output hash does not match its bytes.');
  }
  const head = bytes.length ? bytes.subarray(0, 32) : header;
  if (extension === '.glb') {
    if (head.toString('ascii', 0, 4) !== 'glTF' || head.readUInt32LE(4) !== 2 || head.readUInt32LE(8) !== bytes.length || bytes.length > 512 * 1024 * 1024) fail(extension);
    const jsonLength = bytes.readUInt32LE(12);
    if (jsonLength < 2 || 20 + jsonLength > bytes.length || bytes.readUInt32LE(16) !== 0x4e4f534a) fail(extension);
    JSON.parse(bytes.toString('utf8', 20, 20 + jsonLength).replace(/[\s\u0000]+$/g, ''));
    let end = 20 + jsonLength;
    if (end < bytes.length) {
      if (end + 8 > bytes.length || bytes.readUInt32LE(end + 4) !== 0x004e4942) fail(extension);
      end += 8 + bytes.readUInt32LE(end);
    }
    if (end !== bytes.length) fail(extension);
  } else if (extension === '.fbx') {
    validateFbx(bytes);
  } else if (extension === '.obj') {
    if (!/^\s*(?:#|o\s|g\s|v[tn]?\s|f\s|mtllib\s)/m.test(bytes.toString('utf8', 0, 32))) fail(extension);
    if (bytes.length > 128 * 1024 * 1024) throw new Error('OBJ validation exceeds 128 MB.');
    const vertices = [0];
    let hasFace = false, lineStart = 0;
    while (lineStart <= bytes.length) {
      let lineEnd = lineStart;
      while (lineEnd < bytes.length && bytes[lineEnd] !== 10) lineEnd++;
      const line = bytes.toString('utf8', lineStart, lineEnd).trim();
      const vertex = line.match(/^v\s+([-+\d.eE]+)\s+([-+\d.eE]+)\s+([-+\d.eE]+)/);
      if (vertex) {
        if (!vertex.slice(1).every(value => Number.isFinite(Number(value)))) fail(extension);
        vertices.push(1);
      }
      const face = line.match(/^f\s+(.+)/);
      if (face) {
        const ids = face[1].split(/\s+/).map(value => Number(value.split('/')[0]));
        if (ids.length < 3 || ids.some(value => !Number.isInteger(value) || value === 0 || Math.abs(value) >= vertices.length)) throw new Error('OBJ face references invalid or missing vertices.');
        hasFace = true;
      }
      if (lineEnd === bytes.length) break;
      lineStart = lineEnd + 1;
    }
    if (!hasFace) throw new Error('OBJ contains no valid face data.');
  } else if (extension === '.blend') {
    if (!(head.toString('ascii', 0, 7) === 'BLENDER' || head.subarray(0, 4).equals(Buffer.from('28b52ffd', 'hex')))) fail(extension);
  } else {
    throw new Error(`Unsupported model extension: ${extension}.`);
  }
  return { hash: input.hash, extension };
}
