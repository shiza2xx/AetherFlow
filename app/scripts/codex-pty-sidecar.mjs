import readline from 'node:readline';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url);
let pty;
try{pty=require('node-pty');}catch(error){if(error?.code!=='MODULE_NOT_FOUND')throw error;const packaged=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..','app.asar.unpacked','node_modules','node-pty');if(!fs.existsSync(path.join(packaged,'package.json')))throw error;pty=require(packaged);}
import { createCodexTerminalProbeBridge } from './codex-terminal-probe-bridge.mjs';

let terminal = null;
let activeId = null;
let probeBridge = null;
const out = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
const bounded = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;
const line = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

line.on('line', raw => {
  if (raw.length > 256 * 1024) return out({ type: 'error', error: 'Sidecar command exceeded its size limit.' });
  let message;
  try { message = JSON.parse(raw); } catch { return out({ type: 'error', error: 'Malformed sidecar command.' }); }
  try {
    if (message.type === 'start') {
      if (terminal) throw new Error('A terminal is already running.');
      if (typeof message.id !== 'string' || !/^[a-f0-9-]{36}$/i.test(message.id)) throw new Error('Terminal id is invalid.');
      if (!Array.isArray(message.args) || message.args.length > 128 || message.args.some(value => typeof value !== 'string' || value.length > 32768)) throw new Error('Codex argument list is invalid.');
      if (typeof message.command !== 'string' || !message.command || typeof message.node !== 'string' || !message.node || typeof message.launcher !== 'string' || !message.launcher || typeof message.config !== 'string' || !message.config) throw new Error('Codex startup configuration is incomplete.');
      if (typeof message.cwd !== 'string' || !message.cwd || !bounded(message.cols, 20, 300) || !bounded(message.rows, 5, 120)) throw new Error('Terminal dimensions or working directory are invalid.');
      const env = { ...process.env, ...(message.env || {}), TERM: 'xterm-256color', LANG: 'en_US.UTF-8' };
      const quote = value => `"${String(value).replaceAll('"', '""')}"`;
      const batchCommand = `@echo off\r\nsetlocal DisableDelayedExpansion\r\nchcp 65001 >nul\r\nset "TERM=xterm-256color"\r\ncd /d ${quote(message.cwd)}\r\n${quote(message.node)} ${quote(message.launcher)} ${quote(message.config)}\r\n`;
      fs.writeFileSync(message.batch, batchCommand, { flag: 'wx' });
      const command = process.env.ComSpec || `${process.env.SystemRoot || 'C:\\Windows'}\\System32\\cmd.exe`;
      // /c couples the owned ConPTY lifetime to the launcher/Codex process.
      // A persistent /k prompt would leave an executable CMD shell behind after
      // Codex exits and could receive a later prepared request as shell input.
      // node-pty's bundled ConPTY DLL path avoids the separate console-list
      // helper used by its default hard-stop path. That helper races
      // AttachConsole against ConPTY teardown on Windows.
      terminal = pty.spawn(command, ['/d', '/q', '/c', 'call', message.batch], { name: 'xterm-256color', cols: message.cols, rows: message.rows, cwd: message.cwd, env, useConpty: true, useConptyDll: true, conptyInheritCursor: false });
      terminal.setEncoding('utf8');
      activeId = message.id;
      probeBridge=createCodexTerminalProbeBridge({foreground:message.env?.ATELIER_TERMINAL_FOREGROUND,background:message.env?.ATELIER_TERMINAL_BACKGROUND});
      terminal.onData(data => { const result=probeBridge.consume(data,value=>terminal?.write(value));if(result.output)out({ type: 'data', id: activeId, data:result.output }); });
      terminal.onExit(event => { const id = activeId; terminal = null; activeId = null; out({ type: 'exit', id, exitCode: event.exitCode, signal: event.signal }); line.close(); });
      out({ type: 'started', id: activeId, pid: terminal.pid, startedAtMs: Date.now() });
    } else if (!terminal || message.id !== activeId) throw new Error('Terminal is not owned by this sidecar.');
    else if (message.type === 'write') {
      if (typeof message.data !== 'string' || message.data.length > 8192) throw new Error('Terminal input exceeds its size limit.');
      terminal.write(message.data);
    } else if (message.type === 'resize') {
      if (!bounded(message.cols, 20, 300) || !bounded(message.rows, 5, 120)) throw new Error('Terminal size is outside the supported range.');
      terminal.resize(message.cols, message.rows);
    } else if (message.type === 'theme') {
      if (message.foreground !== undefined && !/^#[0-9a-f]{6}$/i.test(message.foreground) || message.background !== undefined && !/^#[0-9a-f]{6}$/i.test(message.background)) throw new Error('Terminal theme colors are invalid.');
      probeBridge?.setColors(message.foreground, message.background);
    } else if (message.type === 'stop') {
      const stopping = terminal, stoppingId = activeId;
      // Let the interactive CLI handle Ctrl-C and close its own PTY first. The
      // node-pty hard-kill path starts a console-enumeration helper that can
      // race AttachConsole against ConPTY teardown on Windows.
      stopping.write('\u0003');
      const fallback = setTimeout(() => { if (terminal === stopping && activeId === stoppingId) stopping.kill(); }, 1200);
      fallback.unref?.();
    }
    else throw new Error('Unsupported sidecar command.');
  } catch (error) { out({ type: 'error', id: message.id, error: error instanceof Error ? error.message : String(error) }); }
});

line.on('close', () => { try { terminal?.kill(); } catch {} });
