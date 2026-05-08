import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, 'fixtures');

test('mixed PDF concatenates text-page and OCR-page output, pill shows page range', async ({ page }) => {
  test.setTimeout(120_000);

  await page.goto('/');
  await page.waitForSelector('[data-testid="workspace-dropzone"]');
  const fileInput = page.locator('input[type="file"]');
  await fileInput.setInputFiles(path.join(FIXTURES, 'sample-mixed.pdf'));

  await page.waitForSelector('.ann-editor-textarea', { timeout: 90_000 });
  const value = await page.locator('.ann-editor-textarea').inputValue();
  expect(value).toContain('Strona pierwsza');
  expect(value).toContain('Strona druga');

  const pill = page.locator('[data-testid="workspace-file-pill"]');
  await expect(pill).toContainText('sample-mixed.pdf');
  await expect(pill).toContainText(/OCR: strona 2/);
});
