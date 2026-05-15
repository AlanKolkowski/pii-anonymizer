export const PIPELINE_STEPS = [
  { id: 'load', label: 'Pobieranie modeli' },
  { id: 'pre', label: 'Preprocessing — normalizacja whitespace' },
  { id: 'seg', label: 'Segmentacja zdań (sentencex)' },
  { id: 'model-load', label: 'Ładowanie modeli (WASM/WebNN)' },
  { id: 'ner', label: 'Inferencja NER — modele HF i reguły' },
  { id: 'post', label: 'Postprocessing — filtrowanie i granice słów' },
  { id: 'rescan', label: 'Rescan i tokenizacja wykrytych PII' },
];

const STEP_INDEX = new Map(PIPELINE_STEPS.map((step, index) => [step.id, index]));

const START_MARK_TO_STEP = {
  'pipeline:load:start': 'load',
  'model:load:start': 'model-load',
  'pipeline:preprocess:start': 'pre',
  'pipeline:segment:start': 'seg',
  'pipeline:model-load:start': 'model-load',
  'pipeline:ner:start': 'ner',
  'pipeline:postprocess:start': 'post',
  'pipeline:rescan:start': 'rescan',
};

const END_MARK_TO_STEP = {
  'pipeline:load:end': 'load',
  'pipeline:preprocess:end': 'pre',
  'pipeline:segment:end': 'seg',
  'pipeline:model-load:end': 'model-load',
  'pipeline:ner:end': 'ner',
  'pipeline:postprocess:end': 'post',
  'pipeline:rescan:end': 'rescan',
};

function freshSteps(activeIndex = 0, t = null) {
  return PIPELINE_STEPS.map((step, index) => ({
    ...step,
    status: index === activeIndex ? 'active' : 'pending',
    progress: index === activeIndex ? 0 : null,
    durationMs: null,
    startedAt: index === activeIndex ? t : null,
  }));
}

export function createInitialProgressState() {
  return {
    visible: false,
    fading: false,
    status: 'idle',
    batchTotal: 0,
    sourceIndex: 0,
    sourceId: null,
    activeStepIndex: 0,
    stepProgress: 0,
    steps: freshSteps(0),
    download: null,
    modelLoad: null,
    ner: null,
    loadStartedByPipeline: false,
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
    ner: state.ner ? { ...state.ner } : null,
  };
}

