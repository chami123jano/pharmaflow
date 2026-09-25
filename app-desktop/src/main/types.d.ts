// Type declarations for main process to satisfy TS when importing .sql or other assets (placeholder)

declare module '*.sql' {
  const value: string;
  export default value;
}

// Basic type shims to keep TS happy without pulling in full Node / Electron types
declare module 'electron' {
  const electron: any;
  export default electron;
  export const app: any;
  export const BrowserWindow: any;
  export const ipcMain: any;
  export const ipcRenderer: any;
  export const dialog: any;
  export const shell: any;
  export const contextBridge: any;
}
declare module 'electron-log' { const log: any; export default log; }
declare module 'electron-window-state' { const mod: any; export default mod; }
declare module 'path' { const path: any; export = path; }
declare module 'fs' { const fs: any; export = fs; }
declare module 'crypto' {
  export function randomUUID(): string;
  const crypto: { [k: string]: any };
  export default crypto;
}
declare module 'url' { export const fileURLToPath: any }
