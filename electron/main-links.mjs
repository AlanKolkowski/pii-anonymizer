// External-link policy, split out of main.mjs so it can be unit-tested without
// booting Electron. See SECURITY.md §5.
//
// shell.openExternal is the ONLY code path in this app that can reach the
// internet — the system browser it launches lives outside the §3 network guard.
// Therefore the policy is EXACT-URL membership, not prefix matching:
//
//   * a prefix rule like `startsWith('https://nodejs.org/')` admits
//     `https://nodejs.org/leak?d=<PESEL>`;
//   * even an origin+path-prefix rule admits `https://github.com/wjarka/
//     pii-anonymizer/<PESEL>` — a path carries data just as well as a query.
//
// Every link the UI can actually produce is a fixed, known string, so the set
// below is complete. Adding an entry widens the single sanctioned egress
// channel; do it deliberately, and never with a wildcard.
export const EXTERNAL_LINK_ALLOWLIST = new Set([
  // Landing page footer + MCP section (index.html)
  'https://github.com/wjarka/pii-anonymizer',
  'https://github.com/wjarka/pii-anonymizer/issues',
  'https://github.com/wjarka/pii-anonymizer/blob/main/LICENSE',
  'https://github.com/wjarka/pii-anonymizer/blob/main/docs/webmcp.md',
  'https://github.com/wjarka/pii-anonymizer/blob/main/docs/webmcp.md#szybki-start-claude-desktop',
  // Model attribution (Apache-2.0 §4 / NOTICE)
  'https://huggingface.co/wjarka/eu-pii-anonimization-pl',
  'https://huggingface.co/wjarka/eu-pii-anonimization-multilang',
  'https://bards.ai',
  // WebMCP setup guide inside the widget (src/main.js)
  'https://nodejs.org/',
  // This fork
  'https://github.com/AlanKolkowski/pii-anonymizer',
]);

export function isAllowedExternalLink(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  // Cheap structural rejects before the set lookup, so a hostile URL cannot
  // sneak through on normalization quirks (credentials, non-https schemes).
  if (url.protocol !== 'https:') return false;
  if (url.username !== '' || url.password !== '') return false;
  if (url.search !== '') return false;

  // Compare the raw string: exact membership, no normalization surface.
  return EXTERNAL_LINK_ALLOWLIST.has(rawUrl);
}
