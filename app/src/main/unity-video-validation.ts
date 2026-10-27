import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const probeTimeoutMs = 15000;
const maxVideoBytes = 32 * 1024 * 1024;

function ffprobePath() {
  const ffmpegOverride = process.env.AETHERFLOW_FFMPEG_PATH || process.env.ATELIER_FFMPEG_PATH;
  const executable = process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe';
  const pathCandidates = (process.env.PATH || '').split(path.delimiter).filter(Boolean).map(directory => path.join(directory, executable));
  const candidates = [process.env.AETHERFLOW_FFPROBE_PATH || process.env.ATELIER_FFPROBE_PATH, ffmpegOverride && path.isAbsolute(ffmpegOverride) ? path.join(path.dirname(ffmpegOverride), executable) : undefined, path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Microsoft', 'WinGet', 'Links', 'ffprobe.exe'), ...pathCandidates];
  for (const candidate of candidates) if (candidate && path.isAbsolute(candidate) && fs.existsSync(candidate)) return candidate;
  throw new Error('FFprobe was not found. Set ATELIER_FFPROBE_PATH or install it beside FFmpeg.');
}

function parseRate(value: unknown) {
  if (typeof value !== 'string') return NaN;
  const match = /^(\d+)\/(\d+)$/.exec(value);
  if (!match) return Number(value);
  const numerator = Number(match[1]), denominator = Number(match[2]);
  return denominator ? numerator / denominator : NaN;
}

export type UnityReportVideoFacts = { width: number; height: number; frameCount: number; frameRate: number; durationMs: number; bytes: number; codec: string; pixelFormat: string; container: string };

export function validateUnityReportVideoProbe(document: any, byteCount: number): UnityReportVideoFacts {
  if (!Number.isSafeInteger(byteCount) || byteCount < 1 || byteCount > maxVideoBytes) throw new Error('Video evidence must be a nonempty MP4 no larger than 32 MiB.');
  const stream = Array.isArray(document?.streams) ? document.streams.find((item: any) => item?.codec_type === 'video') : undefined;
  const format = document?.format;
  const container = typeof format?.format_name === 'string' ? format.format_name : '';
  if (!container.split(',').includes('mp4')) throw new Error('Video evidence must be an MP4 container.');
  if (!stream || stream.codec_name !== 'h264' || stream.pix_fmt !== 'yuv420p') throw new Error('Video evidence must use H.264 AVC with yuv420p pixels.');
  const width = Number(stream.width), height = Number(stream.height), frameCount = Number(stream.nb_read_frames);
  const frameRate = parseRate(stream.avg_frame_rate), streamDuration = Number(stream.duration), duration = Number.isFinite(streamDuration) && streamDuration > 0 ? streamDuration : Number(format.duration);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 1920 || height > 1920 || width * height > 2073600) throw new Error('MP4 dimensions exceed the 1920-pixel edge or 2,073,600-pixel canvas limit.');
  if (!Number.isInteger(frameCount) || frameCount < 2) throw new Error('MP4 must contain at least two decoded video frames.');
  if (!Number.isFinite(frameRate) || frameRate <= 0 || frameRate > 30) throw new Error('MP4 frame rate must be no greater than 30 fps.');
  if (!Number.isFinite(duration) || duration <= 0 || duration > 15) throw new Error('MP4 duration must be positive and no longer than 15 seconds.');
  return { width, height, frameCount, frameRate, durationMs: Math.round(duration * 1000), bytes: byteCount, codec: 'h264', pixelFormat: 'yuv420p', container };
}

export async function validateUnityReportVideo(file: string): Promise<UnityReportVideoFacts> {
  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.size < 1 || stat.size > maxVideoBytes) throw new Error('Video evidence must be a nonempty MP4 no larger than 32 MiB.');
  const args = ['-v', 'error', '-threads', '1', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=codec_type,codec_name,pix_fmt,width,height,avg_frame_rate,nb_read_frames,duration:format=format_name,duration', '-of', 'json', file];
  const { stdout } = await execFileAsync(ffprobePath(), args, { timeout: probeTimeoutMs, windowsHide: true, maxBuffer: 1024 * 1024 });
  let document: unknown;
  try { document = JSON.parse(stdout); } catch { throw new Error('FFprobe returned invalid media metadata.'); }
  return validateUnityReportVideoProbe(document, stat.size);
}
