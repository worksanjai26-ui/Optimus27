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
  server: {
    port: 5178,
    strictPort: false,
    host: true
  }
}));
