import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, 'fixtures');

async function uploadAndAssertText(page, filename, expectedSubstring) {
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') {
      console.log(`[browser:${msg.type()}]`, msg.text());
    }
  });
  page.on('pageerror', (err) => console.log('[browser:pageerror]', err.message));
  await page.goto('/');
  await page.waitForSelector('[data-testid="workspace-dropzone"]');
  const fileInput = page.locator('input[type="file"]');
  await fileInput.setInputFiles(path.join(FIXTURES, filename));
  await page.waitForSelector('.ann-editor-textarea');
  const value = await page.locator('.ann-editor-textarea').inputValue();
  expect(value).toContain(expectedSubstring);
  const pill = page.locator('[data-testid="workspace-file-pill"]');
  await expect(pill).toContainText(filename);
}

test('txt upload populates the textarea', async ({ page }) => {
  await uploadAndAssertText(page, 'sample.txt', 'Jan Kowalski');
});

test('docx upload populates the textarea', async ({ page }) => {
  await uploadAndAssertText(page, 'sample.docx', 'Jan Kowalski');
});

test('text-based pdf upload populates the textarea', async ({ page }) => {
  await uploadAndAssertText(page, 'sample-text.pdf', 'Jan Kowalski');
});

test('scanned pdf shows the scan-detection error and Wklej tekst recovery', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('[data-testid="workspace-dropzone"]');
  const fileInput = page.locator('input[type="file"]');
  await fileInput.setInputFiles(path.join(FIXTURES, 'sample-scanned.pdf'));
  const err = page.locator('[data-testid="workspace-error"]');
  await expect(err).toContainText('zeskanowany PDF');
  await page.locator('[data-testid="workspace-recover-paste"]').click();
  await expect(page.locator('.ann-editor-textarea')).toBeVisible();
  await expect(page.locator('.ann-editor-textarea')).toHaveValue('');
});
