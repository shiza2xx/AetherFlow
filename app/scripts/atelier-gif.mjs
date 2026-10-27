import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const defaults = { seconds: 5, fps: 20, width: 1280 };
const limits = { seconds: 15, fps: 30, width: 1920 };
const timeoutMs = 45000;
function parse(argv) {
  const command = argv.shift(); if (!['doctor', 'windows', 'capture', 'video', 'frames', 'inspect'].includes(command)) throw new Error('Use doctor, windows, capture, video, frames, or inspect.');
  const options = {};
  while (argv.length) { const key = argv.shift(); if (!key.startsWith('--') || argv.length === 0) throw new Error(`Missing value for ${key}.`); options[key.slice(2)] = argv.shift(); }
  return { command, options };
}
function binary(name, override, candidates = []) {
  const names = process.platform === 'win32' ? [`${name}.exe`] : [name];
  for (const candidate of [override, ...candidates, ...(process.env.PATH || '').split(path.delimiter).filter(Boolean).flatMap(dir => names.map(file => path.join(dir, file)))]) {
    if (candidate && path.isAbsolute(candidate) && fs.existsSync(candidate)) return candidate;
  }
  return null;
}
const ffmpeg = () => binary('ffmpeg', process.env.AETHERFLOW_FFMPEG_PATH || process.env.ATELIER_FFMPEG_PATH, [path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Microsoft', 'WinGet', 'Links', 'ffmpeg.exe')]);
const ffprobe = () => binary('ffprobe', process.env.AETHERFLOW_FFPROBE_PATH || process.env.ATELIER_FFPROBE_PATH, [ffmpeg() ? path.join(path.dirname(ffmpeg()), 'ffprobe.exe') : '']);
const number = (value, key, max) => { const result = Number(value ?? defaults[key]); if (!Number.isFinite(result) || result <= 0 || result > max) throw new Error(`${key} must be between 0 and ${max}.`); return result; };
function dimensions(options) { const width = number(options.width, 'width', limits.width); if (!Number.isInteger(width)) throw new Error('width must be a whole number of pixels.'); return { seconds: number(options.seconds, 'seconds', limits.seconds), fps: number(options.fps, 'fps', limits.fps), width }; }
function cropRect(value) { if (value === undefined) return null; const match = /^(\d+),(\d+),(\d+),(\d+)$/.exec(value); if (!match) throw new Error('--crop must be x,y,width,height using whole nonnegative pixel values.'); const [x,y,width,height] = match.slice(1).map(Number); if (![x,y,width,height].every(Number.isSafeInteger) || width < 1 || height < 1) throw new Error('--crop must have nonnegative x/y and positive whole-pixel width/height.'); return { x,y,width,height }; }
function absoluteExisting(value, label) { if (!path.isAbsolute(value)) throw new Error(`${label} must be an absolute path.`); const real = fs.realpathSync.native(value); if (!fs.statSync(real).isFile()) throw new Error(`${label} must be a file.`); return real; }
function absoluteOutput(value) { if (!path.isAbsolute(value)) throw new Error('Output path must be absolute.'); const target = path.resolve(value); if (fs.existsSync(target)) throw new Error('Output already exists; choose another path.'); fs.mkdirSync(path.dirname(target), { recursive: true }); return target; }
function parseGif(bytes) {
  if (bytes.length < 14 || !/^GIF8[79]a$/.test(bytes.toString('ascii', 0, 6)) || bytes.at(-1) !== 0x3b) throw new Error('File bytes are not a complete GIF.');
  const width = bytes.readUInt16LE(6), height = bytes.readUInt16LE(8); let p = 13, frames = 0, duration = 0, delay = 0;
  if (bytes[10] & 0x80) p += 3 * (1 << ((bytes[10] & 7) + 1));
  while (p < bytes.length) {
    const marker = bytes[p++]; if (marker === 0x3b) break;
    if (marker === 0x21) { if (p >= bytes.length) throw new Error('GIF extension is truncated.'); const label = bytes[p++]; if (label === 0xf9) { if (p + 6 > bytes.length || bytes[p] !== 4 || bytes[p + 5] !== 0) throw new Error('GIF frame control is malformed.'); delay = bytes.readUInt16LE(p + 2) * 10; } while (p < bytes.length) { const n = bytes[p++]; if (!n) break; p += n; if (p > bytes.length) throw new Error('GIF extension is truncated.'); } }
    else if (marker === 0x2c) { if (p + 9 > bytes.length) throw new Error('GIF frame descriptor is truncated.'); const flags = bytes[p + 8]; p += 9; if (flags & 0x80) p += 3 * (1 << ((flags & 7) + 1)); if (p >= bytes.length) throw new Error('GIF frame data is missing.'); p++; while (p < bytes.length) { const n = bytes[p++]; if (!n) break; p += n; if (p > bytes.length) throw new Error('GIF frame data is truncated.'); } frames++; duration += delay; delay = 0; }
    else throw new Error('GIF block marker is invalid.');
  }
  if (frames < 1 || p !== bytes.length) throw new Error('GIF has no complete frames.');
  return { width, height, frames, duration: duration / 1000, bytes: bytes.length };
}
export function validateProbeResult(stream, gif, byteCount) {
  const decodedFrames = Number(stream?.nb_read_frames), width = Number(stream?.width), height = Number(stream?.height), decodedDuration = Number(stream?.duration);
  if (!Number.isInteger(decodedFrames) || decodedFrames < 1) throw new Error('FFprobe did not return a successful decoded frame count.');
  if (decodedFrames !== gif.frames) throw new Error(`GIF decoded frame count (${decodedFrames}) does not match its complete structure (${gif.frames}); the file may be truncated or corrupt.`);
  if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1) throw new Error('FFprobe did not return valid decoded image dimensions.');
  if (!Number.isFinite(decodedDuration) || decodedDuration <= 0) throw new Error('FFprobe did not return a positive decoded duration.');
  return { width, height, frames: decodedFrames, duration: decodedDuration, bytes: byteCount };
}

async function probe(file) {
  const stream = await decodedStream(file);
  const gif = parseGif(fs.readFileSync(file));
  return validateProbeResult(stream, gif, fs.statSync(file).size);
}
async function decodedStream(file) {
  const probeBin = ffprobe(); if (!probeBin) throw new Error('ffprobe was not found. Set ATELIER_FFPROBE_PATH or install it beside FFmpeg.');
  const { stdout } = await execFileAsync(probeBin, ['-v','error','-threads','1','-count_frames','-select_streams','v:0','-show_entries','stream=width,height,nb_read_frames,duration:format=duration','-of','json',file], { timeout: timeoutMs, windowsHide: true, maxBuffer: 1024 * 1024 });
  const document = JSON.parse(stdout), stream = document.streams?.[0]; if (!stream) throw new Error('FFprobe found no readable video frames.');
  return { ...stream, duration: stream.duration ?? document.format?.duration };
}
async function probeNormalized(file) {
  const stream = await decodedStream(file), frames = Number(stream.nb_read_frames), width = Number(stream.width), height = Number(stream.height), duration = Number(stream.duration);
  if (!Number.isInteger(frames) || frames < 1 || !Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1 || !Number.isFinite(duration) || duration <= 0) throw new Error('FFprobe did not return valid normalized-stage frame facts.');
  return { frames, width, height, duration };
}
export function validateCompleteEncoding(normalized, encoded) {
  if (!Number.isInteger(normalized?.frames) || normalized.frames < 1 || !Number.isFinite(normalized?.duration) || normalized.duration <= 0 || !Number.isFinite(normalized?.fps) || normalized.fps <= 0) throw new Error('Normalized stage has invalid decoded frame facts.');
  if (encoded?.frames !== normalized.frames) throw new Error(`Encoded GIF frame count (${encoded?.frames}) does not match the normalized stage (${normalized.frames}); refusing to publish a partial encoding.`);
  if (!Number.isFinite(encoded?.duration) || encoded.duration <= 0) throw new Error('Encoded GIF has no valid decoded duration.');
  const toleranceSeconds = Math.max(0.02, 0.5 / normalized.fps);
  if (Math.abs(encoded.duration - normalized.duration) > toleranceSeconds) throw new Error(`Encoded GIF duration (${encoded.duration.toFixed(3)}s) does not match the normalized stage (${normalized.duration.toFixed(3)}s); refusing to publish a partial encoding.`);
  return { toleranceSeconds };
}
const UNITY_REPORT_GIF_BUDGET = Object.freeze({ maxEdge: 1920, maxCanvasPixels: 2073600, maxFrames: 450, maxCanvasPixelsAcrossFrames: 128000000 });
export function validateUnityReportGifBudget(facts) {
  const { maxEdge, maxCanvasPixels, maxFrames, maxCanvasPixelsAcrossFrames } = UNITY_REPORT_GIF_BUDGET;
  if (!Number.isInteger(facts?.width) || facts.width < 1 || !Number.isInteger(facts?.height) || facts.height < 1 || facts.width > maxEdge || facts.height > maxEdge || facts.width * facts.height > maxCanvasPixels) throw new Error('Unity report GIF exceeds its 1920-pixel edge or 2,073,600-pixel canvas limit; reduce resolution or duration.');
  if (!Number.isInteger(facts?.frames) || facts.frames < 1 || facts.frames > maxFrames || facts.width * facts.height * facts.frames > maxCanvasPixelsAcrossFrames) throw new Error('Unity report GIF exceeds its bounded playback workload; reduce resolution or duration.');
  return true;
}
async function visibleMotion(file, width, height) {
  const exe = ffmpeg(); if (!exe) throw new Error('FFmpeg was not found. Set ATELIER_FFMPEG_PATH or install it.');
  const sampleWidth = Math.min(160, width), sampleHeight = Math.max(1, Math.round(height * sampleWidth / width / 2) * 2);
  const { stdout } = await execFileAsync(exe, ['-hide_banner','-loglevel','error','-nostdin','-threads','1','-i',file,'-filter_threads','1','-filter_complex_threads','1','-vf',`fps=5,scale=${sampleWidth}:${sampleHeight}:flags=area,format=gray`,'-frames:v','32','-threads','1','-f','rawvideo','-'], { encoding: 'buffer', timeout: timeoutMs, windowsHide: true, maxBuffer: 1024 * 1024 });
  const frameBytes = sampleWidth * sampleHeight, count = Math.min(32, Math.floor(stdout.length / frameBytes));
  if (count < 2) return { visibleMotion: false, changedPixelFraction: 0, meanDifference: 0, sampleFrames: count, sampleWidth, sampleHeight, heuristic: '5 fps grayscale samples at up to 160 px wide; visible motion requires >1% pixels to change by >12 gray levels and mean difference >=3.' };
  let changed = 0, absolute = 0, comparisons = 0;
  for (let frame = 1; frame < count; frame++) for (const reference of [0, frame - 1]) for (let i = 0; i < frameBytes; i++) { const diff = Math.abs(stdout[frame * frameBytes + i] - stdout[reference * frameBytes + i]); absolute += diff; if (diff > 12) changed++; comparisons++; }
  const changedPixelFraction = changed / comparisons, meanDifference = absolute / comparisons;
  return { visibleMotion: changedPixelFraction > 0.01 && meanDifference >= 3, changedPixelFraction, meanDifference, sampleFrames: count, sampleWidth, sampleHeight, heuristic: '5 fps grayscale samples at up to 160 px wide; each frame is compared with the first and previous frame. Visible motion requires >1% pixels to change by >12 gray levels and mean difference >=3. Small or slow motion can be missed; compression and palette quantization can affect the estimate.' };
}
function psEncoded(source) { return Buffer.from(source, 'utf16le').toString('base64'); }
async function windows() {
  if (process.platform !== 'win32') throw new Error('Window enumeration is available on Windows only.');
  const script = `$src=@'\nusing System; using System.Text; using System.Runtime.InteropServices; public class AtelierWindows { public delegate bool EnumProc(IntPtr h, IntPtr l); [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left,Top,Right,Bottom; } [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l); [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder b, int n); [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h); [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h); [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out RECT r); }\n'@; Add-Type $src; $utf8=New-Object System.Text.UTF8Encoding($false); [Console]::OutputEncoding=$utf8; $OutputEncoding=$utf8; $rows=[System.Collections.Generic.List[object]]::new(); [AtelierWindows]::EnumWindows({ param($h,$l) if([AtelierWindows]::IsWindowVisible($h) -and -not [AtelierWindows]::IsIconic($h)){ $b=New-Object Text.StringBuilder 1024; [void][AtelierWindows]::GetWindowText($h,$b,$b.Capacity); if($b.Length){ $r=New-Object AtelierWindows+RECT; [void][AtelierWindows]::GetClientRect($h,[ref]$r); [void]$rows.Add(@{hwnd=('0x{0:X}' -f $h.ToInt64());title=$b.ToString();clientWidth=($r.Right-$r.Left);clientHeight=($r.Bottom-$r.Top)})} }; return $true },[IntPtr]::Zero)|Out-Null; ConvertTo-Json -InputObject @($rows.ToArray()) -Compress`;
  const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', psEncoded(script)], { timeout: 10000, windowsHide: true, maxBuffer: 1024 * 1024 });
  const rows = JSON.parse(stdout || '[]'); return Array.isArray(rows) ? rows : rows ? [rows] : [];
}
function quoteWindowsArg(value) { let result = '"', slashes = 0; for (const char of value) { if (char === '\\') { slashes++; continue; } if (char === '"') result += '\\'.repeat(slashes * 2 + 1) + '"'; else { result += '\\'.repeat(slashes) + char; } slashes = 0; } return result + '\\'.repeat(slashes * 2) + '"'; }
async function runFfmpeg(args) {
  const exe = ffmpeg(); if (!exe) throw new Error('FFmpeg was not found. Set ATELIER_FFMPEG_PATH or install it.');
  const argv = ['-hide_banner', '-loglevel', 'error', '-nostdin', ...args];
  if (process.platform !== 'win32') return execFileAsync(exe, argv, { timeout: timeoutMs, windowsHide: true, maxBuffer: 2 * 1024 * 1024 });
  const inner = `$p=New-Object System.Diagnostics.Process; $p.StartInfo.FileName=$env:ATELIER_GIF_EXE; $p.StartInfo.Arguments=$env:ATELIER_GIF_ARGS; $p.StartInfo.UseShellExecute=$false; $p.StartInfo.CreateNoWindow=$true; $p.StartInfo.RedirectStandardError=$true; $p.StartInfo.RedirectStandardOutput=$true; [void]$p.Start(); try{$p.PriorityClass=[System.Diagnostics.ProcessPriorityClass]::BelowNormal}catch{}; $err=$p.StandardError.ReadToEnd(); $out=$p.StandardOutput.ReadToEnd(); $p.WaitForExit(); [Console]::Error.Write($err); [Console]::Out.Write($out); exit $p.ExitCode`;
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', psEncoded(inner)], { windowsHide: true, env: { ...process.env, ATELIER_GIF_EXE: exe, ATELIER_GIF_ARGS: argv.map(quoteWindowsArg).join(' ') }, stdio: ['ignore', 'pipe', 'pipe'] });
  return new Promise((resolve, reject) => { let stdout = '', stderr = ''; const timer = setTimeout(() => { if (child.pid) spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).unref(); else child.kill(); reject(new Error('FFmpeg timed out after 45 seconds.')); }, timeoutMs); child.stdout.on('data', chunk => stdout += chunk); child.stderr.on('data', chunk => stderr += chunk); child.once('error', error => { clearTimeout(timer); reject(error); }); child.once('close', code => { clearTimeout(timer); code === 0 ? resolve({ stdout, stderr }) : reject(new Error(stderr.trim() || `FFmpeg exited with ${code}.`)); }); });
}
async function encode({ mode, inputArgs, out, seconds, fps, width, crop, captureSize, requireMotion = false }) {
  const target = absoluteOutput(out); if (path.extname(target).toLowerCase() !== '.gif') throw new Error('Output must use the .gif extension.');
  if (crop && (!captureSize || crop.x + crop.width > captureSize.width || crop.y + crop.height > captureSize.height)) throw new Error('--crop must fit entirely inside the selected window client area.');
  const scratch = process.env.AETHERFLOW_GIF_SCRATCH || process.env.ATELIER_GIF_SCRATCH || path.join(path.dirname(target), '.aetherflow-recording-temp'); if (!path.isAbsolute(scratch)) throw new Error('ATELIER_GIF_SCRATCH must be an absolute path.'); fs.mkdirSync(scratch, { recursive: true });
  const stageDir = fs.mkdtempSync(path.join(scratch, `atelier-gif-${process.pid}-`));
  const normalized = path.join(stageDir, 'normalized.mkv'), paletteFile = path.join(stageDir, 'palette.png'), staged = path.join(path.dirname(target), `.${path.basename(target, '.gif')}.atelier-${process.pid}-${crypto.randomUUID()}.gif`), stagedReceipt = `${staged}.json`, receiptPath = `${target}.json`, frames = Math.floor(seconds * fps);
  let publishedGif = false, publishedReceipt = false, outputHash = '';
  try {
    const boundedInputArgs = inputArgs.flatMap(argument => argument === '-i' ? ['-threads', '1', argument] : [argument]);
    const cropFilter = crop ? `crop=${crop.width}:${crop.height}:${crop.x}:${crop.y},` : '', normalizeFilter = `${cropFilter}fps=${fps},scale=w='min(iw,${width})':h=-2:flags=lanczos,format=yuv444p`;
    await runFfmpeg([...boundedInputArgs, '-t', String(seconds), '-frames:v', String(frames), '-vf', normalizeFilter, '-threads', '1', '-filter_threads', '1', '-filter_complex_threads', '1', '-an', '-c:v', 'ffv1', '-level', '3', '-y', normalized]);
    const normalizedFacts = await probeNormalized(normalized);
    await runFfmpeg(['-threads','1','-i',normalized,'-filter_threads','1','-filter_complex_threads','1','-vf','palettegen=max_colors=256:stats_mode=diff','-frames:v','1','-threads','1','-y',paletteFile]);
    await runFfmpeg(['-threads','1','-i',normalized,'-threads','1','-i',paletteFile,'-filter_threads','1','-filter_complex_threads','1','-lavfi','paletteuse=dither=sierra2_4a','-threads','1','-an','-fs',String(32*1024*1024),'-loop','0',staged]);
    const facts = await probe(staged); if (facts.frames < 2 || facts.duration <= 0 || facts.bytes > 32 * 1024 * 1024) throw new Error('Encoded GIF must contain at least two frames, positive duration, and be no larger than 32 MiB.');
    validateUnityReportGifBudget(facts);
    const completeness = validateCompleteEncoding({ frames: normalizedFacts.frames, duration: normalizedFacts.duration, fps }, facts);
    const motion = await visibleMotion(staged, facts.width, facts.height);
    if (requireMotion && !motion.visibleMotion) throw new Error('Encoded GIF is animated but does not pass the visible-motion heuristic.');
    const receipt = { schemaVersion: 1, output: target, width: facts.width, height: facts.height, frameCount: facts.frames, durationSeconds: facts.duration, bytes: facts.bytes, commandMode: mode, ...(crop ? { crop } : {}), completenessToleranceSeconds: completeness.toleranceSeconds, ...motion, createdAt: new Date().toISOString() };
    outputHash = requireHash(staged); fs.writeFileSync(stagedReceipt, JSON.stringify(receipt, null, 2), { flag: 'wx' });
    fs.copyFileSync(staged, target, fs.constants.COPYFILE_EXCL); publishedGif = true;
    fs.copyFileSync(stagedReceipt, receiptPath, fs.constants.COPYFILE_EXCL); publishedReceipt = true;
    return receipt;
  } catch (error) {
    if (publishedReceipt) fs.rmSync(receiptPath, { force: true });
    if (publishedGif && requireHash(target) === outputHash) fs.rmSync(target, { force: true });
    throw error;
  } finally { fs.rmSync(staged, { force: true }); fs.rmSync(stagedReceipt, { force: true }); for (const name of ['normalized.mkv','palette.png']) fs.rmSync(path.join(stageDir,name),{force:true}); fs.rmdirSync(stageDir); }
}
function requireHash(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
async function main(argv) {
  const { command, options } = parse(argv);
  if (command === 'doctor') { const a = ffmpeg(), b = ffprobe(); if (!a || !b) throw new Error('FFmpeg and ffprobe are both required.'); const { stdout } = await execFileAsync(a, ['-version'], { timeout: timeoutMs, windowsHide: true }); const gdigrab = process.platform === 'win32' && stdout.includes('ffmpeg version'); let supportsHwnd = false; if (gdigrab) { try { await execFileAsync(a, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-f', 'gdigrab', '-framerate', '1', '-i', 'hwnd=1', '-t', '0.1', '-frames:v', '1', '-f', 'null', '-'], { timeout: 5000, windowsHide: true }); } catch (error) { supportsHwnd = /window device context|Couldn.t get window/i.test(String(error.stderr || error.message)); } } console.log(JSON.stringify({ ffmpeg: a, ffprobe: b, gdigrab, supportsHwnd, version: stdout.split(/\r?\n/, 1)[0] }, null, 2)); return; }
  if (command === 'windows') { console.log(JSON.stringify(await windows(), null, 2)); return; }
  if (command === 'inspect') { const file = absoluteExisting(options.input, 'Input'), facts = await probe(file), motion = await visibleMotion(file, facts.width, facts.height); console.log(JSON.stringify({ ...facts, animated: facts.frames > 1 && facts.duration > 0, ...motion }, null, 2)); return; }
  const bounded = dimensions(options), crop = cropRect(options.crop), requireMotion = options['require-motion'] === undefined ? false : options['require-motion'] === 'true' ? true : options['require-motion'] === 'false' ? false : (() => { throw new Error('--require-motion must be true or false.'); })(), out = options.out; if (!out) throw new Error('--out is required.');
  if (command === 'capture') {
    if (process.platform !== 'win32') throw new Error('capture is available on Windows only; use video or frames for existing footage.');
    const hwnd = options.hwnd; if (!hwnd || !/^(?:0x[0-9a-f]+|\d+)$/i.test(hwnd)) throw new Error('--hwnd must be a visible window handle from the windows command.');
    const handle = BigInt(hwnd); if (handle <= 0n) throw new Error('Window handle must be positive.');
    const available = await windows(), selected = available.find(row => BigInt(row.hwnd) === handle); if (!selected) throw new Error('The selected visible window handle is not currently available.');
    if (!Number.isInteger(selected.clientWidth) || !Number.isInteger(selected.clientHeight) || selected.clientWidth < 1 || selected.clientHeight < 1) throw new Error('The selected window client dimensions could not be determined.');
    console.log(JSON.stringify(await encode({ mode: 'capture', inputArgs: ['-f', 'gdigrab', '-framerate', String(bounded.fps), '-draw_mouse', '0', '-t', String(bounded.seconds), '-i', `hwnd=${handle}`], out, ...bounded, crop, captureSize: { width: selected.clientWidth, height: selected.clientHeight }, requireMotion })));
  } else if (command === 'video') {
    const input = absoluteExisting(options.input, 'Input'); if (path.resolve(input) === path.resolve(out)) throw new Error('Output must differ from the source video.');
    if (crop) throw new Error('--crop is supported for window capture only.');
    console.log(JSON.stringify(await encode({ mode: 'video', inputArgs: ['-i', input], out, ...bounded, requireMotion })));
  } else {
    const pattern = options.pattern; if (!pattern || !path.isAbsolute(pattern) || !/%0?\d*d/.test(pattern) || path.extname(pattern).toLowerCase() !== '.png') throw new Error('--pattern must be an absolute numbered PNG pattern such as D:\\frames\\frame-%04d.png.');
    const first = pattern.replace(/%0?(\d*)d/, (_match, digits) => String(1).padStart(Number(digits) || 1, '0')); if (!fs.existsSync(first)) throw new Error(`First numbered frame is missing: ${first}`);
    if (crop) throw new Error('--crop is supported for window capture only.');
    console.log(JSON.stringify(await encode({ mode: 'frames', inputArgs: ['-framerate', String(bounded.fps), '-i', pattern], out, ...bounded, requireMotion })));
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2)).catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
