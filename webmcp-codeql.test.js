import { readFile } from 'node:fs/promises';
import path from 'node:path';

describe('WebMCP CodeQL logging regressions', () => {
  it('logs tool and prompt requests with constant format strings', async () => {
    const source = await readFile(path.join('public', 'webmcp.js'), 'utf8');

    expect(source).not.toContain('console.log(`Tool call: ${tool} with args:`, args);');
    expect(source).not.toContain('console.log(`Prompt request: ${name} with args:`, args);');
    expect(source).toContain("console.log('Tool call: %s with args:', tool, args);");
    expect(source).toContain("console.log('Prompt request: %s with args:', name, args);");
  });
});
