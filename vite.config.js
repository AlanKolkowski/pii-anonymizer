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
  test: {
    globals: true,
    exclude: ['**/node_modules/**', '**/dist/**', 'e2e/**', '**/.claude/worktrees/**'],
  },
});
