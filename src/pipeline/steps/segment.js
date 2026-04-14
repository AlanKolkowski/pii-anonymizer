import { chunkText } from '../../anonymizer.js';

const MAX_CHUNK_CHARS = 800;

export function segmentStep(ctx) {
  const segments = chunkText(ctx.text, MAX_CHUNK_CHARS);
  return { ...ctx, segments };
}
