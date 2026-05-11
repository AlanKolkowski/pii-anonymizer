export const PIPELINE_STEPS = [
  { id: 'load', label: 'Ładowanie modeli NER' },
  { id: 'pre', label: 'Preprocessing — normalizacja whitespace' },
  { id: 'seg', label: 'Segmentacja zdań (sentencex)' },
  { id: 'ner', label: 'Detekcja encji — modele HF i reguły' },
  { id: 'post', label: 'Postprocessing — filtrowanie i granice słów' },
  { id: 'rescan', label: 'Rescan i tokenizacja wykrytych PII' },
];

const STEP_INDEX = new Map(PIPELINE_STEPS.map((step, index) => [step.id, index]));

const START_MARK_TO_STEP = {
  'classify:start': 'load',
  'pipeline:load:start': 'load',
  'model:load:start': 'load',
  'pipeline:preprocess:start': 'pre',
  'pipeline:segment:start': 'seg',
  'pipeline:ner:start': 'ner',
  'pipeline:postprocess:start': 'post',
  'pipeline:rescan:start': 'rescan',
};

const END_MARK_TO_STEP = {
  'pipeline:load:end': 'load',
  'pipeline:preprocess:end': 'pre',
  'pipeline:segment:end': 'seg',
  'pipeline:ner:end': 'ner',
  'pipeline:postprocess:end': 'post',
  'pipeline:rescan:end': 'rescan',
};

function freshSteps(activeIndex = 0, t = null) {
  return PIPELINE_STEPS.map((step, index) => ({
    ...step,
    status: index === activeIndex ? 'active' : 'pending',
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
  };
}

function clampPercent(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
}

function markPreviousDone(next, stepIndex, t) {
  for (let i = 0; i < stepIndex; i += 1) {
    const step = next.steps[i];
    if (step.status === 'done') continue;
    step.status = 'done';
    if (step.startedAt != null && t != null) {
      step.durationMs = Math.max(0, t - step.startedAt);
    }
  }
}

function activateStep(state, stepId, t) {
  const stepIndex = STEP_INDEX.get(stepId);
  if (stepIndex == null) return state;

  const next = cloneState(state);
  next.visible = true;
  next.fading = false;
  next.status = 'running';
  next.lastT = t ?? next.lastT;

  markPreviousDone(next, stepIndex, t);

  next.steps.forEach((step, index) => {
    if (index < stepIndex) {
      step.status = 'done';
    } else if (index === stepIndex) {
      step.status = 'active';
      step.startedAt = t ?? step.startedAt ?? next.lastT;
      step.durationMs = null;
    } else {
        step.status = 'pending';
        step.durationMs = null;
        step.startedAt = null;
      }
  });

  next.activeStepIndex = stepIndex;
  next.stepProgress = 0;
  if (stepId !== 'load') next.download = null;
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
  if (step.startedAt != null && t != null) {
    step.durationMs = Math.max(0, t - step.startedAt);
  }

  const nextIndex = Math.min(stepIndex + 1, PIPELINE_STEPS.length - 1);
  if (stepIndex < PIPELINE_STEPS.length - 1) {
    next.steps[nextIndex].status = 'active';
    if (next.steps[nextIndex].startedAt == null) next.steps[nextIndex].startedAt = t ?? next.lastT;
    next.activeStepIndex = nextIndex;
  } else {
    next.activeStepIndex = stepIndex;
  }
  next.stepProgress = 0;
  if (stepId === 'load') next.download = null;
  return next;
}

function completeAllSteps(state, t) {
  const next = cloneState(state);
  next.visible = true;
  next.fading = false;
  next.status = 'done';
  next.lastT = t ?? next.lastT;
  next.stepProgress = 0;
  next.download = null;

  next.steps.forEach((step, index) => {
    if (step.status !== 'done' && step.startedAt != null && t != null) {
      step.durationMs = Math.max(0, t - step.startedAt);
    }
    step.status = 'done';
    if (step.startedAt == null) step.startedAt = next.sourceStartedAt ?? t ?? null;
    next.activeStepIndex = index;
  });

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
        steps: freshSteps(0, event.t ?? state.lastT ?? null),
        download: null,
        loadStartedByPipeline: false,
        sourceStartedAt: event.t ?? state.lastT ?? null,
        lastT: event.t ?? state.lastT ?? null,
      };
    }
    case 'timing': {
      if (event.mark === 'pipeline:load:start') {
        return { ...activateStep(state, 'load', event.t), loadStartedByPipeline: true };
      }
      if (event.mark === 'model:load:start' && state.loadStartedByPipeline) {
        return { ...state, lastT: event.t ?? state.lastT };
      }
      const startStep = START_MARK_TO_STEP[event.mark];
      if (startStep) return activateStep(state, startStep, event.t);
      const endStep = END_MARK_TO_STEP[event.mark];
      if (endStep) return completeStep(state, endStep, event.t);
      return state;
    }
    case 'download-progress': {
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
      const progress = clampPercent(event.progress);
      next = cloneState(next);
      next.stepProgress = progress / 100;
      next.download = {
        file: event.file ?? '',
        progress,
      };
      next.lastT = event.t ?? next.lastT;
      return next;
    }
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

function completedCount(steps) {
  return steps.filter((step) => step.status === 'done').length;
}

function percentForState(state) {
  if (!state.visible) return 100;
  if (state.status === 'done' || state.status === 'error') return 100;
  const done = completedCount(state.steps);
  const inStep = state.steps[state.activeStepIndex]?.status === 'active'
    ? Math.max(0, Math.min(1, state.stepProgress ?? 0))
    : 0;
  return Math.round(((done + inStep) / PIPELINE_STEPS.length) * 100);
}

function etaSecondsForState(state) {
  if (!state.visible || state.status === 'done' || state.status === 'error') return null;
  const durations = state.steps
    .filter((step) => step.status === 'done' && step.durationMs != null)
    .map((step) => step.durationMs);
  if (durations.length === 0) return null;
  const avg = durations.reduce((sum, ms) => sum + ms, 0) / durations.length;
  const remaining = PIPELINE_STEPS.length - completedCount(state.steps);
  if (remaining <= 0) return null;
  return Math.max(1, Math.round((avg * remaining) / 1000));
}

function currentLabelForState(state) {
  const active = state.steps[state.activeStepIndex] ?? state.steps[0];
  if (active.id === 'load' && state.download) {
    const pct = Math.round(state.download.progress);
    const file = state.download.file ? ` ${state.download.file}` : '';
    return `Pobieranie modelu${file} · ${pct}%`;
  }
  return active.label;
}

export function getProgressView(state) {
  const activeStep = state.steps[state.activeStepIndex] ?? state.steps[0];
  return {
    visible: state.visible,
    fading: state.fading,
    status: state.status,
    percent: percentForState(state),
    etaSeconds: etaSecondsForState(state),
    currentLabel: currentLabelForState(state),
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
