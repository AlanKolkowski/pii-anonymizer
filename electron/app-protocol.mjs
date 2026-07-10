// The app:// protocol — the only origin the renderer ever talks to.
//
// Serves three trees, read-only, GET/HEAD only:
//   app://app/<asset>            -> <distRoot>/<asset>          (built renderer)
//   app://app/local-models/<f>   -> <modelsRoot>/ner/<f>        (NER models)
//   app://app/ocr-models/<f>     -> <modelsRoot>/ocr/<f>        (OCR models,
//                                    falls back to <distRoot>/ocr-models/<f>)
//
// Registered as standard+secure+supportFetchAPI so the renderer gets a real
// origin: module workers, fetch(), CacheStorage, Web Locks and localStorage
// all behave like on an https origin. COOP/COEP headers are injected so
// crossOriginIsolated is true and threaded ONNX-Runtime WASM works.
// See SECURITY.md §2.
// `net` is deliberately NOT imported: the main process must have no way to
// make a network request (SECURITY.md §3).
import { protocol } from 'electron';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';

export const APP_SCHEME = 'app';
export const APP_HOST = 'app';
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.tar': 'application/x-tar',
  '.onnx': 'application/octet-stream',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

// Renderer CSP: no remote sources whatsoever. 'wasm-unsafe-eval' for ORT/OpenCV
// WASM compilation; blob:/data: workers+fetches for PaddleOCR model blobs,
// heic-to's inline worker and OpenCV's data-URI wasm; 'unsafe-inline' styles
// for the app's inline style attributes. connect-src has NO network origin,
// ws: included deliberately NOWHERE — WebMCP stays disconnected until the
// desktop MCP transport decision (see SECURITY.md §10). See SECURITY.md §6.
//
// 'unsafe-eval' is a DOCUMENTED DEVIATION (SECURITY.md §6): the PaddleOCR SDK
// initializes OpenCV.js on the main thread and its Emscripten/embind glue
// builds functions via `new Function`; without it OCR — a critical feature —
// dies. Egress stays impossible (script-src 'self' + the §3 network block).
// TODO(etap-2): move OpenCV strictly into the SDK worker or patch the glue,
// then drop 'unsafe-eval'.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval' 'unsafe-eval' 'report-sample'",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "font-src 'self' data:",
  "connect-src 'self' blob: data:",
  "media-src 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  // WebRTC is raw UDP/ICE: neither session.webRequest (§3) nor `connect-src`
  // governs it. Measured on Chromium 150 this directive is NOT yet enforced —
  // it is declared for forward compatibility only. The control that actually
  // stops UDP egress is setWebRTCIPHandlingPolicy('disable_non_proxied_udp')
  // in electron/main.mjs, verified by e2e/desktop-smoke.mjs (zero ICE
  // candidates). Do not remove either one.
  "webrtc 'block'",
].join('; ');

// Workers get their CSP from the response that delivered the worker script,
// so a CSP header on .js/.mjs responses governs ONLY workers (documents take
// theirs from the HTML response above). The PaddleOCR SDK worker bundles
// Emscripten/OpenCV glue that uses `new Function` (dynCall wrappers) — it
// needs 'unsafe-eval', which we deliberately do NOT grant to the page.
const WORKER_CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval' 'unsafe-eval'",
  "worker-src 'self' blob:",
  "connect-src 'self' blob: data:",
  "webrtc 'block'",
].join('; ');

export function contentSecurityPolicy() {
  return CSP;
}

/** Must run before app.whenReady(). */
export function registerAppScheme() {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        codeCache: true,
        // No service workers: nothing to install, smaller attack surface.
        allowServiceWorkers: false,
      },
    },
  ]);
}

function baseHeaders(mime, sizeBytes) {
  const headers = {
    'Content-Type': mime,
    'Content-Length': String(sizeBytes),
    'X-Content-Type-Options': 'nosniff',
    'Accept-Ranges': 'none',
    'Cache-Control': 'no-cache',
    // Same values the web deployment serves on every path (public/_headers):
    // required for crossOriginIsolated => SharedArrayBuffer => threaded ORT.
    // Worker scripts in particular must carry a compatible COEP.
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'credentialless',
  };
  if (mime.startsWith('text/html')) {
    headers['Content-Security-Policy'] = CSP;
  } else if (mime.startsWith('text/javascript')) {
    headers['Content-Security-Policy'] = WORKER_CSP;
  }
  return headers;
}

function notFound() {
  return new Response('Not Found', { status: 404, headers: { 'Content-Type': 'text/plain' } });
}

/** Resolve a decoded URL path to a file inside `root`, or null on traversal. */
function safeJoin(root, urlPath) {
  const resolved = resolve(root, normalize(urlPath).replace(/^([/\\])+/, ''));
  const rootResolved = resolve(root);
  if (resolved !== rootResolved && !resolved.startsWith(rootResolved + sep)) return null;
  return resolved;
}

/**
 * Installs the app:// handler on a session's protocol module.
 * @param {Electron.Protocol} protocolModule typically `session.protocol` or global `protocol`
 * @param {{ distRoot: string, modelsRoot: string }} roots
 */
export function installAppProtocolHandler(protocolModule, { distRoot, modelsRoot }) {
  protocolModule.handle(APP_SCHEME, async (request) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    let url;
    let pathname;
    try {
      url = new URL(request.url);
      pathname = decodeURIComponent(url.pathname);
    } catch {
      return new Response('Bad Request', { status: 400 });
    }
    if (url.host !== APP_HOST) return notFound();

    // Route to the right tree. Model paths mirror the web deployment's
    // /local-models/ and /ocr-models/ prefixes (vite.config.js), so the
    // renderer code is identical in web and desktop builds.
    let filePath = null;
    if (pathname.startsWith('/local-models/')) {
      filePath = safeJoin(join(modelsRoot, 'ner'), pathname.slice('/local-models/'.length));
    } else if (pathname.startsWith('/ocr-models/')) {
      filePath = safeJoin(join(modelsRoot, 'ocr'), pathname.slice('/ocr-models/'.length));
      if (filePath && !(await stat(filePath).catch(() => null))?.isFile()) {
        // Rec-model tar also ships inside dist (from public/ocr-models/).
        filePath = safeJoin(distRoot, pathname);
      }
    } else {
      const rel = pathname === '/' ? '/tool.html' : pathname;
      filePath = safeJoin(distRoot, rel);
    }
    if (!filePath) return notFound();

    const fileStat = await stat(filePath).catch(() => null);
    if (!fileStat?.isFile()) return notFound();

    const mime = MIME_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
    const headers = baseHeaders(mime, fileStat.size);

    if (request.method === 'HEAD') {
      return new Response(null, { status: 200, headers });
    }
    // Stream from disk (models are hundreds of MB — never buffer them).
    // fs read works transparently for files packed inside app.asar too.
    const body = Readable.toWeb(createReadStream(filePath));
    return new Response(body, { status: 200, headers });
  });
}
