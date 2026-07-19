// Closed list of literal error messages returned to an MCP client WITHOUT a
// gate ever opening (MOST-IMPL-PLAN.md §3 M6, O-7). Every message is a fixed
// string: this file's own source text is asserted (errors.test.js) to
// contain zero template-literal substitution markers, so there is no way to
// accidentally interpolate document content or a private label into one of
// these — the failure mode O-7 exists to close.
//
// What is deliberately NOT here: the document-domain messages ("dokument
// źródłowy nie jest gotowy", "nie zawiera wykrytych encji", "dokument
// wynikowy nie istnieje", "nie zawiera tokenów anonimizacji"). Those already
// exist verbatim in src/mcp/listings.js's builders (buildReadSourceContent /
// buildReadOutcomeContent) and travel back as ordinary tool result content —
// duplicating them here would create a second copy that can drift from the
// first. MOST-IMPL-PLAN.md §3 M6 lists them as part of the closed error
// surface for documentation purposes only ("parytet z listings.js — te
// wracają z builderów"); this module owns only the messages that originate
// in the bridge's own main process / adapter, which have no builder to defer
// to.
export const ERRORS = Object.freeze({
  APP_NOT_RUNNING: 'Aplikacja „Lokalny anonimizator + AI” nie jest uruchomiona albo most AI jest wstrzymany. Poproś użytkownika o uruchomienie aplikacji i włączenie mostu AI, potem ponów wywołanie.',
  USER_REJECTED: 'Użytkownik odmówił udostępnienia tych danych. Nie ponawiaj tego wywołania, dopóki użytkownik wyraźnie o to nie poprosi.',
  DECISION_TIMEOUT: 'Brak decyzji użytkownika w wyznaczonym czasie.',
  QUEUE_FULL: 'Kolejka zatwierdzeń pełna.',
  UNKNOWN_TOOL: 'Nieznane narzędzie.',
  INVALID_ARGS: 'Nieprawidłowe argumenty.',
  BRIDGE_PAUSED_WHILE_PENDING: 'Most AI został wstrzymany w trakcie oczekiwania na decyzję.',
  CANCELLED_BY_CLIENT: 'Wywołanie anulowane przez klienta.',
  FRAME_TOO_LARGE: 'Ramka przekracza dopuszczalny rozmiar.',
  NO_TOKENS_IN_PAYLOAD: 'Dokument nie zawiera żadnego tokenu anonimizacji; nie można bezpiecznie udostępnić treści przez MCP.',
  INTERNAL_TRANSPORT_ERROR: 'Błąd wewnętrzny mostu przy przekazywaniu wywołania. Spróbuj ponownie.',
});

const ALLOWED_MESSAGES = new Set(Object.values(ERRORS));

// Builds an MCP CallToolResult error shape from a closed-list message ONLY —
// throws for anything else, so an accidental `toolErrorResult(someTemplate)`
// elsewhere in the codebase fails loudly instead of quietly shipping an
// ad-hoc (possibly interpolated) string as if it were vetted.
export function toolErrorResult(message) {
  if (!ALLOWED_MESSAGES.has(message)) {
    throw new Error('toolErrorResult: message is not one of the closed ERRORS values');
  }
  return { content: [{ type: 'text', text: message }], isError: true };
}
