import { describe, expect, it } from 'vitest';
import {
  createInitialProgressState,
  getProgressView,
  progressReducer,
} from './progress-state.js';

describe('progressReducer', () => {
  it('advances timing marks through steps, records durations, and keeps progress local to the active step', () => {
    let state = createInitialProgressState();
    state = progressReducer(state, { type: 'batch-start', total: 1, t: 100 });
    state = progressReducer(state, { type: 'source-start', id: 'doc-1', index: 1, total: 1, t: 100 });
    state = progressReducer(state, { type: 'timing', mark: 'pipeline:load:start', t: 100 });

    expect(getProgressView(state).activeStep.id).toBe('load');
    expect(getProgressView(state).percent).toBe(0);

    state = progressReducer(state, { type: 'timing', mark: 'pipeline:load:end', t: 160 });
    let view = getProgressView(state);
    expect(view.steps[0]).toMatchObject({ id: 'load', status: 'done', durationMs: 60 });
    expect(view.activeStep.id).toBe('pre');
    expect(view.percent).toBe(0);

    state = progressReducer(state, { type: 'timing', mark: 'pipeline:preprocess:start', t: 170 });
    state = progressReducer(state, { type: 'timing', mark: 'pipeline:preprocess:end', t: 210 });
    state = progressReducer(state, { type: 'timing', mark: 'pipeline:segment:start', t: 220 });

    view = getProgressView(state);
    expect(view.steps[1]).toMatchObject({ id: 'pre', status: 'done', durationMs: 40 });
    expect(view.steps[2]).toMatchObject({ id: 'seg', status: 'active' });
    expect(view.percent).toBe(0);
  });

  it('does not estimate a global ETA from differently weighted steps', () => {
    let state = createInitialProgressState();
    state = progressReducer(state, { type: 'batch-start', total: 1, t: 0 });
    state = progressReducer(state, { type: 'source-start', id: 'doc-1', index: 1, total: 1, t: 0 });

    expect(getProgressView(state).etaSeconds).toBeNull();

    state = progressReducer(state, { type: 'timing', mark: 'pipeline:load:start', t: 0 });
    state = progressReducer(state, { type: 'timing', mark: 'pipeline:load:end', t: 1200 });

    expect(getProgressView(state).etaSeconds).toBeNull();

    state = progressReducer(state, { type: 'timing', mark: 'pipeline:preprocess:start', t: 1200 });
    state = progressReducer(state, { type: 'timing', mark: 'pipeline:preprocess:end', t: 1300 });

    expect(getProgressView(state).etaSeconds).toBeNull();
  });

  it('keeps download progress local to the load step', () => {
    let state = createInitialProgressState();
    state = progressReducer(state, { type: 'batch-start', total: 1, t: 0 });
    state = progressReducer(state, { type: 'source-start', id: 'doc-1', index: 1, total: 1, t: 0 });
    state = progressReducer(state, {
      type: 'download-progress',
      file: 'eu-pii-pl/model.onnx',
      progress: 42,
      t: 50,
    });

    const view = getProgressView(state);
    expect(view.activeStep.id).toBe('load');
    expect(view.currentLabel).toBe('Pobieranie modeli · 42% · eu-pii-pl/model.onnx');
    expect(view.percent).toBe(42);
  });

  it('uses aggregate downloaded bytes when available', () => {
    let state = createInitialProgressState();
    state = progressReducer(state, { type: 'batch-start', total: 1, t: 0 });
    state = progressReducer(state, { type: 'source-start', id: 'doc-1', index: 1, total: 1, t: 0 });
    state = progressReducer(state, {
      type: 'download-progress',
      file: 'model-a/onnx/model.onnx',
      loadedBytes: 250,
      totalBytes: 1000,
      progress: 99,
      t: 50,
    });

    const view = getProgressView(state);
    expect(view.percent).toBe(25);
    expect(view.currentLabel).toBe('Pobieranie modeli · 25% (250 B / 1.0 KB) · model-a/onnx/model.onnx');
  });

  it('tracks NER progress by completed model/segment inferences', () => {
    let state = createInitialProgressState();
    state = progressReducer(state, { type: 'batch-start', total: 1, t: 0 });
    state = progressReducer(state, { type: 'source-start', id: 'doc-1', index: 1, total: 1, t: 0 });
    state = progressReducer(state, { type: 'timing', mark: 'pipeline:ner:start', t: 100 });
    state = progressReducer(state, {
      type: 'ner-progress',
      completed: 3,
      total: 10,
      segments: 5,
      models: 2,
      t: 120,
    });

    const view = getProgressView(state);
    expect(view.activeStep.id).toBe('ner');
    expect(view.percent).toBe(30);
    expect(view.currentLabel).toBe('Inferencje 3 z 10 (2 modele × 5 segmentów)');
  });

  it('does not let individual model-load marks shorten the load bucket duration', () => {
    let state = createInitialProgressState();
    state = progressReducer(state, { type: 'batch-start', total: 1, t: 0 });
    state = progressReducer(state, { type: 'source-start', id: 'doc-1', index: 1, total: 1, t: 0 });
    state = progressReducer(state, { type: 'timing', mark: 'pipeline:load:start', t: 100 });
    state = progressReducer(state, { type: 'timing', mark: 'model:load:start', t: 120 });
    state = progressReducer(state, { type: 'timing', mark: 'model:load:end', t: 180 });
    state = progressReducer(state, { type: 'timing', mark: 'model:load:start', t: 220 });
    state = progressReducer(state, { type: 'timing', mark: 'model:load:end', t: 360 });
    state = progressReducer(state, { type: 'timing', mark: 'pipeline:load:end', t: 400 });

    expect(getProgressView(state).steps[0].durationMs).toBe(300);
  });

  it('keeps model session loads inside the active NER phase after downloads finish', () => {
    let state = createInitialProgressState();
    state = progressReducer(state, { type: 'batch-start', total: 1, t: 0 });
    state = progressReducer(state, { type: 'source-start', id: 'doc-1', index: 1, total: 1, t: 0 });
    state = progressReducer(state, { type: 'timing', mark: 'pipeline:load:start', t: 0 });
    state = progressReducer(state, { type: 'timing', mark: 'pipeline:load:end', t: 20 });
    state = progressReducer(state, { type: 'timing', mark: 'pipeline:preprocess:start', t: 30 });
    state = progressReducer(state, { type: 'timing', mark: 'pipeline:preprocess:end', t: 40 });
    state = progressReducer(state, { type: 'timing', mark: 'pipeline:segment:start', t: 50 });
    state = progressReducer(state, { type: 'timing', mark: 'pipeline:segment:end', t: 60 });
    state = progressReducer(state, { type: 'timing', mark: 'pipeline:ner:start', t: 70 });
    state = progressReducer(state, { type: 'timing', mark: 'model:load:start', t: 80 });

    expect(getProgressView(state).activeStep.id).toBe('ner');
  });

  it('does not let download progress shorten the load bucket duration', () => {
    let state = createInitialProgressState();
    state = progressReducer(state, { type: 'batch-start', total: 1, t: 0 });
    state = progressReducer(state, { type: 'source-start', id: 'doc-1', index: 1, total: 1, t: 0 });
    state = progressReducer(state, { type: 'timing', mark: 'pipeline:load:start', t: 100 });
    state = progressReducer(state, {
      type: 'download-progress',
      file: 'eu-pii-pl/model.onnx',
      progress: 50,
      t: 200,
    });
    state = progressReducer(state, { type: 'timing', mark: 'pipeline:load:end', t: 400 });

    expect(getProgressView(state).steps[0].durationMs).toBe(300);
  });

  it('resets the stepper for each source in a multi-document batch', () => {
    let state = createInitialProgressState();
    state = progressReducer(state, { type: 'batch-start', total: 3, t: 0 });
    state = progressReducer(state, { type: 'source-start', id: 'doc-1', index: 1, total: 3, t: 0 });
    state = progressReducer(state, { type: 'timing', mark: 'pipeline:load:start', t: 0 });
    state = progressReducer(state, { type: 'timing', mark: 'pipeline:load:end', t: 100 });

    expect(getProgressView(state).steps[0].status).toBe('done');

    state = progressReducer(state, { type: 'source-start', id: 'doc-2', index: 2, total: 3, t: 150 });

    const view = getProgressView(state);
    expect(view.documentLabel).toBe('Dokument 2 z 3');
    expect(view.activeStep.id).toBe('load');
    expect(view.steps[0]).toMatchObject({ id: 'load', status: 'active', durationMs: null });
    expect(view.percent).toBe(0);
  });

  it('marks every step complete when the result arrives', () => {
    let state = createInitialProgressState();
    state = progressReducer(state, { type: 'batch-start', total: 1, t: 0 });
    state = progressReducer(state, { type: 'source-start', id: 'doc-1', index: 1, total: 1, t: 0 });
    state = progressReducer(state, { type: 'timing', mark: 'pipeline:load:start', t: 0 });
    state = progressReducer(state, { type: 'result', id: 'doc-1', t: 350 });

    const view = getProgressView(state);
    expect(view.status).toBe('done');
    expect(view.percent).toBe(100);
    expect(view.steps.every((step) => step.status === 'done')).toBe(true);
  });
});
