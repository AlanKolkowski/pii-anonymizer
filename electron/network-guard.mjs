// Process-level network lockdown. The app must be "air-gap by construction":
// every http/https/ws/wss request is cancelled before it leaves the process,
// regardless of which renderer/worker issued it. See SECURITY.md §3.
//
// The only exception is the Vite dev server origin, and only when the app is
// explicitly launched in dev mode (scripts/dev-desktop.mjs sets
// PII_DEV_SERVER_URL). Packaged builds never define it.

/** Schemes that never touch the network: the app's own protocol and
 * renderer-internal pseudo-schemes. */
const ALLOWED_SCHEMES = new Set([
  'app:',
  'blob:',
  'data:',
  'devtools:',
  'chrome:',
  'about:',
]);

const stats = {
  blockedTotal: 0,
  // url origin -> count; proves *what* tried to get out, for the dev log.
  blockedByOrigin: new Map(),
};

export function getNetworkBlockStats() {
  return {
    blockedTotal: stats.blockedTotal,
    blockedByOrigin: Object.fromEntries(stats.blockedByOrigin),
  };
}

function describeOrigin(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return url.origin === 'null' ? `${url.protocol}//` : url.origin;
  } catch {
    return 'unparseable-url';
  }
}

/**
 * Installs the request blocker + permission lockdown on a session.
 * @param {Electron.Session} targetSession
 * @param {{ devServerUrl?: string | null }} options
 */
export function installNetworkGuard(targetSession, { devServerUrl = null } = {}) {
  let devOrigin = null;
  if (devServerUrl) {
    devOrigin = new URL(devServerUrl).origin;
    console.warn(`[network-guard] DEV MODE: allowing dev server origin ${devOrigin}`);
  }

  targetSession.webRequest.onBeforeRequest((details, callback) => {
    let allowed = false;
    try {
      const url = new URL(details.url);
      if (ALLOWED_SCHEMES.has(url.protocol)) {
        allowed = true;
      } else if (devOrigin && url.origin === devOrigin) {
        // Vite dev server (http + ws for HMR share the origin check).
        allowed = true;
      } else if (devOrigin && url.protocol === 'ws:' && new URL(devServerUrl).hostname === url.hostname) {
        allowed = true;
      }
    } catch {
      allowed = false;
    }

    if (allowed) {
      callback({});
      return;
    }

    stats.blockedTotal += 1;
    const origin = describeOrigin(details.url);
    stats.blockedByOrigin.set(origin, (stats.blockedByOrigin.get(origin) ?? 0) + 1);
    // Dev log: proof of "zero network egress". First hits are logged verbatim,
    // later ones aggregated so a retry loop can't spam the log.
    if (stats.blockedByOrigin.get(origin) <= 3) {
      console.warn(`[network-guard] BLOCKED ${details.method} ${details.url} (total blocked: ${stats.blockedTotal})`);
    } else if (stats.blockedTotal % 25 === 0) {
      console.warn(`[network-guard] blocked total: ${stats.blockedTotal}`, getNetworkBlockStats().blockedByOrigin);
    }
    callback({ cancel: true });
  });

  // Deny every permission request (camera, mic, geolocation, notifications,
  // HID, …) except the two clipboard permissions the app's own UI needs:
  // "Kopiuj" writes tokenized text, "Wklej" in the deanonymize tab reads the
  // LLM output back. Both act only on the user's local clipboard after an
  // explicit click — feature parity with the web app, no egress. Documented
  // deviation from deny-all: SECURITY.md §7.
  const ALLOWED_PERMISSIONS = new Set(['clipboard-read', 'clipboard-sanitized-write']);
  const isAppOrigin = (requestingUrl) => {
    try {
      // Node's URL reports origin 'null' for non-special schemes like app://,
      // so compare protocol + host instead of .origin.
      const url = new URL(requestingUrl);
      if (url.protocol === 'app:' && url.host === 'app') return true;
      return devOrigin != null && url.origin === devOrigin;
    } catch {
      return false;
    }
  };
  targetSession.setPermissionRequestHandler((_webContents, permission, callback, details) => {
    const allowed = ALLOWED_PERMISSIONS.has(permission) && isAppOrigin(details?.requestingUrl);
    if (!allowed) console.warn(`[network-guard] permission request denied: ${permission}`);
    callback(allowed);
  });
  targetSession.setPermissionCheckHandler((_webContents, permission, requestingOrigin) => {
    return ALLOWED_PERMISSIONS.has(permission) && isAppOrigin(requestingOrigin);
  });

  // No spellchecker => no dictionary downloads from Chromium CDNs.
  targetSession.setSpellCheckerEnabled?.(false);
}
