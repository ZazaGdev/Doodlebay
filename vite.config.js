// Builds the editor page from src/ into dist-renderer/, which main.js serves as app://excalidesk.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { cpSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = p => fileURLToPath(new URL(p, import.meta.url));
const out = here('./dist-renderer');

// Excalidraw loads its fonts from EXCALIDRAW_ASSET_PATH at runtime. Shipping them beside the
// page keeps every font working offline.
const fonts = here('./node_modules/@excalidraw/excalidraw/dist/prod/fonts');
const copyFonts = {
  name: 'copy-excalidraw-fonts',
  closeBundle() {
    if (existsSync(fonts)) cpSync(fonts, `${out}/fonts`, { recursive: true });
  },
};

export default defineConfig({
  root: here('./src'),
  base: './',
  plugins: [react(), copyFonts],
  define: { 'process.env.IS_PREACT': '"false"' },
  build: { outDir: out, emptyOutDir: true, chunkSizeWarningLimit: 5000 },
});
