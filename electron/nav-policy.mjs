// Origin-based navigation policy shared by will-navigate and will-redirect
// (SECURITY.md §5), split out of main.mjs so it can be unit-tested without
// booting Electron — same rationale as ./main-links.mjs.
//
// Must compare the parsed *origin*, never a string prefix:
// `url.startsWith(DEV_SERVER_URL)` without a trailing slash would admit
// `http://localhost:5183.evil.com` as a "prefix match" even though it is a
// different host entirely (SECURITY-FIXES.md S-NET-5, checklist C-NET-13).
export function isSameOriginAsApp(rawUrl, { appOrigin, devServerUrl = null } = {}) {
  let target;
  try {
    target = new URL(rawUrl);
  } catch {
    return false;
  }
  if (matchesOrigin(target, appOrigin)) return true;
  return devServerUrl != null && matchesOrigin(target, devServerUrl);
}

function matchesOrigin(target, referenceUrl) {
  try {
    const reference = new URL(referenceUrl);
    // Compare protocol + host explicitly rather than the `.origin` getter:
    // `app:` is a non-special WHATWG scheme, so `.origin` serializes it to
    // the literal string "null" — every app:// URL would then compare equal
    // to every other one by accident. Protocol+host is the correct check for
    // both the special (http/https) and non-special (app:) case.
    return target.protocol === reference.protocol && target.host === reference.host;
  } catch {
    return false;
  }
}
