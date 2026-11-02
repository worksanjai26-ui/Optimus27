import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Pin root to this config's directory so the dev server works
// regardless of the cwd it is launched from.
export default defineConfig({
  root: import.meta.dirname,
  plugins: [react()],
  server: {
    port: 5178,
    strictPort: false,
    host: true
  }
});
