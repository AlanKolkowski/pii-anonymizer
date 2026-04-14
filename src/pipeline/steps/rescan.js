import { rescanForKnownPii } from '../../anonymizer.js';

export function rescanStep(ctx) {
  const rescanned = rescanForKnownPii(ctx.anonymized, ctx.legend);
  return {
    ...ctx,
    anonymized: rescanned,
    debug: [...ctx.debug, {
      step: 'rescan',
      phase: 'postprocess',
      out: { changed: rescanned !== ctx.anonymized },
    }],
  };
}
