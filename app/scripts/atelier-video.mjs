import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile), timeoutMs = 45000, maxBytes = 32 * 1024 * 1024;
const defaults = { seconds: 5, fps: 30, width: 1920 }, limits = { seconds: 15, fps: 30, width: 1920, canvasPixels: 2073600 };
const psEncoded = source => Buffer.from(source, 'utf16le').toString('base64');
function binary(name, override, candidates = []) {
  const files = process.platform === 'win32' ? [`${name}.exe`] : [name];
  for (const candidate of [override, ...candidates, ...(process.env.PATH || '').split(path.delimiter).filter(Boolean).flatMap(dir => files.map(file => path.join(dir, file)))]) if (candidate && path.isAbsolute(candidate) && fs.existsSync(candidate)) return candidate;
  return null;
}
const ffmpeg = () => binary('ffmpeg', process.env.AETHERFLOW_FFMPEG_PATH || process.env.ATELIER_FFMPEG_PATH, [path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Microsoft', 'WinGet', 'Links', 'ffmpeg.exe')]);
const ffprobe = () => binary('ffprobe', process.env.AETHERFLOW_FFPROBE_PATH || process.env.ATELIER_FFPROBE_PATH, [ffmpeg() ? path.join(path.dirname(ffmpeg()), 'ffprobe.exe') : '']);
function parse(argv) { const command = argv.shift(); if (!['doctor', 'windows', 'capture', 'video', 'inspect'].includes(command)) throw new Error('Use doctor, windows, capture, video, or inspect.'); const options = {}; while (argv.length) { const key = argv.shift(); if (!key.startsWith('--') || !argv.length) throw new Error(`Missing value for ${key}.`); options[key.slice(2)] = argv.shift(); } return { command, options }; }
function number(value, key, max) { const result = Number(value ?? defaults[key]); if (!Number.isFinite(result) || result <= 0 || result > max) throw new Error(`${key} must be greater than zero and no more than ${max}.`); return result; }
function settings(options) { const seconds = number(options.seconds, 'seconds', limits.seconds), fps = number(options.fps, 'fps', limits.fps), width = number(options.width, 'width', limits.width); if (![seconds, fps, width].every(Number.isInteger)) throw new Error('seconds, fps, and width must be whole numbers.'); return { seconds, fps, width }; }
export function parseCrop(value) { if (value === undefined) return null; const match = /^(\d+),(\d+),(\d+),(\d+)$/.exec(value); if (!match) throw new Error('--crop must be x,y,width,height using whole nonnegative pixel values.'); const [x, y, width, height] = match.slice(1).map(Number); if (![x, y, width, height].every(Number.isSafeInteger) || width < 1 || height < 1) throw new Error('--crop must have nonnegative x/y and positive whole-pixel width/height.'); return { x, y, width, height }; }
function absoluteExisting(value, label) { if (!value || !path.isAbsolute(value)) throw new Error(`${label} must be an absolute path.`); const real = fs.realpathSync.native(value); if (!fs.statSync(real).isFile()) throw new Error(`${label} must be a file.`); return real; }
function absoluteOutput(value) { if (!value || !path.isAbsolute(value)) throw new Error('Output path must be absolute.'); const target = path.resolve(value); if (fs.existsSync(target)) throw new Error('Output already exists; choose another path.'); fs.mkdirSync(path.dirname(target), { recursive: true }); return target; }
function rate(value) { const match = /^(\d+)\/(\d+)$/.exec(String(value)); return match && Number(match[2]) ? Number(match[1]) / Number(match[2]) : Number(value); }
export function validateVideoProbe(document, bytes) {
  const stream = document?.streams?.find(item => item?.codec_type === 'video'), container = document?.format?.format_name || '', width = Number(stream?.width), height = Number(stream?.height), frames = Number(stream?.nb_read_frames), fps = rate(stream?.avg_frame_rate), duration = Number(stream?.duration ?? document?.format?.duration);
  if (!Number.isSafeInteger(bytes) || bytes < 1 || bytes > maxBytes) throw new Error('Encoded MP4 must be nonempty and no larger than 32 MiB.');
  if (!container.split(',').includes('mp4') || stream?.codec_name !== 'h264' || stream?.pix_fmt !== 'yuv420p') throw new Error('Encoded video must be H.264 AVC in an MP4 container with yuv420p pixels.');
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 1920 || height > 1920 || width * height > limits.canvasPixels) throw new Error('Encoded MP4 exceeds the 1920-pixel edge or 2,073,600-pixel canvas limit.');
  if (!Number.isInteger(frames) || frames < 2 || !Number.isFinite(fps) || fps <= 0 || fps > limits.fps || !Number.isFinite(duration) || duration <= 0 || duration > limits.seconds) throw new Error('Encoded MP4 must have at least two decoded frames, at most 30 fps, and a positive duration no longer than 15 seconds.');
  return { width, height, frames, fps, duration, bytes, codec: 'h264', pixelFormat: 'yuv420p', container };
}
async function probeDocument(file, countFrames = true) {
  const exe = ffprobe(); if (!exe) throw new Error('ffprobe was not found. Set ATELIER_FFPROBE_PATH or install it beside FFmpeg.');
  const frameArgs = countFrames ? ['-count_frames', '-select_streams', 'v:0'] : ['-select_streams', 'v:0'];
  const { stdout } = await execFileAsync(exe, ['-v', 'error', '-threads', '1', ...frameArgs, '-show_entries', 'stream=codec_type,codec_name,pix_fmt,width,height,avg_frame_rate,nb_read_frames,duration:format=format_name,duration', '-of', 'json', file], { timeout: timeoutMs, windowsHide: true, maxBuffer: 1024 * 1024 });
  return JSON.parse(stdout);
}
async function inspect(file) { const stat = fs.statSync(file); let document; try { document = await probeDocument(file); } catch { throw new Error('FFprobe could not decode this MP4.'); } return validateVideoProbe(document, stat.size); }
async function motion(file, width, height, duration) {
  const exe = ffmpeg(); if (!exe) throw new Error('FFmpeg was not found.'); const sw = Math.min(160, width), sh = Math.max(2, Math.floor(height * sw / width / 2) * 2);
  const sampleFps = Math.min(5, 32 / duration);
  const { stdout } = await execFileAsync(exe, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-threads', '1', '-i', file, '-filter_threads', '1', '-vf', `fps=${sampleFps},scale=${sw}:${sh}:flags=area,format=gray`, '-frames:v', '32', '-threads', '1', '-f', 'rawvideo', '-'], { encoding: 'buffer', timeout: timeoutMs, windowsHide: true, maxBuffer: 1024 * 1024 });
  const size = sw * sh, count = Math.min(32, Math.floor(stdout.length / size)); let changed = 0, total = 0, abs = 0;
  for (let frame = 1; frame < count; frame++) for (const ref of [0, frame - 1]) for (let i = 0; i < size; i++) { const d = Math.abs(stdout[frame * size + i] - stdout[ref * size + i]); if (d > 12) changed++; abs += d; total++; }
  const changedPixelFraction = total ? changed / total : 0, meanDifference = total ? abs / total : 0;
  return { visibleMotion: changedPixelFraction > 0.01 && meanDifference >= 3, changedPixelFraction, meanDifference, sampleFrames: count, sampleWidth: sw, sampleHeight: sh, heuristic: 'Grayscale samples at up to 5 fps across the full clip, resized to at most 160 px wide; each frame is compared with the first and previous frame. Motion requires >1% pixels to change by >12 gray levels and mean difference >=3; small or slow motion may be missed.' };
}
function hash(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function quoteWindowsArg(value) { let result = '"', slashes = 0; for (const char of value) { if (char === '\\') { slashes++; continue; } if (char === '"') result += '\\'.repeat(slashes * 2 + 1) + '"'; else { result += '\\'.repeat(slashes) + char; } slashes = 0; } return result + '\\'.repeat(slashes * 2) + '"'; }
async function runFfmpeg(args) {
  const exe = ffmpeg(); if (!exe) throw new Error('FFmpeg was not found. Set ATELIER_FFMPEG_PATH or install it.'); const argv = ['-hide_banner', '-loglevel', 'error', '-nostdin', ...args];
  if (process.platform !== 'win32') return execFileAsync(exe, argv, { timeout: timeoutMs, windowsHide: true, maxBuffer: 2 * 1024 * 1024 });
  const inner = `$p=New-Object System.Diagnostics.Process; $p.StartInfo.FileName=$env:ATELIER_VIDEO_EXE; $p.StartInfo.Arguments=$env:ATELIER_VIDEO_ARGS; $p.StartInfo.UseShellExecute=$false; $p.StartInfo.CreateNoWindow=$true; $p.StartInfo.RedirectStandardError=$true; $p.StartInfo.RedirectStandardOutput=$true; [void]$p.Start(); try{$p.PriorityClass=[System.Diagnostics.ProcessPriorityClass]::BelowNormal}catch{}; $err=$p.StandardError.ReadToEnd(); $out=$p.StandardOutput.ReadToEnd(); $p.WaitForExit(); [Console]::Error.Write($err); [Console]::Out.Write($out); exit $p.ExitCode`;
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', psEncoded(inner)], { windowsHide: true, env: { ...process.env, ATELIER_VIDEO_EXE: exe, ATELIER_VIDEO_ARGS: argv.map(quoteWindowsArg).join(' ') }, stdio: ['ignore', 'pipe', 'pipe'] });
  return new Promise((resolve, reject) => { let stdout = '', stderr = ''; const timer = setTimeout(() => { if (child.pid) spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).unref(); else child.kill(); reject(new Error('FFmpeg timed out after 45 seconds.')); }, timeoutMs); child.stdout.on('data', chunk => stdout += chunk); child.stderr.on('data', chunk => stderr += chunk); child.once('error', error => { clearTimeout(timer); reject(error); }); child.once('close', code => { clearTimeout(timer); code === 0 ? resolve({ stdout, stderr }) : reject(new Error(stderr.trim() || `FFmpeg exited with ${code}.`)); }); });
}
async function windows() {
  if (process.platform !== 'win32') throw new Error('Window enumeration is available on Windows only.');
  const script = `$src=@'
using System; using System.Text; using System.Runtime.InteropServices; public class AtelierVideoWindows { public delegate bool EnumProc(IntPtr h, IntPtr l); [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left,Top,Right,Bottom; } [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l); [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder b, int n); [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h); [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h); [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out RECT r); [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h, ref POINT p); [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X,Y; }
}
'@; Add-Type $src; $utf8=New-Object System.Text.UTF8Encoding($false); [Console]::OutputEncoding=$utf8; $OutputEncoding=$utf8; $rows=[System.Collections.Generic.List[object]]::new(); [AtelierVideoWindows]::EnumWindows({ param($h,$l) if([AtelierVideoWindows]::IsWindowVisible($h) -and -not [AtelierVideoWindows]::IsIconic($h)){ $b=New-Object Text.StringBuilder 1024; [void][AtelierVideoWindows]::GetWindowText($h,$b,$b.Capacity); if($b.Length){ $r=New-Object AtelierVideoWindows+RECT; [void][AtelierVideoWindows]::GetClientRect($h,[ref]$r); $pt=New-Object AtelierVideoWindows+POINT; [void][AtelierVideoWindows]::ClientToScreen($h,[ref]$pt); [void]$rows.Add(@{hwnd=('0x{0:X}' -f $h.ToInt64());title=$b.ToString();clientWidth=($r.Right-$r.Left);clientHeight=($r.Bottom-$r.Top);screenX=$pt.X;screenY=$pt.Y})} }; return $true },[IntPtr]::Zero)|Out-Null; ConvertTo-Json -InputObject @($rows.ToArray()) -Compress`;
  const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', psEncoded(script)], { timeout: 10000, windowsHide: true, maxBuffer: 1024 * 1024 }); const rows = JSON.parse(stdout || '[]'); return Array.isArray(rows) ? rows : rows ? [rows] : [];
}
function requiredMotion(value) { if (value === undefined || value === 'false') return false; if (value === 'true') return true; throw new Error('--require-motion must be true or false.'); }
async function transcode({ mode, inputArgs, out, seconds, fps, width, crop, captureSize, requireMotion = false, expectedDuration }) {
  const target = absoluteOutput(out); if (path.extname(target).toLowerCase() !== '.mp4') throw new Error('Output must use the .mp4 extension.');
  if (crop && (!captureSize || crop.x + crop.width > captureSize.width || crop.y + crop.height > captureSize.height)) throw new Error('--crop must fit entirely inside the selected window client area.');
  const scratch = process.env.AETHERFLOW_VIDEO_SCRATCH || process.env.ATELIER_VIDEO_SCRATCH || path.join(path.dirname(target), '.aetherflow-recording-temp'); if (!path.isAbsolute(scratch)) throw new Error('ATELIER_VIDEO_SCRATCH must be an absolute path.'); fs.mkdirSync(scratch, { recursive: true });
  const stageDir = fs.mkdtempSync(path.join(scratch, `atelier-video-${process.pid}-`)), staged = path.join(path.dirname(target), `.${path.basename(target, '.mp4')}.atelier-${process.pid}-${crypto.randomUUID()}.mp4`), stagedReceipt = `${staged}.json`, receiptPath = `${target}.json`;
  let published = false, publishedReceipt = false, outputHash = '';
  try {
    const frameLimit = Math.floor(seconds * fps), cropFilter = crop ? `crop=${crop.width}:${crop.height}:${crop.x}:${crop.y},` : '', maxHeight = Math.floor(limits.canvasPixels / width);
    const filter = `${cropFilter}fps=${fps},scale=w='min(iw,${width})':h='min(ih,${maxHeight})':force_original_aspect_ratio=decrease:force_divisible_by=2,format=yuv420p`;
    const boundedInput = inputArgs.flatMap(arg => arg === '-i' ? ['-threads', '1', arg] : [arg]);
    await runFfmpeg([...boundedInput, '-t', String(seconds), '-frames:v', String(frameLimit), '-vf', filter, '-filter_threads', '1', '-threads', '1', '-an', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '17', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-fs', String(maxBytes), '-y', staged]);
    const stat = fs.statSync(staged); let document; try { document = await probeDocument(staged); } catch { throw new Error('FFprobe could not decode the completed MP4 output.'); }
    const facts = validateVideoProbe(document, stat.size), tolerance = Math.max(0.1, 1 / fps);
    if (Math.abs(facts.duration - expectedDuration) > tolerance) throw new Error(`Encoded video duration (${facts.duration.toFixed(3)} s) does not match the available source duration (${expectedDuration.toFixed(3)} s); refusing a partial MP4.`);
    const motionFacts = await motion(staged, facts.width, facts.height, facts.duration); if (requireMotion && !motionFacts.visibleMotion) throw new Error('Encoded MP4 does not pass the visible-motion heuristic.');
    const receipt = { schemaVersion: 1, output: target, width: facts.width, height: facts.height, frameCount: facts.frames, frameRate: facts.fps, durationSeconds: facts.duration, bytes: facts.bytes, commandMode: mode, ...(crop ? { crop } : {}), ...motionFacts, createdAt: new Date().toISOString() };
    outputHash = hash(staged); fs.writeFileSync(stagedReceipt, JSON.stringify(receipt, null, 2), { flag: 'wx' }); fs.copyFileSync(staged, target, fs.constants.COPYFILE_EXCL); published = true; fs.copyFileSync(stagedReceipt, receiptPath, fs.constants.COPYFILE_EXCL); publishedReceipt = true; return receipt;
  } catch (error) { if (publishedReceipt) fs.rmSync(receiptPath, { force: true }); if (published && hash(target) === outputHash) fs.rmSync(target, { force: true }); throw error; }
  finally { fs.rmSync(staged, { force: true }); fs.rmSync(stagedReceipt, { force: true }); fs.rmdirSync(stageDir); }
}
async function main(argv) {
  const { command, options } = parse(argv);
  if (command === 'doctor') { const a = ffmpeg(), b = ffprobe(); if (!a || !b) throw new Error('FFmpeg and ffprobe are both required.'); const { stdout } = await execFileAsync(a, ['-version'], { timeout: timeoutMs, windowsHide: true }), devices = await execFileAsync(a, ['-hide_banner', '-devices'], { timeout: timeoutMs, windowsHide: true }); console.log(JSON.stringify({ ffmpeg: a, ffprobe: b, gdigrab: process.platform === 'win32' && /\bD\s+gdigrab\b/.test(devices.stdout), version: stdout.split(/\r?\n/, 1)[0] }, null, 2)); return; }
  if (command === 'windows') { console.log(JSON.stringify(await windows(), null, 2)); return; }
  if (command === 'inspect') { const file = absoluteExisting(options.input, 'Input'), facts = await inspect(file), motionFacts = await motion(file, facts.width, facts.height, facts.duration); console.log(JSON.stringify({ ...facts, animated: facts.frames > 1 && facts.duration > 0, ...motionFacts }, null, 2)); return; }
  const bounded = settings(options), crop = parseCrop(options.crop), requireMotion = requiredMotion(options['require-motion']), out = options.out; if (!out) throw new Error('--out is required.');
  if (command === 'capture') {
    if (process.platform !== 'win32') throw new Error('capture is available on Windows only; use video for existing footage.');
    const hwnd = options.hwnd; if (!hwnd || !/^(?:0x[0-9a-f]+|\d+)$/i.test(hwnd) || BigInt(hwnd) <= 0n) throw new Error('--hwnd must be a positive visible window handle from the windows command.');
    const handle = BigInt(hwnd), selected = (await windows()).find(row => BigInt(row.hwnd) === handle); if (!selected) throw new Error('The selected visible window handle is not currently available.');
    if (!Number.isInteger(selected.clientWidth) || !Number.isInteger(selected.clientHeight) || selected.clientWidth < 1 || selected.clientHeight < 1) throw new Error('The selected window client dimensions could not be determined.');
    console.log(JSON.stringify(await transcode({ mode: 'capture', inputArgs: ['-f', 'gdigrab', '-framerate', String(bounded.fps), '-draw_mouse', '0', '-i', `hwnd=${handle}`], out, ...bounded, crop, captureSize: { width: selected.clientWidth, height: selected.clientHeight }, requireMotion, expectedDuration: bounded.seconds })));
  } else {
    const input = absoluteExisting(options.input, 'Input'); if (path.resolve(input) === path.resolve(out)) throw new Error('Output must differ from the source video.'); if (crop) throw new Error('--crop is supported for window capture only.');
    let document; try { document = await probeDocument(input, false); } catch { throw new Error('FFprobe could not read the source video.'); } const sourceDuration = Number(document?.format?.duration); if (!Number.isFinite(sourceDuration) || sourceDuration <= 0) throw new Error('Input video has no positive duration.');
    console.log(JSON.stringify(await transcode({ mode: 'video', inputArgs: ['-i', input], out, ...bounded, crop, requireMotion, expectedDuration: Math.min(bounded.seconds, sourceDuration) })));
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2)).catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
