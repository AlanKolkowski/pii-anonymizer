import { defineConfig } from 'vite';
import { createReadStream, existsSync, statSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, 'public');
const PDFJS_WASM_SRC = join(__dirname, 'node_modules/pdfjs-dist/wasm');
const PDFJS_WASM_URL_PREFIX = '/vendor/pdfjs/wasm/';

// Vite's SPA fallback would otherwise return index.html for any missing path,
// including missing model files under /local-models/ or /ocr-models/.
// HF transformers / the PaddleOCR tar loader then tries to parse the HTML as
// an ONNX protobuf or tar archive and crashes. Send a real 404 instead.
const NO_FALLBACK_PREFIXES = ['/local-models/', '/ocr-models/'];

// PDF.js v5 expects a `wasmUrl` pointing at a directory holding `jbig2.wasm`,
// `jbig2_nowasm_fallback.js`, `openjpeg.wasm`, etc. Vite's `?url` imports hash
// filenames and don't co-locate sibling assets, but PDF.js concatenates literal
// filenames (`${wasmUrl}jbig2_nowasm_fallback.js`), so we need a stable dir.
// Serve straight from node_modules in dev; emit the directory verbatim on build.
function pdfjsWasmAssets() {
  const SAFE_NAME = /^[\w.-]+$/;
  const CONTENT_TYPES = {
    wasm: 'application/wasm',
    js: 'application/javascript',
  };
  return {
    name: 'pdfjs-wasm-assets',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? '';
        const idx = url.indexOf(PDFJS_WASM_URL_PREFIX);
        if (idx === -1) return next();
        const filename = url.slice(idx + PDFJS_WASM_URL_PREFIX.length).split('?')[0];
        if (!SAFE_NAME.test(filename)) { res.statusCode = 404; res.end('Not Found'); return; }
        const abs = join(PDFJS_WASM_SRC, filename);
        if (!existsSync(abs) || !statSync(abs).isFile()) {
          res.statusCode = 404; res.end('Not Found'); return;
        }
        const ext = filename.split('.').pop();
        res.setHeader('Content-Type', CONTENT_TYPES[ext] ?? 'application/octet-stream');
        createReadStream(abs).pipe(res);
      });
    },
    generateBundle() {
      for (const f of readdirSync(PDFJS_WASM_SRC)) {
        if (f.startsWith('LICENSE_')) continue;
        this.emitFile({
          type: 'asset',
          fileName: `vendor/pdfjs/wasm/${f}`,
          source: readFileSync(join(PDFJS_WASM_SRC, f)),
        });
      }
    },
  };
}

function noSpaFallbackForLocalModels() {
  return {
    name: 'no-spa-fallback-for-local-models',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? '';
        const prefix = NO_FALLBACK_PREFIXES.find((p) => url.includes(p));
        if (!prefix) return next();
        const idx = url.indexOf(prefix);
        const rel = url.slice(idx + 1).split('?')[0];
        const abs = join(PUBLIC_DIR, rel);
        if (existsSync(abs) && statSync(abs).isFile()) return next();
        res.statusCode = 404;
        res.end('Not Found');
      });
    },
  };
}

export default defineConfig({
  // Keep asset URLs deployment-agnostic: Cloudflare Pages serves at /,
  // while the GitHub Pages fallback serves from /pii-anonymizer/.
  base: './',
  server: {
    host: true,
    port: process.env.PORT ? Number(process.env.PORT) : undefined,
    strictPort: !!process.env.PORT,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
    },
  },
  plugins: [pdfjsWasmAssets(), noSpaFallbackForLocalModels()],
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        tool: resolve(__dirname, 'tool.html'),
      },
    },
  },
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
