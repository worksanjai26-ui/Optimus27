import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Pin root to this config's directory so the dev server works
// regardless of the cwd it is launched from.
export default defineConfig(({ command }) => ({
  root: import.meta.dirname,
  // GitHub Pages serves the repo at https://<user>.github.io/Optimus27/, so production
  // builds need that sub-path. The dev server keeps serving from '/'.
  base: command === 'build' ? '/Optimus27/' : '/',
  plugins: [react()],
  build: {
    // three.js and React rarely change, so they ship as their own cached files and download in
    // parallel with the site code; the 3D engine alone is ~600 kB, so the size warning is expected.
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks: (id: string) =>
          id.includes('node_modules/three') ? 'three'
          : /node_modules\/(react|react-dom|scheduler)\//.test(id) ? 'react'
          : undefined
      }
    }
  },
  server: {
    port: 5178,
    strictPort: false,
    host: true
  }
}));
