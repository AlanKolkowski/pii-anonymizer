import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  SessionFileError,
  SESSION_FILE_VERSION,
  buildSessionRecord,
  deleteSessionFile,
  readSessionFile,
  resolveSessionDir,
  sessionFilePath,
  writeSessionFile,
} from './session-file.mjs';

// MOST-IMPL-PLAN.md §2 R-1, §3 M1: session file lifecycle, tested against a
// REAL temporary directory on disk (never a mocked filesystem, per the
// module's own "I/O wstrzykiwane przez parametry ścieżek" design) -- never
// against the real %LOCALAPPDATA%.

function record(overrides = {}) {
  return buildSessionRecord({
    pipeName: '\\\\.\\pipe\\pii-bridge-v1-deadbeef',
    secret: 'a'.repeat(64),
    appPid: 4242,
    appVersion: '0.1.0',
    createdAt: '2026-07-18T12:00:00.000Z',
    ...overrides,
  });
}

let dir;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'bridge-session-test-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('resolveSessionDir (P-3: %LOCALAPPDATA%, never app.getPath("userData"))', () => {
  it('joins %LOCALAPPDATA% with the fixed, space-free slug', () => {
    const result = resolveSessionDir({ LOCALAPPDATA: 'C:\\Users\\alan\\AppData\\Local' });
    expect(result).toBe(join('C:\\Users\\alan\\AppData\\Local', 'LokalnyAnonimizatorAI'));
  });

  it('fails closed (throws SessionFileError) when %LOCALAPPDATA% is missing', () => {
    expect(() => resolveSessionDir({})).toThrow(SessionFileError);
    try {
      resolveSessionDir({});
    } catch (err) {
      expect(err.code).toBe('no-localappdata');
    }
  });

  it('fails closed when %LOCALAPPDATA% is an empty string', () => {
    expect(() => resolveSessionDir({ LOCALAPPDATA: '' })).toThrow(SessionFileError);
  });
});

describe('writeSessionFile / readSessionFile round-trip', () => {
  it('writes exactly the record shape and reads it back unchanged', () => {
    const rec = record();
    writeSessionFile(dir, rec);
    expect(readSessionFile(dir)).toEqual(rec);
  });

  it('creates the session directory if it does not exist yet', () => {
    const nested = join(dir, 'not-yet-created');
    writeSessionFile(nested, record());
    expect(readSessionFile(nested)).not.toBeNull();
  });

  it('returns null (not an error, not a throw) when no file exists -- the deliberate "app off OR bridge paused" non-distinction (R-1)', () => {
    expect(readSessionFile(dir)).toBeNull();
  });

  it('leaves no stray tmp file behind after a successful write', () => {
    writeSessionFile(dir, record());
    const entries = readdirSync(dir);
    expect(entries).toEqual(['bridge-session.json']);
  });
});

describe('content contains no PII -- literal field check', () => {
  it('the written file on disk contains only the six frozen keys, nothing else', () => {
    writeSessionFile(dir, record());
    const onDisk = JSON.parse(readFileSync(sessionFilePath(dir), 'utf8'));
    expect(Object.keys(onDisk).sort()).toEqual(['appPid', 'appVersion', 'createdAt', 'pipe', 'secret', 'v']);
  });

  it('writeSessionFile refuses a record carrying an unexpected extra field (e.g. an accidental label/legend)', () => {
    const tainted = { ...record(), label: 'Źródło 1 – Kowalski.docx' };
    expect(() => writeSessionFile(dir, tainted)).toThrow(SessionFileError);
    expect(readSessionFile(dir)).toBeNull(); // nothing was written
  });
});

describe('atomicity (simulated crash between tmp-write and rename)', () => {
  it('leaves any pre-existing target file completely untouched if rename fails after the tmp write succeeds', () => {
    const original = record({ pipe: '\\\\.\\pipe\\pii-bridge-v1-original' });
    writeSessionFile(dir, original);

    const crashingRename = () => {
      throw new Error('simulated crash between tmp write and rename');
    };
    expect(() =>
      writeSessionFile(dir, record({ pipe: '\\\\.\\pipe\\pii-bridge-v1-new' }), { renameSync: crashingRename }),
    ).toThrow('simulated crash');

    // The target file is exactly the ORIGINAL record -- never partially
    // overwritten, never corrupted -- because writing happened entirely to
    // a separate tmp path before the (failed) rename.
    expect(readSessionFile(dir)).toEqual(original);
  });

  it('never leaves a half-written file under the TARGET name -- only a stray tmp file, distinguishable by name', () => {
    expect(readSessionFile(dir)).toBeNull(); // nothing existed before

    const crashingRename = () => {
      throw new Error('simulated crash');
    };
    expect(() => writeSessionFile(dir, record(), { renameSync: crashingRename })).toThrow();

    // Still nothing under the real target name...
    expect(readSessionFile(dir)).toBeNull();
    // ...but the tmp file the module wrote IS there, under a name that is
    // never mistaken for the real session file (readSessionFile only ever
    // opens the exact target filename).
    const entries = readdirSync(dir);
    expect(entries).toHaveLength(1);
    expect(entries[0]).not.toBe('bridge-session.json');
    expect(entries[0]).toMatch(/\.tmp$/);
  });
});

describe('cleanup (deleteSessionFile)', () => {
  it('deletes an existing file and reports true', () => {
    writeSessionFile(dir, record());
    expect(deleteSessionFile(dir)).toBe(true);
    expect(readSessionFile(dir)).toBeNull();
  });

  it('is idempotent -- deleting an already-absent file returns false without throwing', () => {
    expect(deleteSessionFile(dir)).toBe(false);
    expect(() => deleteSessionFile(dir)).not.toThrow();
  });
});

describe('overwriting an orphaned file (stale session from a crashed/previous run)', () => {
  it('a fresh write fully replaces the previous record -- no merge, no leftover fields', () => {
    const stale = record({ pipe: '\\\\.\\pipe\\pii-bridge-v1-stale', secret: 'b'.repeat(64), appPid: 111 });
    writeSessionFile(dir, stale);

    const fresh = record({ pipe: '\\\\.\\pipe\\pii-bridge-v1-fresh', secret: 'c'.repeat(64), appPid: 222 });
    writeSessionFile(dir, fresh);

    expect(readSessionFile(dir)).toEqual(fresh);
  });
});

describe('corrupt file handling', () => {
  it('throws a distinct SessionFileError (not null, not a silent pass-through) for invalid JSON on disk', () => {
    writeSessionFile(dir, record());
    // Corrupt it directly, bypassing this module's own writer.
    writeFileSync(sessionFilePath(dir), 'not json at all', 'utf8');
    expect(() => readSessionFile(dir)).toThrow(SessionFileError);
  });

  it('throws for a well-formed JSON file with the wrong shape (e.g. wrong version)', () => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(sessionFilePath(dir), JSON.stringify({ ...record(), v: 99 }), 'utf8');
    expect(() => readSessionFile(dir)).toThrow(SessionFileError);
  });
});

describe('buildSessionRecord', () => {
  it('produces exactly the frozen shape with the current version', () => {
    const rec = buildSessionRecord({
      pipeName: '\\\\.\\pipe\\x',
      secret: 's',
      appPid: 1,
      appVersion: '1.2.3',
      createdAt: 'now',
    });
    expect(rec).toEqual({ v: SESSION_FILE_VERSION, pipe: '\\\\.\\pipe\\x', secret: 's', appPid: 1, appVersion: '1.2.3', createdAt: 'now' });
  });
});
