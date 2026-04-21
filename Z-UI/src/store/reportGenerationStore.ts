export type ReportGenerationStatus = 'idle' | 'running' | 'completed' | 'failed';

export interface ReportGenerationState {
  status: ReportGenerationStatus;
  reportId: string | null;
  error: string | null;
  startedAt: number | null;
  completedAt: number | null;
  progressUiActive: boolean;
  completionState: 'idle' | 'pending';
}

type ReportGenerationListener = (state: ReportGenerationState) => void;

const STORAGE_KEY = 'investment_report_generation_state_v1';
const MAX_RUNNING_STATE_AGE_MS = 30 * 60 * 1000;
const MAX_COMPLETED_STATE_AGE_MS = 15 * 1000;
const MAX_FAILED_STATE_AGE_MS = 10 * 60 * 1000;

const DEFAULT_STATE: ReportGenerationState = {
  status: 'idle',
  reportId: null,
  error: null,
  startedAt: null,
  completedAt: null,
  progressUiActive: false,
  completionState: 'idle',
};

const listeners = new Set<ReportGenerationListener>();

function canUseSessionStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.sessionStorage !== 'undefined';
}

function sanitizeReportGenerationState(value: unknown): ReportGenerationState | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  const status = candidate.status;
  const completionState = candidate.completionState;

  if (
    status !== 'idle' &&
    status !== 'running' &&
    status !== 'completed' &&
    status !== 'failed'
  ) {
    return null;
  }

  if (completionState !== 'idle' && completionState !== 'pending') {
    return null;
  }

  const startedAt = Number(candidate.startedAt);
  const completedAt = Number(candidate.completedAt);

  return {
    status,
    reportId: typeof candidate.reportId === 'string' ? candidate.reportId : null,
    error: typeof candidate.error === 'string' ? candidate.error : null,
    startedAt: Number.isFinite(startedAt) ? startedAt : null,
    completedAt: Number.isFinite(completedAt) ? completedAt : null,
    progressUiActive: Boolean(candidate.progressUiActive),
    completionState,
  };
}

function getExpiredRunningState(previousState: ReportGenerationState, now: number): ReportGenerationState {
  return {
    status: 'failed',
    reportId: null,
    error: 'The previous report generation session expired. Please generate the report again.',
    startedAt: previousState.startedAt,
    completedAt: now,
    progressUiActive: false,
    completionState: 'idle',
  };
}

function normalizeReportGenerationState(
  state: ReportGenerationState,
  now = Date.now(),
): ReportGenerationState {
  if (state.status === 'running') {
    if (!state.startedAt) {
      return DEFAULT_STATE;
    }

    if ((now - state.startedAt) > MAX_RUNNING_STATE_AGE_MS) {
      return getExpiredRunningState(state, now);
    }

    if (
      state.completedAt === null &&
      state.progressUiActive &&
      state.completionState === 'idle'
    ) {
      return state;
    }

    return {
      ...state,
      completedAt: null,
      progressUiActive: true,
      completionState: 'idle',
    };
  }

  if (state.status === 'completed') {
    if (!state.completedAt || (now - state.completedAt) > MAX_COMPLETED_STATE_AGE_MS) {
      return DEFAULT_STATE;
    }

    if (
      state.error === null &&
      state.progressUiActive &&
      state.completionState === 'pending'
    ) {
      return state;
    }

    return {
      ...state,
      error: null,
      progressUiActive: true,
      completionState: 'pending',
    };
  }

  if (state.status === 'failed') {
    if (!state.completedAt || (now - state.completedAt) > MAX_FAILED_STATE_AGE_MS) {
      return DEFAULT_STATE;
    }

    if (
      state.progressUiActive === false &&
      state.completionState === 'idle'
    ) {
      return state;
    }

    return {
      ...state,
      progressUiActive: false,
      completionState: 'idle',
    };
  }

  return DEFAULT_STATE;
}

function loadInitialState(): ReportGenerationState {
  if (!canUseSessionStorage()) {
    return DEFAULT_STATE;
  }

  try {
    const saved = sessionStorage.getItem(STORAGE_KEY);
    if (!saved) {
      return DEFAULT_STATE;
    }

    const parsed = JSON.parse(saved);
    const sanitized = sanitizeReportGenerationState(parsed);
    if (!sanitized) {
      return DEFAULT_STATE;
    }

    return normalizeReportGenerationState(sanitized);
  } catch {
    return DEFAULT_STATE;
  }
}

let reportGenerationState: ReportGenerationState = loadInitialState();

function persistState(): void {
  if (!canUseSessionStorage()) {
    return;
  }

  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(reportGenerationState));
  } catch {
    // Ignore storage write failures so report generation can continue.
  }
}

persistState();

function emitState(): void {
  persistState();
  listeners.forEach((listener) => listener(reportGenerationState));
}

function setState(nextState: ReportGenerationState): void {
  reportGenerationState = nextState;
  emitState();
}

export function getReportGenerationState(): ReportGenerationState {
  const normalizedState = normalizeReportGenerationState(reportGenerationState);
  if (normalizedState !== reportGenerationState) {
    reportGenerationState = normalizedState;
    persistState();
  }
  return reportGenerationState;
}

export function subscribeToReportGeneration(listener: ReportGenerationListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function beginReportGeneration(): ReportGenerationState {
  if (reportGenerationState.status === 'running') {
    return reportGenerationState;
  }

  const nextState: ReportGenerationState = {
    status: 'running',
    reportId: null,
    error: null,
    startedAt: Date.now(),
    completedAt: null,
    progressUiActive: true,
    completionState: 'idle',
  };

  setState(nextState);
  return nextState;
}

export function completeReportGeneration(reportId: string): void {
  setState({
    status: 'completed',
    reportId,
    error: null,
    startedAt: reportGenerationState.startedAt,
    completedAt: Date.now(),
    progressUiActive: true,
    completionState: 'pending',
  });
}

export function failReportGeneration(error: string): void {
  setState({
    status: 'failed',
    reportId: null,
    error,
    startedAt: reportGenerationState.startedAt,
    completedAt: Date.now(),
    progressUiActive: false,
    completionState: 'idle',
  });
}

export function finalizeReportGenerationUi(): void {
  setState({
    status: 'idle',
    reportId: null,
    error: null,
    startedAt: null,
    completedAt: null,
    progressUiActive: false,
    completionState: 'idle',
  });
}
