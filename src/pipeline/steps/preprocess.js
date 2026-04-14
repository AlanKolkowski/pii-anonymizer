export function normalizeWhitespace(ctx) {
  // No-op for now — placeholder for future preprocessing
  return {
    ...ctx,
    debug: [...ctx.debug, { step: 'normalizeWhitespace', phase: 'preprocess' }],
  };
}
