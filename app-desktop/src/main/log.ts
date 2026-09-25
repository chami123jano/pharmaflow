// Simple logger shim — avoids electron-log CJS-ESM interop crash in Electron 38
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';

let _logFile: string | null = null;
function logFile() {
  if (!_logFile) {
    try {
      const dir = path.join(app.getPath('userData'), 'logs');
      fs.mkdirSync(dir, { recursive: true });
      _logFile = path.join(dir, 'main.log');
    } catch { _logFile = null; }
  }
  return _logFile;
}

function write(level: string, ...args: any[]) {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 23);
  const msg = `[${ts}] [${level}]  ${args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')}`;
  console.log(msg);
  try {
    const f = logFile();
    if (f) fs.appendFileSync(f, msg + '\n');
  } catch {}
}

export default {
  info: (...args: any[]) => write('info', ...args),
  warn: (...args: any[]) => write('warn', ...args),
  error: (...args: any[]) => write('error', ...args),
  debug: (...args: any[]) => write('debug', ...args),
  verbose: (...args: any[]) => write('verbose', ...args),
};
