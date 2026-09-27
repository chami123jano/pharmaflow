import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

/**
 * Preview only, never part of a real build.
 *
 * The alias is matched against the import specifier, not the resolved path, so
 * it has to be a regex matching the whole of '../lib/supabase', which is
 * how every page imports it.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    // The regex has to match the whole specifier: Vite replaces only the part
    // that matched, so a partial match leaves the "../" stuck on the front.
    alias: [{ find: /^\.{1,2}\/lib\/supabase$/, replacement: resolve(__dirname, 'src/__preview/stub.ts') }],
  },
  server: { port: 5176 },
});
