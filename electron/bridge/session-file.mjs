// Bridge session file (MOST-IMPL-PLAN.md §2 R-1, §3 M1). The file the
// adapter reads (electron/bridge/pipe-client.mjs, once wired up) to find the
// running app's pipe name and shared secret. Lives at
// `%LOCALAPPDATA%\LokalnyAnonimizatorAI\bridge-session.json` -- deliberately
// NOT `app.getPath('userData')` (P-3: that resolves to roaming, the wrong
// profile root for a per-machine, per-boot secret). Created only after the
// user clicks "Włącz most" (bootstrap state machine, R-1 -- that state
// machine itself is BUILD-phase, gate.mjs/main-bridge.mjs territory); deleted
// on pause and on app exit. Its absence deliberately does not distinguish
// "app not running" from "bridge paused" -- both leave zero trace on disk.
//
// Pure module: every function takes the session directory as an explicit
// parameter (never resolves `%LOCALAPPDATA%` itself except in
// resolveSessionDir, which is the one function real callers use and tests
// exercise via an injected `env` object) -- testable against a real tmp
// directory, never a mocked filesystem (MOST-IMPL-PLAN.md §3 M1: "I/O
// wstrzykiwane przez parametry ścieżek").
//
// Windows-ACL note (O-1, MCP-BRIDGE-DESIGN.md §4.4): %LOCALAPPDATA% is
// per-user but not secret-grade on its own (any process running as the same
// user, or an admin, can read it) -- the auth.mjs HMAC handshake is the real
// control against a forged peer; this file's secrecy is defense in depth,
// not the primary boundary. `mode: 0o600` below is a POSIX-style hint that
// costs nothing to set and matters if this ever runs on a POSIX box.

import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const SESSION_FILE_VERSION = 1;
export const SESSION_DIR_NAME = 'LokalnyAnonimizatorAI';
export const SESSION_FILE_NAME = 'bridge-session.json';

export class SessionFileError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'SessionFileError';
    this.code = code;
  }
}

// Derives the session directory from `%LOCALAPPDATA%` explicitly (never
// `app.getPath('userData')` -- P-3). Fail-closed: throws (never guesses a
// fallback path) when the variable is absent or empty -- the bootstrap state
// machine (BUILD phase) turns this into the ERROR state, never a silent
// alternate location. `env` is injectable so a test can simulate the
// variable's absence without touching the real process environment.
export function resolveSessionDir(env = process.env) {
  const base = env.LOCALAPPDATA;
  if (typeof base !== 'string' || base.length === 0) {
    throw new SessionFileError(
      'no-localappdata',
      'Brak zmiennej środowiskowej %LOCALAPPDATA% – most AI nie może utworzyć pliku sesyjnego.',
    );
  }
  return join(base, SESSION_DIR_NAME);
}

export function sessionFilePath(sessionDir) {
  return join(sessionDir, SESSION_FILE_NAME);
}

// Builds the JSON-serializable record. Shape is frozen by MOST-IMPL-PLAN.md
// §2 R-1: {v, pipe, secret, appPid, appVersion, createdAt} -- nothing else,
// ever (no document content, no label, no legend -- there is no code path in
// this module that could even reach those).
export function buildSessionRecord({ pipeName, secret, appPid, appVersion, createdAt }) {
  return {
    v: SESSION_FILE_VERSION,
    pipe: pipeName,
    secret,
    appPid,
    appVersion,
    createdAt,
  };
}

const KNOWN_RECORD_KEYS = ['v', 'pipe', 'secret', 'appPid', 'appVersion', 'createdAt'];

function isValidRecord(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  if (Object.keys(value).some((k) => !KNOWN_RECORD_KEYS.includes(k))) return false;
  return (
    value.v === SESSION_FILE_VERSION &&
    typeof value.pipe === 'string' && value.pipe.length > 0 &&
    typeof value.secret === 'string' && value.secret.length > 0 &&
    typeof value.appPid === 'number' &&
    typeof value.appVersion === 'string' &&
    typeof value.createdAt === 'string'
  );
}

// Atomic write: full content to a tmp file in the SAME directory, then
// rename over the target. `fs.renameSync` replaces an existing destination
// file on both Windows (MoveFileEx w/ MOVEFILE_REPLACE_EXISTING under the
// hood) and POSIX, which is what makes this double as "overwrite an
// orphaned file from a previous/crashed session" with no special-case code --
// a fresh "Włącz most" always simply writes a new file over whatever was
// there. A crash between the two `fsImpl` calls below leaves, at worst, a
// stray `.tmp` file that no reader of this module ever looks at (readSessionFile
// only ever opens the exact target name) -- never a half-written target.
export function writeSessionFile(sessionDir, record, fsImpl = {}) {
  const {
    mkdirSync: mkdir = mkdirSync,
    writeFileSync: writeFile = writeFileSync,
    renameSync: rename = renameSync,
  } = fsImpl;

  if (!isValidRecord(record)) {
    throw new SessionFileError('invalid-record', 'Kształt rekordu sesyjnego niezgodny z oczekiwanym (v/pipe/secret/appPid/appVersion/createdAt).');
  }

  mkdir(sessionDir, { recursive: true });
  const target = sessionFilePath(sessionDir);
  const tmpPath = join(sessionDir, `.bridge-session.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`);
  writeFile(tmpPath, JSON.stringify(record), { encoding: 'utf8', mode: 0o600 });
  rename(tmpPath, target);
  return target;
}

// Reads + validates the session file. Returns `null` for "file does not
// exist" -- the deliberate non-distinction between "app not running" and
// "bridge paused" (R-1). A file that exists but is corrupt/unexpected-shape
// throws distinctly (SessionFileError code 'corrupt') rather than being
// treated as "absent" -- a caller should surface that as a hard error, not
// silently proceed as if the bridge were simply off.
export function readSessionFile(sessionDir) {
  const target = sessionFilePath(sessionDir);
  if (!existsSync(target)) return null;

  let raw;
  try {
    raw = readFileSync(target, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null; // disappeared between existsSync and readFileSync
    throw err;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new SessionFileError('corrupt', 'Plik sesyjny istnieje, ale nie zawiera poprawnego JSON.');
  }
  if (!isValidRecord(parsed)) {
    throw new SessionFileError('corrupt', 'Plik sesyjny istnieje, ale ma nieoczekiwany kształt.');
  }
  return parsed;
}

// Deletes the session file if present (pause / app exit). Never throws for
// "already gone" (idempotent under a racing delete); any other error (e.g.
// EPERM) propagates -- silently failing to delete would leave a stale
// secret+pipe name on disk claiming the bridge is still live.
export function deleteSessionFile(sessionDir) {
  try {
    unlinkSync(sessionFilePath(sessionDir));
    return true;
  } catch (err) {
    if (err.code === 'ENOENT') return false;
    throw err;
  }
}
