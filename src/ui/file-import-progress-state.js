import { formatBytes } from './progress-state.js';

export const FILE_IMPORT_STEPS = [
  { id: 'scan', label: 'Sprawdzanie pliku i stron' },
  { id: 'download', label: 'Pobieranie modeli OCR' },
  { id: 'model-load', label: 'Ładowanie modeli OCR' },
  { id: 'ocr', label: 'OCR dokumentu' },
];

const STEP_INDEX = new Map(FILE_IMPORT_STEPS.map((step, index) => [step.id, index]));

function freshSteps(activeIndex = 0, t = null) {
  return FILE_IMPORT_STEPS.map((step, index) => ({
    ...step,
    status: index === activeIndex ? 'active' : 'pending',
    progress: index === activeIndex ? 0 : null,
    durationMs: null,
    startedAt: index === activeIndex ? t : null,
  }));
}

export function createInitialFileImportProgressState() {
  return {
    visible: false,
    fading: false,
    status: 'idle',
    triggered: false,
    batchTotal: 0,
    sourceIndex: 0,
    sourceId: null,
    fileLabel: '',
    activeStepIndex: 0,
    stepProgress: 0,
    steps: freshSteps(0),
    download: null,
    modelLoad: null,
    ocr: null,
    sourceStartedAt: null,
    lastT: null,
  };
}

function cloneState(state) {
  return {
    ...state,
    steps: state.steps.map((step) => ({ ...step })),
    download: state.download ? { ...state.download } : null,
    modelLoad: state.modelLoad ? { ...state.modelLoad } : null,
    ocr: state.ocr ? { ...state.ocr } : null,
  };
}

