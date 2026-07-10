// Desktop (Electron) renderer build. Wraps the fork's vite.config.js without
// modifying it, so upstream merges stay trivial. Differences vs the web build:
//   - VITE_* flags flip the fork's env-guarded offline switches (local models,
//     local ORT WASM, local OCR detection model, INT8 dtype),
//   - ORT WASM runtimes are vendored into the bundle (vendor/ort/,
//     vendor/ort-paddle/) instead of being fetched from jsDelivr,
//   - Google Fonts + Buy-Me-a-Coffee tags are stripped from the HTML (they
//     would be blocked at runtime anyway; stripping keeps the blocked-request
//     counter at zero — proof of no egress),
//   - output goes to dist-desktop/ so the web build in dist/ is untouched,
//   - dev server additionally serves models/ at the same URL prefixes the
//     app:// protocol uses in production.
import { defineConfig } from 'vite';
import { createReadStream, existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import baseConfig from './vite.config.js';
import { readModelManifest } from './scripts/verify-models.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MODELS_DIR = join(__dirname, 'models');

// The renderer must be built for exactly the ONNX variant that was downloaded.
// manifest.json (written by scripts/fetch-models.mjs) is the single source of
// truth: a `MODEL_DTYPE=fp16 npm run desktop:fetch-models` followed by a plain
// renderer build used to produce an app that requested model_fp16.onnx while
// only model_quantized.onnx was on disk — a 404 at first classify.
const modelManifest = readModelManifest();

// Offline switches consumed by env-guarded code in the fork's src/ (see
// src/worker.js, src/pipeline/model-download.js, src/pipeline/configs/
// entity-sources.js, src/ocr/models.js, src/ocr/paddle.js). Setting them here
// means plain `vite build` (web) keeps stock behavior.
process.env.VITE_LOCAL_MODELS = '1';
process.env.VITE_MODEL_DTYPE = modelManifest.dtype;
process.env.VITE_ORT_WASM_PATHS = '/vendor/ort/';
process.env.VITE_PADDLE_ORT_WASM_PATHS = '/vendor/ort-paddle/';
process.env.VITE_OCR_DET_LOCAL = '1';

// ORT WASM runtime files to vendor. NER: the exact dist that transformers.js
// 3.8.1 would fetch from jsDelivr. PaddleOCR: onnxruntime-web 1.22.0 (the
// version the web app pins on the CDN today), installed under the
// `onnxruntime-web-v122` npm alias.
const ORT_VENDOR_SETS = [
  {
    urlPrefix: '/vendor/ort/',
    dir: join(__dirname, 'node_modules/@huggingface/transformers/dist'),
    files: ['ort-wasm-simd-threaded.jsep.mjs', 'ort-wasm-simd-threaded.jsep.wasm'],
  },
  {
    urlPrefix: '/vendor/ort-paddle/',
    dir: join(__dirname, 'node_modules/onnxruntime-web-v122/dist'),
    files: [
      'ort-wasm-simd-threaded.jsep.mjs',
      'ort-wasm-simd-threaded.jsep.wasm',
      'ort-wasm-simd-threaded.mjs',
      'ort-wasm-simd-threaded.wasm',
      'ort.bundle.min.mjs',
    ],
  },
];

const DEV_MIME = {
  '.mjs': 'text/javascript',
  '.js': 'text/javascript',
  '.wasm': 'application/wasm',
  '.json': 'application/json',
  '.onnx': 'application/octet-stream',
  '.tar': 'application/x-tar',
};

function devMime(path) {
  const ext = path.slice(path.lastIndexOf('.'));
  return DEV_MIME[ext] ?? 'application/octet-stream';
}

function serveFile(res, absPath) {
  res.setHeader('Content-Type', devMime(absPath));
  res.setHeader('Content-Length', statSync(absPath).size);
  createReadStream(absPath).pipe(res);
}

// Serves vendored ORT files + local models on the dev server, mirroring what
// electron/app-protocol.mjs serves in production. Must be registered BEFORE
// the fork's noSpaFallbackForLocalModels middleware (which 404s /local-models/
// paths missing from public/) — hence this plugin sits first in `plugins`.
function desktopLocalAssets() {
  return {
    name: 'desktop-local-assets',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? '').split('?')[0];
        let decoded;
        try {
          decoded = decodeURIComponent(url);
        } catch {
          return next();
        }
        if (decoded.includes('..')) return next();

        for (const set of ORT_VENDOR_SETS) {
          if (decoded.startsWith(set.urlPrefix)) {
            const name = decoded.slice(set.urlPrefix.length);
            if (!set.files.includes(name)) break;
            return serveFile(res, join(set.dir, name));
          }
        }

        const modelRoutes = [
          { prefix: '/local-models/', dir: join(MODELS_DIR, 'ner') },
          { prefix: '/ocr-models/', dir: join(MODELS_DIR, 'ocr') },
        ];
        for (const route of modelRoutes) {
          if (!decoded.startsWith(route.prefix)) continue;
          const abs = join(route.dir, decoded.slice(route.prefix.length));
          if (existsSync(abs) && statSync(abs).isFile()) return serveFile(res, abs);
        }
        return next();
      });
    },
    generateBundle() {
      for (const set of ORT_VENDOR_SETS) {
        for (const name of set.files) {
          this.emitFile({
            type: 'asset',
            fileName: `${set.urlPrefix.slice(1)}${name}`,
            source: readFileSync(join(set.dir, name)),
          });
        }
      }
      // License texts ride along with the vendored binaries.
      for (const set of ORT_VENDOR_SETS) {
        const licensePath = join(set.dir, '..', 'LICENSE');
        if (existsSync(licensePath)) {
          this.emitFile({
            type: 'asset',
            fileName: `${set.urlPrefix.slice(1)}LICENSE.txt`,
            source: readFileSync(licensePath),
          });
        }
      }
    },
  };
}

