import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';

// Pin root to this config's directory so the dev server works
// regardless of the cwd it is launched from.
export default defineConfig(({ command }) => ({
  root: import.meta.dirname,
  // GitHub Pages serves the repo at https://<user>.github.io/Optimus27/, so production
  // builds need that sub-path. The dev server keeps serving from '/'.
  base: command === 'build' ? '/Optimus27/' : '/',
  // DEV_HTTPS=1 serves the dev site over https with a throwaway certificate, so a phone on the same Wi-Fi
  // is allowed to use its camera (browsers only allow cameras on https). Development only.
  plugins: [react(), ...(process.env.DEV_HTTPS && command === 'serve' ? [basicSsl()] : [])],
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
