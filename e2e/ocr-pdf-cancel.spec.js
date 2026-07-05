import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, 'fixtures');

test('cancelling an in-flight PDF import surfaces "Import anulowany" without crashing', async ({ page }) => {
  test.setTimeout(120_000);

  // The live tool UI surfaces uncaught errors as page errors; collect them so we
  // can assert the cancel path does not crash the app.
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(err));

  await page.goto('tool.html');

  const fileInput = page.locator('[data-testid="sources-add-file-input"]');
  await fileInput.setInputFiles(path.join(FIXTURES, 'sample-scanned.pdf'));

  // The cancel affordance is rendered by the progress overlay once the import
  // enters its running phase (model download / OCR prep).
  const cancel = page.locator('[data-testid="import-cancel"]');
  await expect(cancel).toBeVisible({ timeout: 60_000 });
  await cancel.click();

  // After cancellation, the source is marked errored with the Polish message.
  const errorDot = page.locator('[data-testid^="source-status-"][data-status="error"]');
  await expect(errorDot).toHaveAttribute('title', /Import anulowany/);

  // The progress overlay tear-down must not leave the page in a broken state.
  expect(pageErrors).toEqual([]);
});
