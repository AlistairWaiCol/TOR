import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: 'client',
  plugins: [react()],
  resolve: {
    alias: {
      // The game-rules modules in shared/ are imported by both server and client.
      '@shared': path.resolve(root, 'shared'),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    // Same-origin proxy so session cookies and the Socket.IO upgrade just work.
    proxy: {
      '/api': { target: 'http://localhost:3001', changeOrigin: true },
      '/socket.io': { target: 'http://localhost:3001', ws: true },
    },
    fs: { allow: [root] },
  },
  build: {
    outDir: path.resolve(root, 'dist'),
    emptyOutDir: true,
  },
});
