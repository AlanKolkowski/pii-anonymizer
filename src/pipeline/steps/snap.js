import { snapToWordBoundaries } from '../../anonymizer.js';
import { rulesFor } from '../configs/entity-rules.js';

export function snapStep(ctx) {
  const snapCandidates = [];
  const passthrough = [];
  for (const e of ctx.entities) {
    if (rulesFor(e.entity_group).snap) snapCandidates.push(e);
    else passthrough.push(e);
  }
  const snapped = snapToWordBoundaries(snapCandidates, ctx.text);
  return { ...ctx, entities: [...snapped, ...passthrough] };
}
