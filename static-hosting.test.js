import { readFile } from 'node:fs/promises';
import path from 'node:path';

function extractHeadersSection(headers, sectionName) {
  const lines = headers.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === sectionName);
  if (start === -1) {
    throw new Error(`Missing ${sectionName} section`);
  }

  const section = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() && !line.startsWith(' ') && !line.startsWith('\t')) {
      break;
    }
    if (line.trim()) {
      section.push(line.trim());
    }
  }
  return section;
}

describe('static hosting configuration', () => {
  it('does not cache built assets immutably', async () => {
    const headers = await readFile(path.join('public', '_headers'), 'utf8');
    const assetHeaders = extractHeadersSection(headers, '/assets/*');

    expect(assetHeaders).toEqual(['Cache-Control: public, max-age=0, must-revalidate']);
    expect(assetHeaders.join('\n')).not.toContain('immutable');
  });

  it('serves a static 404 page instead of the app shell', async () => {
    const notFound = await readFile(path.join('public', '404.html'), 'utf8');

    expect(notFound).toContain('Nie znaleziono');
    expect(notFound).not.toMatch(/<script\b/i);
  });
});
