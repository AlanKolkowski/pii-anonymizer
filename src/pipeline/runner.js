import { createContext } from './context.js';

function entityKey(e) {
  return `${e.entity_group}:${e.start}-${e.end}`;
}

function diffEntities(before, after, text) {
  const beforeKeys = new Set(before.map(entityKey));
  const afterKeys = new Set(after.map(entityKey));

  const added = after
    .filter(e => !beforeKeys.has(entityKey(e)))
    .map(e => ({
      entity_group: e.entity_group,
      start: e.start,
      end: e.end,
      score: e.score,
      source: e.source,
      text: text.slice(e.start, e.end),
    }));

  const removed = before
    .filter(e => !afterKeys.has(entityKey(e)))
    .map(e => ({
      entity_group: e.entity_group,
      start: e.start,
      end: e.end,
      score: e.score,
      source: e.source,
      text: text.slice(e.start, e.end),
    }));

  return { added, removed, count: { before: before.length, after: after.length } };
}

function diffSegments(before, after) {
  if (before.length === after.length) return null;
  const added = after.slice(before.length).map(s => ({
    offset: s.offset,
    length: s.text.length,
    preview: s.text.slice(0, 60),
  }));
  return { added, count: { before: before.length, after: after.length } };
}

function diffLegend(before, after) {
  const added = {};
  for (const [key, val] of Object.entries(after)) {
    if (!(key in before)) added[key] = val;
  }
  if (Object.keys(added).length === 0) return null;
  return { added, count: { before: Object.keys(before).length, after: Object.keys(after).length } };
}

function diffContext(before, after) {
  const changes = {};

  // text
  if (after.text !== before.text) {
    changes.text = {
      changed: true,
      length: { before: before.text.length, after: after.text.length },
    };
  }

  // segments
  const segDiff = diffSegments(before.segments, after.segments);
  if (segDiff) changes.segments = segDiff;

  // entities — use after.text for slicing since entities reference the original text
  const entDiff = diffEntities(before.entities, after.entities, after.text);
  if (entDiff.added.length > 0 || entDiff.removed.length > 0) {
    changes.entities = entDiff;
  }

  // anonymized
  if (after.anonymized !== before.anonymized) {
    changes.anonymized = {
      changed: true,
      length: { before: before.anonymized.length, after: after.anonymized.length },
    };
  }

  // legend
  const legDiff = diffLegend(before.legend, after.legend);
  if (legDiff) changes.legend = legDiff;

  return changes;
}

function snapshotContext(ctx) {
  return {
    text: ctx.text,
    segments: ctx.segments,
    entities: ctx.entities,
    anonymized: ctx.anonymized,
    legend: ctx.legend,
  };
}

export async function runPipeline(input, pipeline) {
  let ctx = typeof input === 'string' ? createContext(input) : input;
  const debug = [];

  for (const { phase, steps } of pipeline) {
    for (const step of steps) {
      const before = snapshotContext(ctx);
      ctx = await step(ctx);
      // Strip any manual debug entries from the step (ignore them)
      ctx = { ...ctx, debug: [] };
      const changes = diffContext(before, ctx);
      debug.push({
        step: step.name || 'anonymous',
        phase,
        changes,
      });
    }
  }

  return { ...ctx, debug };
}