// Strips remote-only tags from the HTML entries for the offline desktop build:
// Google Fonts (preconnect + stylesheet) and the Buy-Me-a-Coffee script.
// TODO(parytet): self-host the Inter/Instrument Serif/JetBrains Mono fonts so
// desktop typography matches the web app instead of falling back to system fonts.
function desktopHtmlTransform() {
  return {
    name: 'desktop-html-transform',
    transformIndexHtml: {
      // 'pre': operate on the source HTML before Vite rewrites script tags —
      // removing the bmc-button tag here keeps it out of the bundle entirely.
      order: 'pre',
      handler(html, ctx) {
        // Fail loudly if an upstream HTML change makes a pattern stop matching:
        // a silently surviving remote tag would only show up as a blocked
        // request at runtime, breaking the "counter stays at zero" guarantee.
        const rules = [
          { name: 'google-fonts', re: /[ \t]*<link[^>]*href=["']https:\/\/fonts\.(googleapis|gstatic)\.com[^"']*["'][^>]*>\r?\n?/g, min: 1 },
          { name: 'bmc-button', re: /[ \t]*<script[^>]*src=["']\/src\/bmc-button\.js["'][^>]*><\/script>\r?\n?/g, min: 1 },
          // WebMCP is a self-reconnecting WebSocket client (public/webmcp.js) —
          // a ready-made exfiltration path with no place in an air-gapped
          // desktop build. src/main.js already no-ops its own WebMCP usage on
          // desktop (window.desktopApp?.isDesktop), but the script tag itself
          // must not ship either; see SECURITY-FIXES.md B2. Scoped to tool.html
          // only: index.html (the marketing shell) never had this tag.
          { name: 'webmcp', re: /[ \t]*<script[^>]*src=["']webmcp\.js["'][^>]*><\/script>\r?\n?/g, min: 1, only: '/tool.html' },
          // The Buy-Me-a-Coffee slot's fallback <a> would survive as a dead
          // external link (setWindowOpenHandler denies it). Drop the whole slot
          // — a donation button has no place in a law-firm tool.
          // TODO(parytet): slot i fallback pozostają w źródłach forka; gdyby
          // wersja webowa miała być budowana z tej samej konfiguracji, trzeba
          // to zbramkować osobną flagą.
          { name: 'bmc-slot', re: /[ \t]*<div class="bmc-nav-slot"[^>]*>[\s\S]*?<\/div>\r?\n?/g, min: 1 },
        ];
        let out = html;
        for (const rule of rules) {
          if (rule.only && rule.only !== ctx.path) continue;
          const hits = out.match(rule.re)?.length ?? 0;
          if (hits < rule.min) {
            throw new Error(
              `[desktop-html-transform] w ${ctx.path} nie znaleziono wzorca "${rule.name}" `
              + '(upstream zmienił HTML?). Zaktualizuj regułę — inaczej build desktopowy '
              + 'przemyci odwołanie zdalne.',
            );
          }
          out = out.replace(rule.re, '');
        }
        return out;
      },
    },
  };
}

// Vite's publicDir copy lands public/webmcp.js in dist-desktop/ regardless of
// whether any HTML references it — desktopHtmlTransform above only strips the
// <script> tag. Delete the dead file too, so the desktop bundle contains no
// WebMCP code at all, not just no reference to it. See SECURITY-FIXES.md B2.
function desktopStripWebmcpAsset() {
  return {
    name: 'desktop-strip-webmcp-asset',
    apply: 'build',
    closeBundle() {
      const webmcpAsset = join(__dirname, 'dist-desktop', 'webmcp.js');
      if (existsSync(webmcpAsset)) rmSync(webmcpAsset);
    },
  };
}

// Last line of defence at build time: nothing the shipped renderer *fetches*
// may point at a remote origin. Catches a new upstream CDN tag, a stale
// vendored wasmPaths constant, a dependency that hardcodes a CDN — anything
// the HTML rules above would miss. The runtime layers (network guard §3,
// CSP §6) would block such a request anyway, but then the "licznik
// zablokowanych żądań = 0" proof in SECURITY.md §3 would no longer hold.
//
// Two classes of occurrence, treated differently:
//   - eagerly fetched subresources (<link href>, src=, CSS url()) -> BUILD FAILS
//   - navigation anchors (<a href>) -> reported; at runtime they are governed
//     by will-navigate + setWindowOpenHandler + the §5 allowlist
//   - bare strings inside JS bundles -> reported (dead fallback branches,
//     license banners); they cannot fetch without going through §3/§6
function assertNoRemoteUrls() {
  // Non-fetching occurrences: XML/SVG namespaces and doc/spec URLs.
  const ALLOWED_PREFIXES = [
    'http://www.w3.org/',
    'https://www.w3.org/',
    'http://schemas.openxmlformats.org/',
    'http://purl.org/',
    'http://ns.adobe.com/',
  ];
  const isAllowed = (url) => ALLOWED_PREFIXES.some((p) => url.startsWith(p));

  // Attributes/functions the browser resolves and fetches without user action.
  const FETCHED_IN_HTML = [
    /<link\b[^>]*\bhref=["'](https?:\/\/[^"']+)["'][^>]*>/gi,
    /\b(?:src|data-src)=["'](https?:\/\/[^"']+)["']/gi,
    /<script\b[^>]*\bsrc=["'](https?:\/\/[^"']+)["']/gi,
  ];
  const FETCHED_IN_CSS = [/url\(\s*["']?(https?:\/\/[^"')]+)/gi];
  const ANCHOR = /<a\b[^>]*\bhref=["'](https?:\/\/[^"']+)["']/gi;
  const ANY_REMOTE = /https?:\/\/[^\s"'`<>()\\]+/g;

  const collect = (content, patterns) => {
    const found = [];
    for (const re of patterns) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(content)) !== null) {
        if (!isAllowed(m[1])) found.push(m[1]);
      }
    }
    return found;
  };

  return {
    name: 'assert-no-remote-urls',
    apply: 'build',
    closeBundle() {
      const outDir = join(__dirname, 'dist-desktop');
      if (!existsSync(outDir)) return;

      const fetched = [];
      const anchors = [];
      const jsHosts = new Set();

      const walk = (dir) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const abs = join(dir, entry.name);
          if (entry.isDirectory()) { walk(abs); continue; }
          const rel = abs.slice(outDir.length + 1);
          const isHtml = entry.name.endsWith('.html');
          const isCss = entry.name.endsWith('.css');
          const isJs = /\.(js|mjs)$/.test(entry.name);
          if (!isHtml && !isCss && !isJs) continue;

          const content = readFileSync(abs, 'utf8');
          if (isHtml) {
            for (const url of collect(content, FETCHED_IN_HTML)) fetched.push({ rel, url });
            ANCHOR.lastIndex = 0;
            let m;
            while ((m = ANCHOR.exec(content)) !== null) {
              if (!isAllowed(m[1])) anchors.push({ rel, url: m[1] });
            }
          } else if (isCss) {
            for (const url of collect(content, FETCHED_IN_CSS)) fetched.push({ rel, url });
          } else if (isJs) {
            for (const url of content.match(ANY_REMOTE) ?? []) {
              if (isAllowed(url)) continue;
              try { jsHosts.add(new URL(url).host); } catch { /* not a URL */ }
            }
          }
        }
      };
      walk(outDir);

      if (fetched.length > 0) {
        const list = fetched.map((o) => `  ${o.rel}: ${o.url}`).join('\n');
        throw new Error(
          '[assert-no-remote-urls] build desktopowy pobierałby zasoby z sieci:\n'
          + `${list}\n\nUsuń je albo zvendoruj lokalnie.`,
        );
      }

      if (anchors.length > 0) {
        const list = [...new Set(anchors.map((a) => a.url))].join(', ');
        console.log(`[assert-no-remote-urls] linki nawigacyjne (blokowane przez §5 allowlist w runtime): ${list}`);
      }
      if (jsHosts.size > 0) {
        console.log(
          '[assert-no-remote-urls] HTML/CSS nie pobiera niczego zdalnie. W bundlach JS pozostają '
          + `nieaktywne stringi CDN (martwe gałęzie fallbacku, banery licencyjne): ${[...jsHosts].join(', ')}. `
          + 'Runtime i tak je blokuje (SECURITY.md §3, §6).',
        );
      }
    },
  };
}

export default defineConfig({
  ...baseConfig,
  // Desktop plugins first: their dev middleware must win over the fork's
  // no-SPA-fallback 404 for /local-models/ and /ocr-models/.
  plugins: [
    desktopLocalAssets(),
    desktopHtmlTransform(),
    ...(baseConfig.plugins ?? []),
    desktopStripWebmcpAsset(),
    assertNoRemoteUrls(),
  ],
  build: {
    ...baseConfig.build,
    outDir: 'dist-desktop',
  },
});
