import type { Buffer } from 'node:buffer';

export interface ExtractedZipEntry {
  name: string;
  data: Buffer;
  directory: boolean;
}

export function crc32Bytes(buffer: Buffer): number;
export function extractZipArchive(bytes: Buffer): ExtractedZipEntry[];
