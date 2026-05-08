import { defineConfig } from 'vite';
import { existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, 'public');

// Vite's SPA fallback would otherwise return index.html for any missing path,
// including missing model files under /local-models/. HF transformers then
// tries to parse the HTML as an ONNX protobuf and crashes. Send a real 404.
function noSpaFallbackForLocalModels() {
  return {
    name: 'no-spa-fallback-for-local-models',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? '';
        const localIdx = url.indexOf('/local-models/');
        if (localIdx === -1) return next();
        const rel = url.slice(localIdx + 1).split('?')[0];
        const abs = join(PUBLIC_DIR, rel);
        if (existsSync(abs) && statSync(abs).isFile()) return next();
        res.statusCode = 404;
        res.end('Not Found');
      });
    },
  };
}

export default defineConfig({
  base: '/pii-anonymizer/',
  server: {
    host: true,
  },
  plugins: [noSpaFallbackForLocalModels()],
  worker: {
    format: 'es',
  },
  optimizeDeps: {
    // The PaddleOCR SDK ships its own worker entry as a sibling asset
    // (./assets/worker-entry-*.js) loaded via `new Worker(new URL(..., import.meta.url))`.
    // Vite's pre-bundling moves the main module to .vite/deps/ but doesn't
    // copy the sibling assets/, so the worker URL resolves to a non-existent
    // path and the SPA fallback returns index.html — the worker dies on spawn.
    // Excluding the SDK leaves it served straight from node_modules where the
    // relative `./assets/...` URL resolves correctly. Its CJS deps still need
    // pre-bundling though, so we force-include them.
    exclude: ['@paddleocr/paddleocr-js'],
    include: [
      '@paddleocr/paddleocr-js > clipper-lib',
      '@paddleocr/paddleocr-js > js-yaml',
      '@paddleocr/paddleocr-js > @techstark/opencv-js',
    ],
  },
  test: {
    globals: true,
    exclude: ['**/node_modules/**', '**/dist/**', 'e2e/**', '**/.claude/worktrees/**'],
  },
});