function clamp01(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function markPreviousDone(next, stepIndex, t) {
  for (let i = 0; i < stepIndex; i += 1) {
    const step = next.steps[i];
    if (step.status === 'done') continue;
    step.status = 'done';
    step.progress = 1;
    if (step.startedAt != null && t != null) {
      step.durationMs = Math.max(0, t - step.startedAt);
    }
  }
}

function activateStep(state, stepId, t) {
  const stepIndex = STEP_INDEX.get(stepId);
  if (stepIndex == null) return state;

  const next = cloneState(state);
  const wasActive = next.activeStepIndex === stepIndex && next.steps[stepIndex]?.status === 'active';
  next.visible = true;
  next.fading = false;
  next.status = 'running';
  next.triggered = true;
  next.lastT = t ?? next.lastT;

  markPreviousDone(next, stepIndex, t);

  next.steps.forEach((step, index) => {
    if (index < stepIndex) {
      step.status = 'done';
      step.progress = 1;
    } else if (index === stepIndex) {
      step.status = 'active';
      step.startedAt = wasActive ? (step.startedAt ?? t ?? next.lastT) : (t ?? step.startedAt ?? next.lastT);
      step.durationMs = null;
      step.progress = wasActive ? clamp01(step.progress ?? 0) : 0;
    } else {
      step.status = 'pending';
      step.progress = null;
      step.durationMs = null;
      step.startedAt = null;
    }
  });

  next.activeStepIndex = stepIndex;
  next.stepProgress = next.steps[stepIndex].progress ?? 0;
  return next;
}

function completeStep(state, stepId, t) {
  const stepIndex = STEP_INDEX.get(stepId);
  if (stepIndex == null) return state;

  let next = cloneState(state);
  next.visible = true;
  next.fading = false;
  next.status = 'running';
  next.triggered = true;
  next.lastT = t ?? next.lastT;

  if (next.steps[stepIndex].status === 'pending') {
    next = activateStep(next, stepId, t);
  }

  markPreviousDone(next, stepIndex, t);
  const step = next.steps[stepIndex];
  step.status = 'done';
  step.progress = 1;
  if (step.startedAt != null && t != null) {
    step.durationMs = Math.max(0, t - step.startedAt);
  }

  const nextIndex = Math.min(stepIndex + 1, FILE_IMPORT_STEPS.length - 1);
  if (stepIndex < FILE_IMPORT_STEPS.length - 1) {
    next.steps[nextIndex].status = 'active';
    next.steps[nextIndex].progress = 0;
    next.steps[nextIndex].startedAt = null;
    next.activeStepIndex = nextIndex;
  } else {
    next.activeStepIndex = stepIndex;
  }
  next.stepProgress = next.steps[next.activeStepIndex]?.progress ?? 0;
  return next;
}

function completeAllSteps(state, t, status = 'done') {
  if (!state.triggered && !state.visible) return createInitialFileImportProgressState();

  const next = cloneState(state);
  next.visible = true;
  next.fading = false;
  next.status = status;
  next.triggered = true;
  next.lastT = t ?? next.lastT;
  next.stepProgress = 1;

  next.steps.forEach((step, index) => {
    if (step.status !== 'done' && step.startedAt != null && t != null) {
      step.durationMs = Math.max(0, t - step.startedAt);
    }
    step.status = 'done';
    step.progress = 1;
    if (step.startedAt == null) step.startedAt = next.sourceStartedAt ?? t ?? null;
    next.activeStepIndex = index;
  });

  return next;
}

function progressFromDownload(event) {
  const progress = Number(event.progress);
  if (Number.isFinite(progress)) return clamp01(progress / 100);
  const loaded = Number(event.fileLoadedBytes ?? event.loadedBytes);
  const total = Number(event.fileTotalBytes ?? event.totalBytes);
  if (Number.isFinite(loaded) && Number.isFinite(total) && total > 0) return clamp01(loaded / total);
  return 0;
}

function imageBatchTotal(state, event) {
  if (event.kind !== 'image' || state.batchTotal <= 1) return 0;
  return Math.max(state.batchTotal, state.sourceIndex, 1);
}

function imageBatchCompletedOffset(state, event) {
  return imageBatchTotal(state, event) > 0 ? Math.max(0, state.sourceIndex - 1) : 0;
}

function activateOcrStepKeepingSetupDone(state, t, progress = 0) {
  const ocrIndex = STEP_INDEX.get('ocr');
  const next = cloneState(state);
  next.visible = true;
  next.fading = false;
  next.status = 'running';
  next.triggered = true;
  next.lastT = t ?? next.lastT;
  markPreviousDone(next, ocrIndex, t);
  next.steps.forEach((step, index) => {
    if (index < ocrIndex) {
      step.status = 'done';
      step.progress = 1;
    } else if (index === ocrIndex) {
      step.status = 'active';
      step.progress = progress;
      step.durationMs = null;
      step.startedAt = step.startedAt ?? t ?? next.lastT;
    } else {
      step.status = 'pending';
      step.progress = null;
      step.durationMs = null;
      step.startedAt = null;
    }
  });
  next.activeStepIndex = ocrIndex;
  next.stepProgress = progress;
  return next;
}

function updateOcrPlan(state, event) {
  const batchTotal = imageBatchTotal(state, event);
  const completedOffset = imageBatchCompletedOffset(state, event);
  const plannedTotal = batchTotal || Math.max(0, Number(event.total ?? 0));
  const plannedProgress = plannedTotal > 0 ? clamp01(completedOffset / plannedTotal) : 0;
  const keepOcrStep = batchTotal > 0 && state.visible && state.triggered && state.sourceIndex > 1;
  let next = keepOcrStep
    ? activateOcrStepKeepingSetupDone(state, event.t, plannedProgress)
    : activateStep(state, 'download', event.t);
  next.ocr = {
    kind: event.kind ?? 'document',
    status: 'planned',
    current: completedOffset,
    completed: completedOffset,
    total: plannedTotal,
    page: null,
    pageCount: Math.max(0, Number(event.pageCount ?? 0)),
  };
  return next;
}

function updateDownloadProgress(state, event) {
  const downloadIndex = STEP_INDEX.get('download');
  if (state.steps[downloadIndex]?.status === 'done') return state;
  const next = activateStep(state, 'download', event.t);
  const progress = progressFromDownload(event);
  next.steps[downloadIndex].progress = progress;
  next.stepProgress = progress;
  next.download = {
    status: event.status ?? 'progress',
    file: event.file ?? event.model ?? '',
    progress: progress * 100,
    fileLoadedBytes: Number.isFinite(Number(event.fileLoadedBytes)) ? Number(event.fileLoadedBytes) : null,
    fileTotalBytes: Number.isFinite(Number(event.fileTotalBytes)) ? Number(event.fileTotalBytes) : null,
    completedFiles: Number.isFinite(Number(event.completedFiles)) ? Number(event.completedFiles) : 0,
    cachedFiles: Number.isFinite(Number(event.cachedFiles)) ? Number(event.cachedFiles) : null,
    remainingFiles: Number.isFinite(Number(event.remainingFiles)) ? Number(event.remainingFiles) : null,
    totalFiles: Number.isFinite(Number(event.totalFiles)) ? Number(event.totalFiles) : 0,
  };
  next.lastT = event.t ?? next.lastT;
  return next;
}

function updateModelLoad(state, event) {
  if (event.mark === 'model:load:end' || event.type === 'model:load:end') {
    const next = completeStep(state, 'model-load', event.t);
    next.modelLoad = { status: 'ready' };
    return next;
  }

  let next = state;
  if (next.steps[STEP_INDEX.get('download')]?.status !== 'done') {
    next = completeStep(next, 'download', event.t);
  }
  next = activateStep(next, 'model-load', event.t);
  next.modelLoad = { status: 'loading' };
  next.steps[STEP_INDEX.get('model-load')].progress = 0;
  next.stepProgress = 0;
  return next;
}

function updateOcrProgress(state, event) {
  const ocrIndex = STEP_INDEX.get('ocr');
  let next = activateStep(state, 'ocr', event.t);
  const batchTotal = imageBatchTotal(state, event);
  const completedOffset = imageBatchCompletedOffset(state, event);
  const localTotal = Math.max(0, Number(event.total ?? next.ocr?.total ?? 0));
  const total = batchTotal || localTotal;
  const status = event.status ?? 'progress';
  const localCurrent = Math.max(0, Number(event.current ?? next.ocr?.current ?? 0));
  const localCompletedFallback = status === 'page-start' ? Math.max(0, localCurrent - 1) : localCurrent;
  const localCompleted = Math.max(0, Number(event.completed ?? localCompletedFallback));
  const current = batchTotal > 0 ? Math.min(total, completedOffset + localCurrent) : localCurrent;
  const completed = batchTotal > 0 ? Math.min(total, completedOffset + localCompleted) : localCompleted;
  const progress = total > 0 ? clamp01(completed / total) : 0;

  next.steps[ocrIndex].progress = progress;
  next.stepProgress = progress;
  next.ocr = {
    kind: event.kind ?? next.ocr?.kind ?? 'document',
    status,
    current,
    completed,
    total,
    page: event.page ?? next.ocr?.page ?? null,
    pageCount: Math.max(0, Number(event.pageCount ?? next.ocr?.pageCount ?? 0)),
  };
  next.lastT = event.t ?? next.lastT;
  return next;
}

export function fileImportProgressReducer(state, event) {
  switch (event.type) {
    case 'batch-start': {
      const next = createInitialFileImportProgressState();
      next.batchTotal = Math.max(0, event.total ?? 0);
      next.lastT = event.t ?? null;
      return next;
    }
    case 'file-start': {
      const total = Math.max(1, event.total ?? state.batchTotal ?? 1);
      const sourceIndex = Math.max(1, event.index ?? state.sourceIndex + 1);
      const keepVisible = Boolean(state.visible && state.triggered && total > 1);
      if (keepVisible) {
        return {
          ...cloneState(state),
          visible: true,
          fading: false,
          status: 'running',
          triggered: true,
          batchTotal: total,
          sourceIndex,
          sourceId: event.id ?? null,
          fileLabel: event.label ?? '',
          sourceStartedAt: event.t ?? state.lastT ?? null,
          lastT: event.t ?? state.lastT ?? null,
        };
      }
      return {
        ...createInitialFileImportProgressState(),
        visible: false,
        status: 'running',
        batchTotal: total,
        sourceIndex,
        sourceId: event.id ?? null,
        fileLabel: event.label ?? '',
        sourceStartedAt: event.t ?? state.lastT ?? null,
        lastT: event.t ?? state.lastT ?? null,
      };
    }
    case 'progress': {
      if (event.stage === 'ocr-plan') return updateOcrPlan(state, event);
      if (event.stage === 'model-download') return updateDownloadProgress(state, event);
      if (event.stage === 'ocr') return updateOcrProgress(state, event);
      return state;
    }
    case 'model-load':
      return updateModelLoad(state, event);
    case 'file-result':
      return completeAllSteps(state, event.t, 'done');
    case 'error':
      return completeAllSteps(state, event.t, 'error');
    case 'fade':
      return state.visible ? { ...state, fading: true } : state;
    case 'hide':
      return createInitialFileImportProgressState();
    default:
      return state;
  }
}

function activePercentForState(state) {
  if (!state.visible) return 100;
  if (state.status === 'done' || state.status === 'error') return 100;
  const active = state.steps[state.activeStepIndex];
  return Math.round(clamp01(active?.progress ?? state.stepProgress ?? 0) * 100);
}

function activeProgressForState(state) {
  const active = state.steps[state.activeStepIndex] ?? state.steps[0];
  const percent = activePercentForState(state);

  if (state.status === 'done' || state.status === 'error') {
    return {
      mode: 'determinate',
      percent: 100,
      label: '100%',
    };
  }

  if (active.id === 'download' && state.download) {
    const totalFiles = Math.max(0, Number(state.download.totalFiles ?? 0));
    const completedFiles = Math.max(0, Number(state.download.completedFiles ?? 0));
    const fileTotal = Math.max(0, Number(state.download.fileTotalBytes ?? 0));
    const isDownloading = ['download', 'progress'].includes(state.download.status);
    if (fileTotal === 0 && totalFiles > 0 && isDownloading) {
      return {
        mode: 'segment-indeterminate',
        percent: totalFiles > 0 ? (completedFiles / totalFiles) * 100 : 0,
        label: `${Math.min(completedFiles + 1, totalFiles)}/${totalFiles}`,
        segmentStartPercent: totalFiles > 0 ? (completedFiles / totalFiles) * 100 : 0,
        segmentEndPercent: totalFiles > 0 ? (Math.min(completedFiles + 1, totalFiles) / totalFiles) * 100 : 100,
      };
    }
  }

  if (active.id === 'model-load') {
    return {
      mode: 'segment-indeterminate',
      percent: 0,
      label: '…',
      segmentStartPercent: 0,
      segmentEndPercent: 100,
    };
  }

  if (active.id === 'ocr' && state.ocr?.total > 0) {
    const { status, completed, current, total } = state.ocr;
    if (status === 'page-start' && completed < total) {
      return {
        mode: 'segment-indeterminate',
        percent: (completed / total) * 100,
        label: `${current}/${total}`,
        segmentStartPercent: (completed / total) * 100,
        segmentEndPercent: (Math.min(completed + 1, total) / total) * 100,
      };
    }
    const discretePercent = Math.round((completed / total) * 100);
    return {
      mode: 'discrete',
      percent: discretePercent,
      label: `${completed}/${total}`,
    };
  }

  return {
    mode: 'determinate',
    percent,
    label: `${percent}%`,
  };
}

function progressTextForState(state) {
  const active = state.steps[state.activeStepIndex] ?? state.steps[0];

  if (active.id === 'download' && state.download) {
    const totalFiles = state.download.totalFiles ?? 0;
    const completedFiles = state.download.completedFiles ?? 0;
    const file = state.download.file ? ` · ${state.download.file}` : '';
    if (state.download.status === 'plan') return { label: 'Sprawdzanie cache modeli OCR', metric: '' };
    if (state.download.status === 'complete' || (state.download.status === 'done' && completedFiles === totalFiles)) {
      return { label: 'Pobrano modele OCR', metric: totalFiles ? `${completedFiles}/${totalFiles} plików` : '' };
    }
    if (state.download.status === 'cached' && (state.download.remainingFiles === 0 || completedFiles === totalFiles)) {
      return { label: 'Modele OCR są już w cache', metric: totalFiles ? `${completedFiles}/${totalFiles} plików` : '' };
    }
    if (state.download.status === 'cached') {
      return { label: `Model OCR z cache${file}`, metric: totalFiles ? `${completedFiles}/${totalFiles} plików` : '' };
    }
    if ((state.download.fileTotalBytes ?? 0) > 0) {
      const filePct = Math.round((Math.max(0, state.download.fileLoadedBytes ?? 0) / state.download.fileTotalBytes) * 100);
      return {
        label: `Pobieranie modelu OCR${file}`,
        metric: `${filePct}% · ${formatBytes(state.download.fileLoadedBytes)} / ${formatBytes(state.download.fileTotalBytes)}`,
      };
    }
    return {
      label: `Pobieranie modelu OCR${file}`,
      metric: totalFiles ? `${Math.min(completedFiles + 1, totalFiles)}/${totalFiles} plików` : '',
    };
  }

  if (active.id === 'model-load') {
    return { label: 'Ładowanie modeli OCR (PaddleOCR)', metric: '' };
  }

  if (active.id === 'ocr' && state.ocr) {
    const total = state.ocr.total ?? 0;
    const metric = total > 0 ? `${state.ocr.current || state.ocr.completed}/${total}` : '';
    if (state.ocr.kind === 'image') return { label: 'OCR obrazu', metric };
    if (state.ocr.page) return { label: `OCR strony PDF ${state.ocr.page}`, metric };
    return { label: 'OCR dokumentu', metric };
  }

  return { label: active.label, metric: '' };
}

function documentLabelForState(state) {
  const file = state.fileLabel || '';
  if (state.batchTotal > 1) {
    const base = `Plik ${state.sourceIndex} z ${state.batchTotal}`;
    return file ? `${base} · ${file}` : base;
  }
  return file;
}

export function getFileImportProgressView(state) {
  const activeStep = state.steps[state.activeStepIndex] ?? state.steps[0];
  const activeProgress = activeProgressForState(state);
  const progressText = progressTextForState(state);
  return {
    visible: state.visible,
    fading: state.fading,
    status: state.status,
    percent: activeProgress.percent,
    activePercent: activeProgress.percent,
    activeProgress,
    etaSeconds: null,
    currentLabel: progressText.label,
    currentMetric: progressText.metric,
    activeStep,
    activeStepIndex: state.activeStepIndex,
    totalSteps: FILE_IMPORT_STEPS.length,
    sourceIndex: state.sourceIndex,
    batchTotal: state.batchTotal,
    documentLabel: documentLabelForState(state),
    steps: state.steps,
    title: 'Odczytywanie pliku przez OCR',
    doneTitle: 'OCR gotowy',
    errorTitle: 'Błąd OCR',
    stepsSummaryLabel: `${FILE_IMPORT_STEPS.length} kroki OCR`,
  };
}
