import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, 'fixtures');

test('image upload runs OCR and shows the OCR breadcrumb', async ({ page }) => {
  test.setTimeout(120_000); // first run downloads OCR models

  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') {
      console.log(`[browser:${msg.type()}]`, msg.text());
    }
  });
  page.on('pageerror', (err) => console.log('[browser:pageerror]', err.message));

  await page.goto('/');
  await page.waitForSelector('[data-testid="workspace-dropzone"]');
  const fileInput = page.locator('input[type="file"]');
  await fileInput.setInputFiles(path.join(FIXTURES, 'sample-photo.png'));

  await page.waitForSelector('.ann-editor-textarea', { timeout: 90_000 });
  const value = await page.locator('.ann-editor-textarea').inputValue();
  expect(value).toContain('Jan');
  expect(value).toContain('Kowalski');
  // The Latin PP-OCRv5 rec model preserves Polish diacritics — verify at
  // least one survived round-trip through render → OCR.
  expect(value).toMatch(/Marszałkowska|Łódź|Kraków|Wrocław|Gdańsk/);

  const pill = page.locator('[data-testid="workspace-file-pill"]');
  await expect(pill).toContainText('sample-photo.png');
  await expect(pill).toContainText('OCR');
});