function clamp01(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function progressFromEvent(event) {
  const loaded = Number(event.loadedBytes);
  const total = Number(event.totalBytes);
  if (Number.isFinite(loaded) && Number.isFinite(total) && total > 0) {
    return clamp01(loaded / total);
  }
  return clamp01(Number(event.progress) / 100);
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
  if (stepId !== 'load') next.download = null;
  if (stepId !== 'model-load') next.modelLoad = null;
  if (stepId !== 'ner') next.ner = null;
  return next;
}

function completeStep(state, stepId, t) {
  const stepIndex = STEP_INDEX.get(stepId);
  if (stepIndex == null) return state;

  let next = cloneState(state);
  next.visible = true;
  next.fading = false;
  next.status = 'running';
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

  const nextIndex = Math.min(stepIndex + 1, PIPELINE_STEPS.length - 1);
  if (stepIndex < PIPELINE_STEPS.length - 1) {
    next.steps[nextIndex].status = 'active';
    next.steps[nextIndex].progress = 0;
    next.steps[nextIndex].startedAt = null;
    next.activeStepIndex = nextIndex;
  } else {
    next.activeStepIndex = stepIndex;
  }
  next.stepProgress = next.steps[next.activeStepIndex]?.progress ?? 0;
  if (stepId === 'load') next.download = null;
  if (stepId === 'model-load') next.modelLoad = null;
  if (stepId === 'ner') next.ner = null;
  return next;
}

function completeAllSteps(state, t) {
  const next = cloneState(state);
  next.visible = true;
  next.fading = false;
  next.status = 'done';
  next.lastT = t ?? next.lastT;
  next.stepProgress = 1;
  next.download = null;
  next.modelLoad = null;
  next.ner = null;

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

function updateLoadProgress(state, event) {
  const loadStep = state.steps[0];
  let next;
  if (state.loadStartedByPipeline && loadStep?.status === 'active') {
    next = cloneState(state);
    next.visible = true;
    next.fading = false;
    next.status = 'running';
    next.activeStepIndex = 0;
  } else if (loadStep?.status === 'done') {
    return state;
  } else {
    next = activateStep(state, 'load', event.t);
  }

  const progress = progressFromEvent(event);
  next.steps[0].progress = progress;
  next.stepProgress = progress;
  next.download = {
    status: event.status ?? 'progress',
    file: event.file ?? '',
    progress: progress * 100,
    loadedBytes: Number.isFinite(Number(event.loadedBytes)) ? Number(event.loadedBytes) : null,
    totalBytes: Number.isFinite(Number(event.totalBytes)) ? Number(event.totalBytes) : null,
    fileLoadedBytes: Number.isFinite(Number(event.fileLoadedBytes)) ? Number(event.fileLoadedBytes) : null,
    fileTotalBytes: Number.isFinite(Number(event.fileTotalBytes)) ? Number(event.fileTotalBytes) : null,
    cachedFiles: Number.isFinite(Number(event.cachedFiles)) ? Number(event.cachedFiles) : null,
    remainingFiles: Number.isFinite(Number(event.remainingFiles)) ? Number(event.remainingFiles) : null,
    totalFiles: Number.isFinite(Number(event.totalFiles)) ? Number(event.totalFiles) : null,
  };
  next.lastT = event.t ?? next.lastT;
  return next;
}

function updateModelLoadProgress(state, event) {
  const modelLoadIndex = STEP_INDEX.get('model-load');
  const modelLoadStep = state.steps[modelLoadIndex];
  let next;
  if (modelLoadStep?.status === 'done') return state;
  if (modelLoadStep?.status === 'active') {
    next = cloneState(state);
    next.visible = true;
    next.fading = false;
    next.status = 'running';
    next.activeStepIndex = modelLoadIndex;
  } else {
    next = activateStep(state, 'model-load', event.t);
  }

  const total = Math.max(0, Number(event.total ?? event.models ?? 0));
  const completed = Math.max(0, Number(event.completed ?? 0));
  const progress = total > 0 ? clamp01(completed / total) : 1;
  next.steps[modelLoadIndex].progress = progress;
  next.stepProgress = progress;
  next.modelLoad = {
    status: event.status ?? 'loading',
    completed,
    total,
    models: total,
    source: event.source ?? null,
    device: event.device ?? null,
    cached: Boolean(event.cached),
    progress: progress * 100,
  };
  next.lastT = event.t ?? next.lastT;
  return next;
}

function updateNerProgress(state, event) {
  const nerIndex = STEP_INDEX.get('ner');
  const nerStep = state.steps[nerIndex];
  let next;
  if (nerStep?.status === 'done') return state;
  if (nerStep?.status === 'active') {
    next = cloneState(state);
    next.visible = true;
    next.fading = false;
    next.status = 'running';
    next.activeStepIndex = nerIndex;
  } else {
    next = activateStep(state, 'ner', event.t);
  }

  const completed = Math.max(0, Number(event.completed ?? 0));
  const total = Math.max(0, Number(event.total ?? 0));
  const progress = total > 0 ? clamp01(completed / total) : 0;
  next.steps[nerIndex].progress = progress;
  next.stepProgress = progress;
  next.ner = {
    completed,
    total,
    segments: Math.max(0, Number(event.segments ?? 0)),
    models: Math.max(0, Number(event.models ?? 0)),
    source: event.source ?? null,
    progress: progress * 100,
  };
  next.lastT = event.t ?? next.lastT;
  return next;
}

export function progressReducer(state, event) {
  switch (event.type) {
    case 'batch-start': {
      const next = createInitialProgressState();
      next.visible = true;
      next.status = 'running';
      next.batchTotal = Math.max(0, event.total ?? 0);
      next.lastT = event.t ?? null;
      return next;
    }
    case 'source-start': {
      const total = Math.max(1, event.total ?? state.batchTotal ?? 1);
      const sourceIndex = Math.max(1, event.index ?? state.sourceIndex + 1);
      return {
        ...state,
        visible: true,
        fading: false,
        status: 'running',
        batchTotal: total,
        sourceIndex,
        sourceId: event.id ?? null,
        activeStepIndex: 0,
        stepProgress: 0,
        steps: freshSteps(0, null),
        download: null,
        modelLoad: null,
        ner: null,
        loadStartedByPipeline: false,
        sourceStartedAt: event.t ?? state.lastT ?? null,
        lastT: event.t ?? state.lastT ?? null,
      };
    }
    case 'timing': {
      if (event.mark === 'pipeline:load:start') {
        return { ...activateStep(state, 'load', event.t), loadStartedByPipeline: true };
      }
      if (event.mark === 'model:load:start' && state.activeStepIndex > STEP_INDEX.get('model-load')) {
        return { ...state, lastT: event.t ?? state.lastT };
      }
      const startStep = START_MARK_TO_STEP[event.mark];
      if (startStep) return activateStep(state, startStep, event.t);
      const endStep = END_MARK_TO_STEP[event.mark];
      if (endStep) {
        const next = completeStep(state, endStep, event.t);
        return event.mark === 'pipeline:load:end' ? { ...next, loadStartedByPipeline: false } : next;
      }
      return state;
    }
    case 'download-progress':
      return updateLoadProgress(state, event);
    case 'model-load-plan':
    case 'model-load-progress':
      return updateModelLoadProgress(state, event);
    case 'ner-plan':
    case 'ner-progress':
      return updateNerProgress(state, event);
    case 'result':
      return completeAllSteps(state, event.t);
    case 'fade':
      return { ...state, visible: true, fading: true };
    case 'hide':
      return createInitialProgressState();
    case 'error':
      return { ...completeAllSteps(state, event.t), status: 'error' };
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

function etaSecondsForState() {
  // Per-step progress is measured with different units (bytes, inferences, or
  // discrete phase completion), so a global ETA would imply a false weighting.
  return null;
}

export function formatBytes(bytes) {
  let value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  const digits = unit === 0 ? 0 : (value < 10 ? 1 : 0);
  return `${value.toFixed(digits)} ${units[unit]}`;
}

function polishCountWord(count, one, few, many) {
  const n = Math.abs(Number(count));
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (n === 1) return one;
  if (mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14)) return few;
  return many;
}

function activeProgressForState(state) {
  const percent = activePercentForState(state);
  const active = state.steps[state.activeStepIndex] ?? state.steps[0];

  if (active.id === 'model-load' && state.modelLoad) {
    const total = Math.max(0, Number(state.modelLoad.total ?? state.modelLoad.models ?? 0));
    const completed = Math.min(total, Math.max(0, Number(state.modelLoad.completed ?? 0)));
    const discretePercent = total > 0 ? Math.round((completed / total) * 100) : 100;
    const loading = state.modelLoad.status === 'loading' && completed < total;

    return {
      mode: loading ? 'segment-indeterminate' : 'discrete',
      percent: discretePercent,
      label: `${completed}/${total}`,
      segmentStartPercent: total > 0 ? (completed / total) * 100 : 0,
      segmentEndPercent: total > 0 ? (Math.min(completed + 1, total) / total) * 100 : 100,
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
  if (active.id === 'load' && state.download) {
    const pct = Math.round(state.download.progress);
    const loaded = state.download.loadedBytes;
    const total = state.download.totalBytes;
    const file = state.download.file ? ` · ${state.download.file}` : '';
    if ((state.download.remainingFiles ?? 0) === 0 && total === 0) {
      return { label: 'Modele są już w cache', metric: '' };
    }
    if (total > 0) {
      return {
        label: `Pobieranie modeli${file}`,
        metric: `${pct}% · ${formatBytes(loaded)} / ${formatBytes(total)}`,
      };
    }
    return state.download.status === 'plan'
      ? { label: 'Sprawdzanie cache modeli', metric: '' }
      : { label: `Pobieranie modeli${file}`, metric: `${pct}%` };
  }
  if (active.id === 'model-load' && state.modelLoad) {
    const { completed, total, source, status, device } = state.modelLoad;
    if (total === 0) return { label: 'Brak modeli do załadowania — używam cache lub reguł', metric: '' };
    const sourceText = source ? ` · ${source}` : '';
    const deviceText = device ? ` (${device === 'webnn-gpu' ? 'WebNN GPU' : 'WASM'})` : '';
    if (status === 'loading') {
      return { label: `Ładowanie modelu${sourceText}`, metric: `${completed}/${total}` };
    }
    return { label: `Załadowano model${sourceText}${deviceText}`, metric: `${completed}/${total}` };
  }
  if (active.id === 'ner' && state.ner) {
    if (state.ner.total > 0) {
      const modelWord = polishCountWord(state.ner.models, 'model', 'modele', 'modeli');
      const segmentWord = polishCountWord(state.ner.segments, 'segment', 'segmenty', 'segmentów');
      return {
        label: `Inferencja NER · ${state.ner.models} ${modelWord} × ${state.ner.segments} ${segmentWord}`,
        metric: `${state.ner.completed}/${state.ner.total}`,
      };
    }
    if (state.ner.models === 0) return { label: 'Brak inferencji modeli — używam cache lub reguł', metric: '' };
    return { label: 'Przygotowanie inferencji NER', metric: '' };
  }
  return { label: active.label, metric: '' };
}

export function getProgressView(state) {
  const activeStep = state.steps[state.activeStepIndex] ?? state.steps[0];
  const activeProgress = activeProgressForState(state);
  const progressText = progressTextForState(state);
  const percent = activeProgress.percent;
  return {
    visible: state.visible,
    fading: state.fading,
    status: state.status,
    percent,
    activePercent: percent,
    activeProgress,
    etaSeconds: etaSecondsForState(state),
    currentLabel: progressText.label,
    currentMetric: progressText.metric,
    activeStep,
    activeStepIndex: state.activeStepIndex,
    totalSteps: PIPELINE_STEPS.length,
    sourceIndex: state.sourceIndex,
    batchTotal: state.batchTotal,
    documentLabel: state.batchTotal > 1
      ? `Dokument ${state.sourceIndex} z ${state.batchTotal}`
      : '',
    steps: state.steps,
  };
}

export function formatStepDuration(ms) {
  if (ms == null) return '';
  const seconds = ms / 1000;
  if (seconds < 1) return `${seconds.toFixed(2)}s`;
  if (seconds < 10) return `${seconds.toFixed(1)}s`;
  return `${Math.round(seconds)}s`;
}
