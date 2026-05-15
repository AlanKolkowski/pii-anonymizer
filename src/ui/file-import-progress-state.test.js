import { describe, expect, it } from 'vitest';
import {
  createInitialFileImportProgressState,
  fileImportProgressReducer,
  getFileImportProgressView,
} from './file-import-progress-state.js';

function reduce(events) {
  return events.reduce(fileImportProgressReducer, createInitialFileImportProgressState());
}

describe('fileImportProgressReducer', () => {
  it('stays hidden for file imports that never trigger OCR', () => {
    const state = reduce([
      { type: 'batch-start', total: 1, t: 0 },
      { type: 'file-start', id: 'file-1', label: 'tekst.pdf', index: 1, total: 1, t: 1 },
      { type: 'file-result', id: 'file-1', t: 20 },
    ]);

    expect(getFileImportProgressView(state).visible).toBe(false);
  });

  it('tracks OCR model download, model loading, and page-by-page OCR', () => {
    let state = createInitialFileImportProgressState();
    state = fileImportProgressReducer(state, { type: 'batch-start', total: 2, t: 0 });
    state = fileImportProgressReducer(state, { type: 'file-start', id: 'file-1', label: 'skan.pdf', index: 1, total: 2, t: 10 });
    state = fileImportProgressReducer(state, {
      type: 'progress',
      stage: 'ocr-plan',
      kind: 'pdf',
      current: 0,
      completed: 0,
      total: 2,
      pageCount: 2,
      t: 20,
    });

    let view = getFileImportProgressView(state);
    expect(view.visible).toBe(true);
    expect(view.activeStep.id).toBe('download');
    expect(view.documentLabel).toBe('Plik 1 z 2 · skan.pdf');

    state = fileImportProgressReducer(state, {
      type: 'progress',
      stage: 'model-download',
      status: 'progress',
      file: 'detekcja tekstu',
      progress: 25,
      fileLoadedBytes: 250,
      fileTotalBytes: 1000,
      completedFiles: 0,
      totalFiles: 2,
      t: 30,
    });

    view = getFileImportProgressView(state);
    expect(view.currentLabel).toBe('Pobieranie modelu OCR · detekcja tekstu');
    expect(view.currentMetric).toBe('25% · 250 B / 1.0 KB');
    expect(view.percent).toBe(25);

    state = fileImportProgressReducer(state, { type: 'model-load', mark: 'model:load:start', t: 40 });
    view = getFileImportProgressView(state);
    expect(view.activeStep.id).toBe('model-load');
    expect(view.activeProgress).toMatchObject({ mode: 'segment-indeterminate', label: '…' });

    state = fileImportProgressReducer(state, { type: 'model-load', mark: 'model:load:end', t: 60 });
    state = fileImportProgressReducer(state, {
      type: 'progress',
      stage: 'ocr',
      kind: 'pdf',
      status: 'page-start',
      current: 1,
      completed: 0,
      total: 2,
      page: 1,
      pageCount: 2,
      t: 70,
    });

    view = getFileImportProgressView(state);
    expect(view.activeStep.id).toBe('ocr');
    expect(view.currentLabel).toBe('OCR strony PDF 1');
    expect(view.currentMetric).toBe('1/2');
    expect(view.activeProgress).toMatchObject({
      mode: 'segment-indeterminate',
      label: '1/2',
      segmentStartPercent: 0,
      segmentEndPercent: 50,
    });

    state = fileImportProgressReducer(state, {
      type: 'progress',
      stage: 'ocr',
      kind: 'pdf',
      status: 'page-done',
      current: 1,
      completed: 1,
      total: 2,
      page: 1,
      pageCount: 2,
      t: 100,
    });

    view = getFileImportProgressView(state);
    expect(view.percent).toBe(50);
    expect(view.activeProgress).toMatchObject({ mode: 'discrete', label: '1/2' });

    state = fileImportProgressReducer(state, { type: 'file-result', id: 'file-1', t: 160 });
    view = getFileImportProgressView(state);
    expect(view.status).toBe('done');
    expect(view.percent).toBe(100);
    expect(view.steps.every((step) => step.status === 'done')).toBe(true);
  });

  it('continues OCR ring segments across a batch of images', () => {
    let state = createInitialFileImportProgressState();
    state = fileImportProgressReducer(state, { type: 'batch-start', total: 3, t: 0 });
    state = fileImportProgressReducer(state, { type: 'file-start', id: 'img-1', label: '1.png', index: 1, total: 3, t: 10 });
    state = fileImportProgressReducer(state, { type: 'progress', stage: 'ocr-plan', kind: 'image', current: 0, completed: 0, total: 1, pageCount: 1, t: 20 });
    state = fileImportProgressReducer(state, { type: 'progress', stage: 'ocr', kind: 'image', status: 'page-start', current: 1, completed: 0, total: 1, page: 1, t: 30 });

    let view = getFileImportProgressView(state);
    expect(view.currentLabel).toBe('OCR obrazu');
    expect(view.currentMetric).toBe('1/3');
    expect(view.activeProgress).toMatchObject({
      mode: 'segment-indeterminate',
      label: '1/3',
      segmentStartPercent: 0,
    });
    expect(view.activeProgress.segmentEndPercent).toBeCloseTo(100 / 3, 5);

    state = fileImportProgressReducer(state, { type: 'progress', stage: 'ocr', kind: 'image', status: 'page-done', current: 1, completed: 1, total: 1, page: 1, t: 50 });
    state = fileImportProgressReducer(state, { type: 'file-start', id: 'img-2', label: '2.png', index: 2, total: 3, t: 60 });

    view = getFileImportProgressView(state);
    expect(view.visible).toBe(true);
    expect(view.status).toBe('running');
    expect(view.activeStep.id).toBe('ocr');
    expect(view.currentMetric).toBe('1/3');

    state = fileImportProgressReducer(state, { type: 'progress', stage: 'ocr-plan', kind: 'image', current: 0, completed: 0, total: 1, pageCount: 1, t: 70 });
    view = getFileImportProgressView(state);
    expect(view.activeStep.id).toBe('ocr');
    expect(view.currentMetric).toBe('1/3');

    state = fileImportProgressReducer(state, { type: 'progress', stage: 'ocr', kind: 'image', status: 'page-start', current: 1, completed: 0, total: 1, page: 1, t: 80 });

    view = getFileImportProgressView(state);
    expect(view.documentLabel).toBe('Plik 2 z 3 · 2.png');
    expect(view.currentMetric).toBe('2/3');
    expect(view.activeProgress).toMatchObject({
      mode: 'segment-indeterminate',
      label: '2/3',
    });
    expect(view.activeProgress.segmentStartPercent).toBeCloseTo(100 / 3, 5);
    expect(view.activeProgress.segmentEndPercent).toBeCloseTo(200 / 3, 5);
  });
});
