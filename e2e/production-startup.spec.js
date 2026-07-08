import { test, expect } from '@playwright/test';
import http from 'node:http';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

const MIME_TYPES = new Map([
  ['.html', 'text/html'],
  ['.js', 'application/javascript'],
  ['.mjs', 'application/javascript'],
  ['.css', 'text/css'],
  ['.wasm', 'application/wasm'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.txt', 'text/plain'],
]);

let server;
let origin;

async function fileExists(filePath) {
  try {
    const info = await stat(filePath);
    return info.isFile();
  } catch (err) {
    if (err?.code === 'ENOENT') {
      return false;
    }
    throw err;
  }
}

function sendFile(res, filePath, statusCode = 200) {
  const contentType = MIME_TYPES.get(path.extname(filePath)) ?? 'application/octet-stream';
  res.writeHead(statusCode, { 'content-type': contentType });
  createReadStream(filePath).pipe(res);
}

function distPathForUrl(url) {
  const requestUrl = new URL(url, 'http://localhost');
  const pathname = decodeURIComponent(requestUrl.pathname);

  if (pathname === '/' || pathname === '/index.html') {
    return path.join(DIST, 'index.html');
  }
  if (pathname === '/tool' || pathname === '/tool/' || pathname === '/tool.html') {
    return path.join(DIST, 'tool.html');
  }

  const normalizedPath = path.normalize(pathname).replace(/^[/\\]+/, '');
  if (normalizedPath.startsWith('..')) {
    return null;
  }
  return path.join(DIST, normalizedPath);
}

test.beforeAll(async () => {
  server = http.createServer(async (req, res) => {
    try {
      const filePath = distPathForUrl(req.url ?? '/');
      if (filePath && await fileExists(filePath)) {
        sendFile(res, filePath);
        return;
      }

      sendFile(res, path.join(DIST, 'index.html'), 200);
    } catch (err) {
      res.writeHead(500, { 'content-type': 'text/plain' });
      res.end('Internal Server Error');
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      const address = server.address();
      origin = `http://127.0.0.1:${address.port}`;
      resolve();
    });
  });
});

test.afterAll(async () => {
  await new Promise((resolve, reject) => {
    server.close((err) => err ? reject(err) : resolve());
  });
});

test('production build uses a root-absolute non-poisoned tool entry asset', async () => {
  const toolHtml = await readFile(path.join(DIST, 'tool.html'), 'utf8');

  expect(toolHtml).not.toContain('tool-BQGIrLjw.js');
  expect(toolHtml).not.toContain('src="./assets/');
  expect(toolHtml).toMatch(/src="\/assets\/tool-[^"]+\.js"/);
});

test('production fallback server does not expose stack traces in HTTP responses', async ({ request }) => {
  const response = await request.get(`${origin}/%E0%A4%A`, { failOnStatusCode: false });
  const body = await response.text();

  expect(response.status()).toBe(500);
  expect(body).toBe('Internal Server Error');
  expect(body).not.toMatch(/URIError|at decodeURIComponent|production-startup\.spec\.js/);
});

test('production tool page hydrates from an extensionless slash route', async ({ page }) => {
  const consoleErrors = [];
  const assetResponses = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });
  page.on('response', (response) => {
    if (response.url().includes('/assets/')) {
      assetResponses.push(response);
    }
  });

  await page.goto(`${origin}/tool/`);
  await expect(page.locator('[data-testid="sources-add-paste"]')).toBeVisible();

  expect(consoleErrors).not.toEqual(expect.arrayContaining([
    expect.stringMatching(/Failed to load module script|MIME type/i),
  ]));

  const jsAssetResponses = assetResponses.filter((response) => response.url().match(/\/assets\/.*\.js(?:$|[?#])/));
  expect(jsAssetResponses.length).toBeGreaterThan(0);
  for (const response of jsAssetResponses) {
    expect(response.headers()['content-type']).toContain('javascript');
  }
});
