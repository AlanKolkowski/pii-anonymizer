import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, 'fixtures');

test('OCR Cancel button returns to the dropzone with no error', async ({ page }) => {
  test.setTimeout(120_000);

  await page.goto('/');
  await page.waitForSelector('[data-testid="workspace-dropzone"]');
  const fileInput = page.locator('input[type="file"]');
  await fileInput.setInputFiles(path.join(FIXTURES, 'sample-scanned.pdf'));

  const cancel = page.locator('[data-testid="workspace-ocr-cancel"]');
  await expect(cancel).toBeVisible({ timeout: 60_000 });
  await cancel.click();

  await expect(page.locator('[data-testid="workspace-dropzone"]')).toBeVisible();
  await expect(page.locator('[data-testid="workspace-error"]')).toHaveCount(0);
  await expect(page.locator('.ann-editor')).toHaveCount(0);
});
