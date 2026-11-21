import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// Only the proof's index.html is bundled; it is not part of the main Ignite
// frontend, DEV deployment, ChatGPT plugin, or any authenticated flow.
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: './',
  publicDir: false,
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    target: 'es2022',
    assetsInlineLimit: 0
  },
  server: { host: '127.0.0.1' }
});
