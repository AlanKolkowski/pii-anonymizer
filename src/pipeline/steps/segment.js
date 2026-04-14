import { chunkText } from '../../anonymizer.js';

const MAX_CHUNK_CHARS = 1200;

export function segmentStep(ctx) {
  const segments = chunkText(ctx.text, MAX_CHUNK_CHARS);
  return {
    ...ctx,
    segments,
    debug: [...ctx.debug, {
      step: 'segment',
      phase: 'segment',
      out: { segmentCount: segments.length },
    }],
  };
}
