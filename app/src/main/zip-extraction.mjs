import { inflateRawSync } from 'node:zlib';

export function crc32Bytes(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Parse a bounded, single-disk ZIP archive after its source hash is verified. */
export function extractZipArchive(bytes) {
  if (bytes.length > 128 * 1024 * 1024) throw new Error('ZIP files over 128 MB cannot be expanded.');
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (bytes.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('ZIP central directory is missing.');
  const disk = bytes.readUInt16LE(eocd + 4), cdDisk = bytes.readUInt16LE(eocd + 6), diskCount = bytes.readUInt16LE(eocd + 8), count = bytes.readUInt16LE(eocd + 10), size = bytes.readUInt32LE(eocd + 12), offset = bytes.readUInt32LE(eocd + 16);
  if (disk || cdDisk || diskCount !== count || count > 5000 || offset + size !== eocd) throw new Error('ZIP directory limits or disk metadata are invalid.');
  let position = offset, total = 0;
  const seen = new Set(), entries = [];
  for (let index = 0; index < count; index++) {
    if (position + 46 > eocd || bytes.readUInt32LE(position) !== 0x02014b50) throw new Error('ZIP central directory entry is malformed.');
    const madeBy = bytes.readUInt16LE(position + 4), flags = bytes.readUInt16LE(position + 8), method = bytes.readUInt16LE(position + 10), crc = bytes.readUInt32LE(position + 16), compressed = bytes.readUInt32LE(position + 20), uncompressed = bytes.readUInt32LE(position + 24), nameLength = bytes.readUInt16LE(position + 28), extraLength = bytes.readUInt16LE(position + 30), commentLength = bytes.readUInt16LE(position + 32), diskStart = bytes.readUInt16LE(position + 34), external = bytes.readUInt32LE(position + 38), localOffset = bytes.readUInt32LE(position + 42), rawName = bytes.subarray(position + 46, position + 46 + nameLength);
    if (position + 46 + nameLength + extraLength + commentLength > eocd || diskStart || compressed === 0xffffffff || uncompressed === 0xffffffff || localOffset === 0xffffffff) throw new Error('ZIP64, multipart, or malformed records are not supported.');
    if (flags & 1 || flags & 0x40 || ![0, 8].includes(method)) throw new Error('Encrypted or unsupported ZIP compression is not allowed.');
    const name = rawName.toString(flags & 0x800 ? 'utf8' : 'latin1');
    if ((flags & 0x800) && !Buffer.from(name, 'utf8').equals(rawName)) throw new Error('ZIP filename is malformed UTF-8.');
    const normalized = name.replace(/\\/g, '/'), directory = normalized.endsWith('/'), parts = normalized.split('/');
    if (directory) parts.pop();
    const reserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
    if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized) || normalized.includes(':') || parts.some(part => {
      const folded = part.normalize('NFKC');
      return !part || folded === '.' || folded === '..' || /[ .]$/.test(folded) || /[<>:"|?*\u0000-\u001f\/\\]/.test(folded) || reserved.test(folded);
    }) || seen.has(normalized.toLocaleLowerCase('en-US').normalize('NFKC'))) throw new Error('ZIP contains an unsafe path or duplicate alias.');
    seen.add(normalized.toLocaleLowerCase('en-US').normalize('NFC'));
    const unixMode = (madeBy >> 8) === 3 ? external >>> 16 : 0;
    if ((unixMode & 0xf000) === 0xa000 || (unixMode && ![0x8000, 0x4000].includes(unixMode & 0xf000))) throw new Error('ZIP links and special file entries are not allowed.');
    if (uncompressed > 64 * 1024 * 1024 || compressed === 0 && uncompressed > 0 || compressed > 0 && uncompressed / compressed > 100) throw new Error('ZIP expansion limit exceeded.');
    if (localOffset + 30 > offset || bytes.readUInt32LE(localOffset) !== 0x04034b50) throw new Error('ZIP local header is invalid.');
    const localFlags = bytes.readUInt16LE(localOffset + 6), localMethod = bytes.readUInt16LE(localOffset + 8), localCrc = bytes.readUInt32LE(localOffset + 14), localCompressed = bytes.readUInt32LE(localOffset + 18), localUncompressed = bytes.readUInt32LE(localOffset + 22), localNameLength = bytes.readUInt16LE(localOffset + 26), localExtraLength = bytes.readUInt16LE(localOffset + 28), localName = bytes.subarray(localOffset + 30, localOffset + 30 + localNameLength);
    if (!localName.equals(rawName) || localFlags !== flags || localMethod !== method || (!(flags & 8) && (localCrc !== crc || localCompressed !== compressed || localUncompressed !== uncompressed))) throw new Error('ZIP local and central headers disagree.');
    const dataStart = localOffset + 30 + localNameLength + localExtraLength, dataEnd = dataStart + compressed;
    if (dataEnd > offset) throw new Error('ZIP compressed member overlaps the central directory.');
    const compressedData = bytes.subarray(dataStart, dataEnd);
    let data;
    if (method === 0) {
      if (compressed !== uncompressed) throw new Error('Stored ZIP member sizes disagree.');
      data = Buffer.from(compressedData);
    } else {
      data = inflateRawSync(compressedData, { maxOutputLength: Math.min(64 * 1024 * 1024, uncompressed + 1) });
    }
    if (data.length !== uncompressed || crc32Bytes(data) !== crc) throw new Error('ZIP output size or CRC does not match its directory.');
    total += data.length;
    if (total > 512 * 1024 * 1024) throw new Error('ZIP expansion limit exceeded.');
    entries.push({ name: normalized, data, directory });
    position += 46 + nameLength + extraLength + commentLength;
  }
  if (position !== offset + size) throw new Error('ZIP directory size is inconsistent.');
  return entries;
}
