import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import * as path from 'path';

export default defineConfig({
  root: path.resolve(__dirname),
  base: './',
  build: {
    outDir: '../../dist/renderer',
    emptyOutDir: true
  },
  plugins: [react()],
});
