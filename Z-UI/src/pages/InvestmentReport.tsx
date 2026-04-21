import { useEffect, useRef, useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { useLocation, useNavigate } from 'react-router';
import { TrendingUp, TrendingDown, ChevronDown, ChevronUp, MessageSquare, Eye, Trash2, Calendar, Zap, ArrowLeft, Download, Shield, BarChart3, AlertTriangle, Minus, Loader2 } from 'lucide-react';
import { Button } from '../components/ui/button';
import { InvestmentReportPrintView } from '../components/InvestmentReportPrintView';
import {
  generateInvestmentReport,
  INVESTMENT_REPORT_PHASE1_CONTRACT_VERSION,
  normalizeInvestmentReportPhase1Payload,
  type InvestmentReportPhase1Payload,
  type InvestmentReportSourceMarker,
} from '../services/api';
import {
  buildCanonicalInvestmentReportExport,
  buildReferencesMethodologySection,
  type CanonicalInvestmentReportExport,
} from '../services/investmentReportExport';
import {
  buildEfficientFrontierAnalysis,
  type EfficientFrontierAnalysis,
  type EfficientFrontierPortfolio,
} from '../services/efficientFrontier';
import { getUserId } from '../services/userStorage';
import {
  beginReportGeneration,
  completeReportGeneration,
  failReportGeneration,
  finalizeReportGenerationUi,
  getReportGenerationState,
  subscribeToReportGeneration,
  type ReportGenerationState,
} from '../store/reportGenerationStore';
import {
  PieChart,
  Pie,
  Cell,
  ComposedChart,
  LineChart,
  Line,
  Scatter,
  LabelList,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  BarChart,
  Bar,
} from 'recharts';
import { getResearchAssetDetailPath } from '../services/assetRouting';

interface Portfolio {
  id: string;
  name: string;
  budget: number;
  items: Array<{ ticker: string; name: string; amount: number }>;
  totalAllocated: number;
  createdAt: string;
  updatedAt: string;
}

interface GeneratedReport {
  id: string;
  portfolioId: string;
  portfolioName: string;
  timestamp: string;
  reportContractVersion: typeof INVESTMENT_REPORT_PHASE1_CONTRACT_VERSION;
  reportSource: Exclude<InvestmentReportSourceMarker, 'fallback_completed'>;
  reportDiagnostics?: string[];
  timeHorizon: string;
  riskPreference: string;
  strategyType: string;
  notes: string;
  phase1Payload?: InvestmentReportPhase1Payload;
}

interface ReportGenerationRequest {
  portfolio: Portfolio;
  portfolioId: string;
  portfolioName: string;
  timeHorizon: string;
  riskPreference: string;
  strategyType: string;
  notes: string;
  userId: string;
  generatedAt: string;
}

interface HighlightCard {
  score: string;
  explanation: string;
}

interface ResolvedPhase1Report {
  payload: InvestmentReportRenderPayload;
  reportSource: Exclude<InvestmentReportSourceMarker, 'fallback_completed'>;
  renderSource: InvestmentReportSourceMarker;
  diagnostics: string[];
}

interface InvestmentReportRenderPayload extends InvestmentReportPhase1Payload {
  metadata: {
    portfolio_name: string;
    generated_at: string;
    time_horizon: string;
    note: string;
  };
  references: InvestmentReportPhase1Payload['references'];
}

const FALLBACK_HIGHLIGHT_CARD: HighlightCard = {
  score: 'Unavailable',
  explanation: 'No explanation available.',
};

const ASSET_TYPE_COLORS: Record<'ETF' | 'Stock' | 'Crypto' | 'Option', string> = {
  Stock: '#3b82f6',
  ETF: '#f59e0b',
  Crypto: '#06b6d4',
  Option: '#8b5cf6',
};
const REPORT_SURFACES = {
  tooltip: { backgroundColor: 'rgba(30, 41, 59, 0.95)', borderColor: 'rgb(51, 65, 85)' },
  section: { backgroundColor: 'rgba(15, 23, 42, 0.4)', borderColor: 'rgb(30, 41, 59)' },
  sectionSoft: { backgroundColor: 'rgba(15, 23, 42, 0.3)', borderColor: 'rgb(30, 41, 59)' },
  sectionStrong: { backgroundColor: 'rgba(15, 23, 42, 0.6)', borderColor: 'rgb(30, 41, 59)' },
  sectionMid: { backgroundColor: 'rgba(15, 23, 42, 0.5)', borderColor: 'rgb(30, 41, 59)' },
  input: { backgroundColor: 'rgba(15, 23, 42, 0.9)', borderColor: 'rgb(51, 65, 85)' },
  rowIdle: { backgroundColor: 'rgba(30, 41, 59, 0.4)', borderColor: 'rgba(30, 41, 59, 0.6)' },
  rowSelected: { backgroundColor: 'rgba(30, 41, 59, 0.7)', borderColor: 'rgb(71, 85, 105)' },
  divider: { borderColor: 'rgba(30, 41, 59, 0.8)' },
} as const;
const REPORT_ACCENTS = {
  blue: {
    backgroundColor: 'rgba(59, 130, 246, 0.10)',
    borderColor: 'rgba(59, 130, 246, 0.30)',
    labelColor: '#60a5fa',
    scoreColor: '#bfdbfe',
  },
  emerald: {
    backgroundColor: 'rgba(16, 185, 129, 0.10)',
    borderColor: 'rgba(16, 185, 129, 0.30)',
    labelColor: '#34d399',
    scoreColor: '#a7f3d0',
  },
  purple: {
    backgroundColor: 'rgba(168, 85, 247, 0.10)',
    borderColor: 'rgba(168, 85, 247, 0.30)',
    labelColor: '#c084fc',
    scoreColor: '#ddd6fe',
  },
  amber: {
    backgroundColor: 'rgba(245, 158, 11, 0.10)',
    borderColor: 'rgba(245, 158, 11, 0.30)',
    labelColor: '#fbbf24',
    scoreColor: '#fde68a',
  },
  rose: {
    backgroundColor: 'rgba(244, 63, 94, 0.10)',
    borderColor: 'rgba(244, 63, 94, 0.30)',
    labelColor: '#fb7185',
    scoreColor: '#fecdd3',
  },
  red: {
    backgroundColor: 'rgba(239, 68, 68, 0.10)',
    borderColor: 'rgba(239, 68, 68, 0.30)',
    labelColor: '#f87171',
    scoreColor: '#fecaca',
  },
  violet: {
    backgroundColor: 'rgba(139, 92, 246, 0.10)',
    borderColor: 'rgba(139, 92, 246, 0.30)',
    labelColor: '#a78bfa',
    scoreColor: '#ddd6fe',
  },
  slate: {
    backgroundColor: 'rgba(100, 116, 139, 0.10)',
    borderColor: 'rgba(100, 116, 139, 0.30)',
    labelColor: '#94a3b8',
    scoreColor: '#cbd5e1',
  },
} as const;
const REPORT_GRADIENTS = {
  emerald: 'linear-gradient(135deg, rgba(16, 185, 129, 0.10), rgba(20, 184, 166, 0.10))',
  slate: 'linear-gradient(135deg, rgba(100, 116, 139, 0.10), rgba(71, 85, 105, 0.10))',
  red: 'linear-gradient(135deg, rgba(239, 68, 68, 0.10), rgba(244, 63, 94, 0.10))',
  rose: 'linear-gradient(135deg, rgba(244, 63, 94, 0.10), rgba(239, 68, 68, 0.10))',
  amber: 'linear-gradient(135deg, rgba(245, 158, 11, 0.10), rgba(249, 115, 22, 0.10))',
  violet: 'linear-gradient(135deg, rgba(139, 92, 246, 0.10), rgba(168, 85, 247, 0.10))',
} as const;
const CHAT_PORTFOLIO_CONTEXT_STORAGE_KEY = 'chatPortfolioContext';
const CHAT_AUTO_RUN_INTENT_STORAGE_KEY = 'chatPortfolioAutoRunIntent';
const FRONTIER_DOT_SIZE = Math.PI * (2 ** 2);
const FRONTIER_ACTIVE_DOT_SIZE = Math.PI * (3 ** 2);

function formatMetricPercent(value: number | null | undefined, digits = 1): string {
  if (!Number.isFinite(value)) {
    return '—';
  }

  return `${((value || 0) * 100).toFixed(digits)}%`;
}

function formatMetricSharpe(value: number | null | undefined): string {
  if (!Number.isFinite(value)) {
    return '—';
  }

  return (value || 0).toFixed(2);
}

function getNonZeroPortfolioWeights(
  weights: Record<string, number> | null | undefined,
): Array<{ ticker: string; weight: number }> {
  if (!weights) {
    return [];
  }

  return Object.entries(weights)
    .filter(([, weight]) => Number.isFinite(weight) && Math.abs(weight) > 1e-6)
    .sort((left, right) => right[1] - left[1])
    .map(([ticker, weight]) => ({ ticker, weight }));
}

function computeAxisDomain(
  values: Array<number | null | undefined>,
  options?: { paddingRatio?: number; minSpan?: number },
): [number, number] {
  const finiteValues = values.filter((value): value is number => Number.isFinite(value));
  if (!finiteValues.length) {
    return [0, 1];
  }

  const min = Math.min(...finiteValues);
  const max = Math.max(...finiteValues);
  const paddingRatio = options?.paddingRatio ?? 0.12;
  const minSpan = options?.minSpan ?? 0.02;
  const span = Math.max(max - min, minSpan);
  const padding = span * paddingRatio;
  return [min - padding, max + padding];
}

function buildFrontierGuideLine(
  frontier: Array<Pick<EfficientFrontierPortfolio, 'volatility' | 'expectedReturn'>>,
  currentPoint: Pick<EfficientFrontierPortfolio, 'volatility' | 'expectedReturn' | 'label'>,
) {
  if (!frontier.length) {
    return [];
  }

  const currentX = currentPoint.volatility;
  const currentY = currentPoint.expectedReturn;
  let closestPoint = { volatility: frontier[0].volatility, expectedReturn: frontier[0].expectedReturn };
  let closestDistance = Number.POSITIVE_INFINITY;

  const evaluateCandidate = (candidateX: number, candidateY: number) => {
    const distance = ((candidateX - currentX) ** 2) + ((candidateY - currentY) ** 2);
    if (distance < closestDistance) {
      closestDistance = distance;
      closestPoint = { volatility: candidateX, expectedReturn: candidateY };
    }
  };

  for (let index = 0; index < frontier.length; index += 1) {
    const start = frontier[index];
    evaluateCandidate(start.volatility, start.expectedReturn);

    const end = frontier[index + 1];
    if (!end) {
      continue;
    }

    const segmentX = end.volatility - start.volatility;
    const segmentY = end.expectedReturn - start.expectedReturn;
    const segmentLengthSquared = (segmentX ** 2) + (segmentY ** 2);
    if (segmentLengthSquared <= 0) {
      continue;
    }

    const projectionRatio = Math.max(
      0,
      Math.min(
        1,
        (((currentX - start.volatility) * segmentX) + ((currentY - start.expectedReturn) * segmentY)) / segmentLengthSquared,
      ),
    );

    evaluateCandidate(
      start.volatility + (segmentX * projectionRatio),
      start.expectedReturn + (segmentY * projectionRatio),
    );
  }

  return [
    { volatility: currentPoint.volatility, expectedReturn: currentPoint.expectedReturn, shortLabel: currentPoint.label },
    { volatility: closestPoint.volatility, expectedReturn: closestPoint.expectedReturn, shortLabel: 'Frontier' },
  ];
}

const EfficientFrontierTooltip = ({ active, payload }: any) => {
  if (!(active && payload && payload.length)) {
    return null;
  }

  const point = payload.find((entry: any) => entry?.payload)?.payload;
  if (!point) {
    return null;
  }

  const weightRows = getNonZeroPortfolioWeights(point.weights);

  return (
    <div className="border rounded-lg p-3 shadow-xl min-w-[180px]" style={REPORT_SURFACES.tooltip}>
      <div className="text-slate-100 text-sm font-semibold mb-2">{point.label || point.shortLabel || point.ticker}</div>
      <div className="space-y-1.5 text-xs">
        <div className="flex items-center justify-between gap-4">
          <span className="text-slate-400">Return</span>
          <span className="text-slate-100 font-medium">{formatMetricPercent(point.expectedReturn)}</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-slate-400">Volatility</span>
          <span className="text-slate-100 font-medium">{formatMetricPercent(point.volatility)}</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-slate-400">Sharpe</span>
          <span className="text-slate-100 font-medium">{formatMetricSharpe(point.sharpe)}</span>
        </div>
      </div>
      {weightRows.length ? (
        <div className="mt-3 pt-3 border-t border-slate-700/70 space-y-1.5 text-xs">
          <div className="text-slate-400 tracking-wide text-[11px] font-semibold">Portfolio Weights</div>
          {weightRows.map(({ ticker, weight }) => (
            <div key={`${point.label || point.shortLabel || point.ticker}-${ticker}`} className="text-slate-300">
              {ticker}: {formatMetricPercent(weight, 2)}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
};

const renderOptimizationLabel = ({ x, y, value, fill }: any) => {
  if (!value || !Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }

  return (
    <text
      x={x}
      y={y - 14}
      fill={fill || '#e2e8f0'}
      fontSize={11}
      fontWeight={600}
      textAnchor="middle"
    >
      {value}
    </text>
  );
};

const renderAssetLabel = ({ x, y, value }: any) => {
  if (!value || !Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }

  return (
    <text
      x={x}
      y={y - 10}
      fill="#cbd5e1"
      fontSize={10}
      fontWeight={500}
      textAnchor="middle"
    >
      {value}
    </text>
  );
};

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

const INVESTMENT_REPORT_PRINT_CSS = `
  @page {
    size: auto;
    margin: 0.55in;
  }

  * {
    box-sizing: border-box;
  }

  body {
    margin: 0;
    background: #ffffff;
    color: #0f172a;
    font-family: "Georgia", "Times New Roman", serif;
    line-height: 1.5;
  }

  .report-document {
    max-width: 960px;
    margin: 0 auto;
    padding: 24px 20px 40px;
  }

  .report-header {
    border-bottom: 2px solid #cbd5e1;
    padding-bottom: 20px;
  }

  .eyebrow {
    font: 700 12px/1.2 Arial, sans-serif;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: #475569;
    margin-bottom: 10px;
  }

  h1 {
    margin: 0 0 8px;
    font-size: 30px;
    line-height: 1.1;
    color: #0f172a;
  }

  .subtitle {
    margin: 0;
    font: 400 14px/1.5 Arial, sans-serif;
    color: #475569;
  }

  .meta-grid,
  .card-grid {
    display: grid;
    gap: 14px;
  }

  .meta-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    margin-top: 20px;
  }

  .frontier-meta-grid {
    margin-top: 0;
  }

  .frontier-stats-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    margin-top: 0;
    gap: 10px;
  }

  .two-col {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .three-col {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .section {
    margin-top: 26px;
  }

  .section-heading {
    margin-bottom: 12px;
    padding-bottom: 6px;
    border-bottom: 1px solid #cbd5e1;
    font: 700 18px/1.3 Arial, sans-serif;
    color: #0f172a;
  }

  .meta-label,
  .summary-label {
    margin-bottom: 6px;
    font: 700 11px/1.3 Arial, sans-serif;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #64748b;
  }

  .meta-value,
  .summary-value,
  .callout-value {
    font: 600 16px/1.4 Arial, sans-serif;
    color: #0f172a;
  }

  .callout,
  .summary-card {
    border: 1px solid #cbd5e1;
    border-radius: 10px;
    padding: 14px 16px;
    background: #ffffff;
  }

  .callout {
    margin-bottom: 14px;
  }

  .frontier-callout {
    margin-top: 14px;
  }

  .stacked-item + .stacked-item {
    margin-top: 14px;
    padding-top: 14px;
    border-top: 1px solid #e2e8f0;
  }

  .table-wrap {
    border: 1px solid #cbd5e1;
    border-radius: 10px;
    overflow: hidden;
  }

  table {
    width: 100%;
    border-collapse: collapse;
  }

  th,
  td {
    padding: 10px 12px;
    border-bottom: 1px solid #e2e8f0;
    text-align: left;
    vertical-align: top;
    font: 400 13px/1.4 Arial, sans-serif;
    color: #0f172a;
  }

  th {
    background: #f8fafc;
    font-weight: 700;
    color: #334155;
  }

  tbody tr:last-child td {
    border-bottom: none;
  }

  .body-text {
    margin: 0;
    font: 400 13px/1.6 Arial, sans-serif;
    color: #1e293b;
  }

  .body-text.compact {
    line-height: 1.5;
  }

  .print-list {
    margin: 10px 0 0;
    padding-left: 18px;
    font: 400 13px/1.55 Arial, sans-serif;
    color: #1e293b;
  }

  .print-list li + li {
    margin-top: 6px;
  }

  .scenario-grid {
    display: grid;
    gap: 10px;
    margin-top: 6px;
  }

  .scenario-card {
    border-top: 1px solid #e2e8f0;
    padding-top: 10px;
  }

  .scenario-card:first-child {
    border-top: none;
    padding-top: 0;
  }

  .scenario-label {
    margin-bottom: 4px;
    font: 700 13px/1.4 Arial, sans-serif;
    color: #0f172a;
  }

  .avoid-break {
    break-inside: avoid;
    page-break-inside: avoid;
  }

  @media print {
    .section {
      break-inside: avoid;
      page-break-inside: avoid;
    }

    .table-wrap,
    table,
    thead,
    tbody,
    tr,
    td,
    th {
      page-break-inside: avoid;
    }
  }
`;
const CRYPTO_TICKERS = new Set(['BTC', 'ETH', 'SOL', 'DOGE', 'XRP', 'ADA', 'BNB', 'AVAX']);
const ETF_TICKERS = new Set(['SPY', 'QQQ', 'VTI', 'VOO', 'IWM', 'DIA', 'ARKK']);
const OPTION_CONTRACT_PATTERN = /^([A-Z]{1,6})\d{6}[CP]\d{8}$/;

const HIGHLIGHT_CARD_META = [
  { key: 'theme_exposure', label: 'Theme Exposure', cardStyle: REPORT_ACCENTS.blue },
  { key: 'diversification', label: 'Diversification', cardStyle: REPORT_ACCENTS.emerald },
  { key: 'concentration', label: 'Concentration', cardStyle: REPORT_ACCENTS.amber },
  { key: 'volatility_profile', label: 'Volatility Profile', cardStyle: REPORT_ACCENTS.violet },
] as const;

function normalizeHighlightCard(card?: Partial<HighlightCard> | null): HighlightCard {
  return {
    score: card?.score?.trim() || FALLBACK_HIGHLIGHT_CARD.score,
    explanation: card?.explanation?.trim() || FALLBACK_HIGHLIGHT_CARD.explanation,
  };
}

function normalizePoints(points?: string[] | null, fallback = 'No content available.'): string[] {
  if (!Array.isArray(points)) return [fallback];

  const normalized = points
    .map((point) => (typeof point === 'string' ? point.trim() : ''))
    .filter(Boolean);

  return normalized.length > 0 ? normalized : [fallback];
}

function hasText(value?: string | null): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasNonEmptyPoints(points?: string[] | null): boolean {
  return Array.isArray(points) && points.some((point) => typeof point === 'string' && point.trim().length > 0);
}

function sanitizeGeneratedReport(raw: unknown): GeneratedReport | null {
  if (!raw || typeof raw !== 'object') return null;

  const candidate = raw as Record<string, unknown>;
  if (
    typeof candidate.id !== 'string' ||
    typeof candidate.portfolioId !== 'string' ||
    typeof candidate.portfolioName !== 'string' ||
    typeof candidate.timestamp !== 'string' ||
    typeof candidate.timeHorizon !== 'string' ||
    typeof candidate.riskPreference !== 'string' ||
    typeof candidate.strategyType !== 'string' ||
    typeof candidate.notes !== 'string'
  ) {
    return null;
  }

  return {
    id: candidate.id,
    portfolioId: candidate.portfolioId,
    portfolioName: candidate.portfolioName,
    timestamp: candidate.timestamp,
    reportContractVersion: INVESTMENT_REPORT_PHASE1_CONTRACT_VERSION,
    reportSource: 'live_phase1',
    reportDiagnostics: Array.isArray(candidate.reportDiagnostics)
      ? candidate.reportDiagnostics.filter((value): value is string => typeof value === 'string')
      : undefined,
    timeHorizon: candidate.timeHorizon,
    riskPreference: candidate.riskPreference,
    strategyType: candidate.strategyType,
    notes: candidate.notes,
    phase1Payload: normalizeInvestmentReportPhase1Payload(candidate.phase1Payload),
  };
}

function loadPersistedReports(): GeneratedReport[] {
  const saved = localStorage.getItem('investmentReports');
  if (!saved) return [];

  try {
    const parsed = JSON.parse(saved);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .map((report) => sanitizeGeneratedReport(report))
      .filter((report): report is GeneratedReport => report !== null);
  } catch {
    return [];
  }
}

function persistReportsToStorage(reports: GeneratedReport[]): GeneratedReport[] {
  localStorage.setItem('investmentReports', JSON.stringify(reports));
  return reports;
}

function createGeneratedReportFromRequest(
  request: ReportGenerationRequest,
  payload: InvestmentReportPhase1Payload,
  options?: {
    sourceLabel?: string;
    reportSource?: Exclude<InvestmentReportSourceMarker, 'fallback_completed'>;
    reportDiagnostics?: string[];
  }
): GeneratedReport {
  return {
    id: Date.now().toString(),
    portfolioId: request.portfolioId,
    portfolioName: request.portfolioName,
    timestamp: new Date().toISOString(),
    reportContractVersion: INVESTMENT_REPORT_PHASE1_CONTRACT_VERSION,
    reportSource: options?.reportSource || 'live_phase1',
    reportDiagnostics: options?.reportDiagnostics || [],
    timeHorizon: request.timeHorizon,
    riskPreference: request.riskPreference,
    strategyType: request.strategyType,
    notes: request.notes || (options?.sourceLabel ? options.sourceLabel : 'AI generated report payload'),
    phase1Payload: payload,
  };
}

function appendPersistedReport(report: GeneratedReport): GeneratedReport[] {
  const updated = [report, ...loadPersistedReports()];
  return persistReportsToStorage(updated);
}

async function startReportGeneration(
  request: ReportGenerationRequest,
  options?: {
    sourceLabel?: string;
    reportSource?: Exclude<InvestmentReportSourceMarker, 'fallback_completed'>;
    reportDiagnostics?: string[];
  }
): Promise<void> {
  if (getReportGenerationState().status === 'running') {
    return;
  }

  beginReportGeneration();

  try {
    const payload = await generateInvestmentReport(request.portfolio, {
      userId: request.userId,
      generatedAt: request.generatedAt,
      timeHorizon: request.timeHorizon,
      note: request.notes,
      riskPreference: request.riskPreference,
    });

    const report = createGeneratedReportFromRequest(request, payload, options);
    appendPersistedReport(report);

    console.info('[InvestmentReport] Saved report payload', {
      reportId: report.id,
      reportSource: report.reportSource,
      diagnostics: options?.reportDiagnostics || [],
    });

    completeReportGeneration(report.id);
  } catch (error) {
    console.error('Failed to generate report:', error);
    failReportGeneration(
      error instanceof Error
        ? error.message
        : 'Unable to generate report. Please ensure the LangGraph server is running.',
    );
  }
}

function collectPhase1FallbackDiagnostics(payload: InvestmentReportPhase1Payload): string[] {
  const diagnostics: string[] = [];

  if (
    !hasText(payload.portfolio_highlights?.theme_exposure?.score) ||
    !hasText(payload.portfolio_highlights?.theme_exposure?.explanation) ||
    !hasText(payload.portfolio_highlights?.diversification?.score) ||
    !hasText(payload.portfolio_highlights?.diversification?.explanation) ||
    !hasText(payload.portfolio_highlights?.concentration?.score) ||
    !hasText(payload.portfolio_highlights?.concentration?.explanation) ||
    !hasText(payload.portfolio_highlights?.volatility_profile?.score) ||
    !hasText(payload.portfolio_highlights?.volatility_profile?.explanation)
  ) {
    diagnostics.push('portfolio_highlights');
  }

  if (
    !hasText(payload.ai_committee_summary?.recommendation?.value) ||
    !hasText(payload.ai_committee_summary?.recommendation?.explanation) ||
    !hasText(payload.ai_committee_summary?.position_size?.value) ||
    !hasText(payload.ai_committee_summary?.position_size?.explanation) ||
    !hasText(payload.ai_committee_summary?.risk_level?.value) ||
    !hasText(payload.ai_committee_summary?.risk_level?.explanation) ||
    !hasText(payload.ai_committee_summary?.conviction?.value) ||
    !hasText(payload.ai_committee_summary?.conviction?.explanation) ||
    !hasText(payload.ai_committee_summary?.thesis?.title) ||
    !hasText(payload.ai_committee_summary?.thesis?.body) ||
    !hasNonEmptyPoints(payload.ai_committee_summary?.summary_points)
  ) {
    diagnostics.push('ai_committee_summary');
  }

  if (
    !hasNonEmptyPoints(payload.research_agent?.key_insight) ||
    !hasNonEmptyPoints(payload.research_agent?.key_drivers) ||
    !hasText(payload.research_agent?.implications)
  ) {
    diagnostics.push('research_agent');
  }

  if (
    !hasNonEmptyPoints(payload.quant_agent?.metrics) ||
    !hasNonEmptyPoints(payload.quant_agent?.indicators) ||
    !hasText(payload.quant_agent?.correlation?.summary) ||
    !hasText(payload.quant_agent?.correlation?.interpretation) ||
    !hasText(payload.quant_agent?.concentration?.conclusion)
  ) {
    diagnostics.push('quant_agent');
  }

  if (
    !hasNonEmptyPoints(payload.risk_agent?.structural_risks) ||
    !hasNonEmptyPoints(payload.risk_agent?.risk_metrics) ||
    !Array.isArray(payload.risk_agent?.scenario_analysis) ||
    payload.risk_agent.scenario_analysis.length === 0 ||
    payload.risk_agent.scenario_analysis.some((scenario) => !hasText(scenario.label) || !hasText(scenario.description)) ||
    !hasNonEmptyPoints(payload.risk_agent?.guardrails)
  ) {
    diagnostics.push('risk_agent');
  }

  if (
    !hasText(payload.references?.market_data) ||
    !hasText(payload.references?.model_assumptions)
  ) {
    diagnostics.push('references');
  }

  return diagnostics;
}

function resolvePhase1Payload(report?: GeneratedReport): ResolvedPhase1Report {
  const payload = report?.phase1Payload;
  const persistedSource = report?.reportSource || 'live_phase1';

  if (payload) {
    const diagnostics = [
      ...(report?.reportDiagnostics || []),
      ...collectPhase1FallbackDiagnostics(payload),
    ];
    const uniqueDiagnostics = Array.from(new Set(diagnostics));

    return {
      reportSource: persistedSource,
      renderSource: uniqueDiagnostics.length > 0 ? 'fallback_completed' : persistedSource,
      diagnostics: uniqueDiagnostics,
      payload: {
        metadata: {
          portfolio_name: report?.portfolioName || '',
          generated_at: report?.timestamp || '',
          time_horizon: report?.timeHorizon || '',
          note: report?.notes || '',
        },
        portfolio_highlights: {
          theme_exposure: normalizeHighlightCard(payload.portfolio_highlights?.theme_exposure),
          diversification: normalizeHighlightCard(payload.portfolio_highlights?.diversification),
          concentration: normalizeHighlightCard(payload.portfolio_highlights?.concentration),
          volatility_profile: normalizeHighlightCard(payload.portfolio_highlights?.volatility_profile),
        },
        ai_committee_summary: {
          recommendation: {
            value: payload.ai_committee_summary?.recommendation?.value?.trim() || 'Buy',
            explanation: payload.ai_committee_summary?.recommendation?.explanation?.trim() || 'Current recommendation favors upside participation while maintaining measured sizing against concentration risk.',
          },
          position_size: {
            value: payload.ai_committee_summary?.position_size?.value?.trim() || 'Medium',
            explanation: payload.ai_committee_summary?.position_size?.explanation?.trim() || 'Medium sizing reflects a favorable setup, but not one strong enough to justify concentrated exposure.',
          },
          risk_level: {
            value: payload.ai_committee_summary?.risk_level?.value?.trim() || 'Balanced',
            explanation: payload.ai_committee_summary?.risk_level?.explanation?.trim() || 'Balanced risk reflects favorable upside potential, offset by meaningful concentration and downside sensitivity.',
          },
          conviction: {
            value: payload.ai_committee_summary?.conviction?.value?.trim() || 'High',
            explanation: payload.ai_committee_summary?.conviction?.explanation?.trim() || 'High conviction reflects strong thematic alignment and supportive upside drivers, though not enough to ignore concentration risk.',
          },
          thesis: {
            title: payload.ai_committee_summary?.thesis?.title?.trim() || 'AI Committee Thesis',
            body: payload.ai_committee_summary?.thesis?.body?.trim() || 'The portfolio expresses a concentrated bet on AI infrastructure leaders and high-growth technology equities. Upside potential remains strong if AI capex momentum continues, but the structure carries meaningful concentration risk and sensitivity to macro rotations or leadership changes.',
          },
          summary_points: normalizePoints(payload.ai_committee_summary?.summary_points),
        },
        research_agent: {
          key_insight: normalizePoints(payload.research_agent?.key_insight, 'No research insight available.'),
          key_drivers: normalizePoints(payload.research_agent?.key_drivers, 'No research drivers available.'),
          implications: payload.research_agent?.implications?.trim() || 'Continued sector leadership is possible if AI capex momentum persists, though valuation sensitivity remains high.',
        },
        quant_agent: {
          metrics: normalizePoints(payload.quant_agent?.metrics, 'No quant metrics available.'),
          indicators: normalizePoints(payload.quant_agent?.indicators, 'No quant indicators available.'),
          correlation: {
            summary: payload.quant_agent?.correlation?.summary?.trim() || 'Average holding correlation: 0.57',
            interpretation: payload.quant_agent?.correlation?.interpretation?.trim() || 'Moderate correlation suggests the portfolio may behave as a single thematic exposure during market stress.',
          },
          concentration: {
            conclusion: payload.quant_agent?.concentration?.conclusion?.trim() || 'Overall, the portfolio has meaningful single-bucket dependence, so upside can be strong if core leaders work, but downside will also be more sensitive to a narrow set of holdings.',
          },
        },
        risk_agent: {
          structural_risks: normalizePoints(payload.risk_agent?.structural_risks, 'No structural risks available.'),
          risk_metrics: normalizePoints(payload.risk_agent?.risk_metrics, 'No risk metrics available.'),
          scenario_analysis: Array.isArray(payload.risk_agent?.scenario_analysis) && payload.risk_agent.scenario_analysis.length > 0
            ? payload.risk_agent.scenario_analysis
            : [
                { label: 'Bull Case', description: 'High-upside scenario driven by continued AI leadership and strong earnings momentum.' },
                { label: 'Base Case', description: 'Moderate returns with growth leadership maintained but valuation expansion limited.' },
                { label: 'Bear Case', description: 'Downside scenario driven by macro tightening, growth rotation, or valuation compression.' },
              ],
          guardrails: normalizePoints(payload.risk_agent?.guardrails, 'No guardrails available.'),
        },
        references: {
          market_data: payload.references?.market_data?.trim() || 'Portfolio composition and asset allocations as of report generation.',
          model_assumptions: payload.references?.model_assumptions?.trim() || 'Factor exposure analysis, volatility framing, concentration diagnostics, and scenario descriptions are based on the current portfolio structure.',
        },
      },
    };
  }

  const diagnostics = Array.from(new Set([...(report?.reportDiagnostics || []), 'missing phase1 payload']));

  return {
    reportSource: 'live_phase1',
    renderSource: 'fallback_completed',
    diagnostics,
    payload: {
      metadata: {
        portfolio_name: report?.portfolioName || '',
        generated_at: report?.timestamp || '',
        time_horizon: report?.timeHorizon || '',
        note: report?.notes || '',
      },
      portfolio_highlights: {
        theme_exposure: FALLBACK_HIGHLIGHT_CARD,
        diversification: FALLBACK_HIGHLIGHT_CARD,
        concentration: FALLBACK_HIGHLIGHT_CARD,
        volatility_profile: FALLBACK_HIGHLIGHT_CARD,
      },
      ai_committee_summary: {
        recommendation: {
          value: 'Hold',
          explanation: 'No Phase 1 payload is available for this saved report.',
        },
        position_size: {
          value: 'Medium',
          explanation: 'Sizing guidance is unavailable because the saved Phase 1 payload is missing.',
        },
        risk_level: {
          value: report?.riskPreference || 'Balanced',
          explanation: 'Risk framing is limited because the saved Phase 1 payload is missing.',
        },
        conviction: {
          value: 'Low',
          explanation: 'Conviction is unavailable because the saved Phase 1 payload is missing.',
        },
        thesis: {
          title: 'Report payload unavailable',
          body: 'This saved report does not include a Phase 1 payload, so only minimal fallback content can be shown.',
        },
        summary_points: ['Generate a new live report to view the full Phase 1 analysis.'],
      },
      research_agent: {
        key_insight: ['No research insight available.'],
        key_drivers: ['No research drivers available.'],
        implications: 'Generate a new live report to restore the complete research section.',
      },
      quant_agent: {
        metrics: ['No quant metrics available.'],
        indicators: ['No quant indicators available.'],
        correlation: {
          summary: 'No correlation summary available.',
          interpretation: 'Generate a new live report to restore the complete quant section.',
        },
        concentration: {
          conclusion: 'No concentration conclusion available.',
        },
      },
      risk_agent: {
        structural_risks: ['No structural risks available.'],
        risk_metrics: ['No risk metrics available.'],
        scenario_analysis: [
          { label: 'Bull Case', description: 'Generate a new live report to restore scenario analysis.' },
          { label: 'Base Case', description: 'Generate a new live report to restore scenario analysis.' },
          { label: 'Bear Case', description: 'Generate a new live report to restore scenario analysis.' },
        ],
        guardrails: ['Generate a new live report to restore portfolio guardrails.'],
      },
      references: {
        market_data: 'Portfolio composition and asset allocations as of report generation.',
        model_assumptions: 'Fallback content shown because the saved Phase 1 payload is missing.',
      },
    },
  };
}

function getOptionUnderlyingTicker(ticker: string): string | null {
  const match = ticker.toUpperCase().match(OPTION_CONTRACT_PATTERN);
  return match?.[1] || null;
}

function classifyAssetType(ticker: string, name: string): 'ETF' | 'Stock' | 'Crypto' | 'Option' {
  const upperTicker = ticker.toUpperCase();
  const lowerName = name.toLowerCase();

  if (OPTION_CONTRACT_PATTERN.test(upperTicker)) {
    return 'Option';
  }

  if (CRYPTO_TICKERS.has(upperTicker) || lowerName.includes('bitcoin') || lowerName.includes('crypto')) {
    return 'Crypto';
  }

  if (
    ETF_TICKERS.has(upperTicker) ||
    lowerName.includes('etf') ||
    lowerName.includes('trust') ||
    lowerName.includes('fund')
  ) {
    return 'ETF';
  }

  return 'Stock';
}

/**
 * Time-shaped progress curve for report generation.
 *
 *   Phase 1   0–12s   →  0%  to 22%   (ease-out quad: faster initial responsiveness)
 *   Phase 2  12–45s   → 22%  to 52%   (linear: constant 0.91%/s, steady middle movement)
 *   Phase 3  45–95s   → 52%  to 84%   (cubic Hermite: velocity-continuous from phase 2, gentle end)
 *   Phase 4  95s+     → 84%  to 97.5% (exponential asymptote, τ=55s, never reaches 100)
 *
 * Returns a value in [0, 97.5]. Reaching 100 is only triggered by real completion.
 *
 * Phase 3 uses a cubic Hermite spline with tangents m0=0.76, m1=0.22:
 * Entry tangent matches phase 2's normalized rate (30/33 * 50/32 ≈ 0.76) — smooth join.
 * Exit tangent 0.22 keeps visible motion near 84% without a hard stall.
 */
function reportProgressCurve(elapsedMs: number): number {
  const t = elapsedMs / 1000;
  if (t <= 0) return 0;

  // Phase 1: 0–12s → 0% to 22% (ease-out quadratic: snappy initial ramp)
  if (t < 12) {
    const u = t / 12;
    return 22 * (1 - (1 - u) * (1 - u));
  }

  // Phase 2: 12–45s → 22% to 52% (linear — constant 0.91%/s, no slow patches)
  if (t < 45) {
    const u = (t - 12) / 33;
    return 22 + 30 * u;
  }

  // Phase 3: 45–95s → 52% to 84%
  // Cubic Hermite, m0=0.76, m1=0.22.
  // m0 matches phase 2's normalized exit rate (30/33 * 50/32 ≈ 0.76) — no velocity jump at join.
  // m1=0.22 leaves the bar with gentle non-zero motion as it approaches 84%.
  if (t < 95) {
    const u = (t - 45) / 50;
    const m0 = 0.76, m1 = 0.22;
    const eased = (m0 + m1 - 2) * u * u * u + (3 - 2 * m0 - m1) * u * u + m0 * u;
    return 52 + 32 * eased;
  }

  // Phase 4: 95s+ → exponential asymptote toward 97.5%, τ = 55s.
  // Initial rate (13.5/55 ≈ 0.25%/s) is close to phase 3's exit (0.22 * 32/50 = 0.14%/s).
  // Conservative ceiling ensures the bar never looks "almost done" prematurely.
  const driftElapsed = t - 95;
  return 84 + 13.5 * (1 - Math.exp(-driftElapsed / 55));
}

export function InvestmentReport() {
  const navigate = useNavigate();
  const location = useLocation();
  const [portfolios, setPortfolios] = useState<Portfolio[]>(() => {
    const saved = localStorage.getItem('userPortfolios');
    return saved ? JSON.parse(saved) : [];
  });
  const [previousReports, setPreviousReports] = useState<GeneratedReport[]>(() => loadPersistedReports());

  const [viewMode, setViewMode] = useState<'new' | 'review' | 'detail'>('new');
  const [selectedPortfolioId, setSelectedPortfolioId] = useState('');
  const [notes, setNotes] = useState('');
  const [timeHorizon, setTimeHorizon] = useState('90 Days');
  const [riskPreference, setRiskPreference] = useState('Balanced');
  const [strategyType, setStrategyType] = useState('Growth');
  const [showReferences, setShowReferences] = useState(false);
  const [hoveredAssetType, setHoveredAssetType] = useState<string | null>(null);
  const [selectedHoldingTicker, setSelectedHoldingTicker] = useState<string | null>(null);
  const [hoveredHoldingTicker, setHoveredHoldingTicker] = useState<string | null>(null);
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [holdingsSort, setHoldingsSort] = useState<'name' | 'type' | 'allocation'>('allocation');
  const [expandedDiagnostic, setExpandedDiagnostic] = useState<string | null>(null);
  const [hoveredDiagnostic, setHoveredDiagnostic] = useState<string | null>(null);
  const [expandedCommitteeMetric, setExpandedCommitteeMetric] = useState<string | null>(null);
  const [hoveredCommitteeMetric, setHoveredCommitteeMetric] = useState<string | null>(null);
  const [hoveredConcentrationSegment, setHoveredConcentrationSegment] = useState<'top3' | 'remaining' | null>(null);
  const [localGenerationError, setLocalGenerationError] = useState<string | null>(null);
  const [generationState, setGenerationState] = useState<ReportGenerationState>(() => getReportGenerationState());
  const [generationProgress, setGenerationProgress] = useState(() => {
    const initialState = getReportGenerationState();
    if (initialState.startedAt && (initialState.status === 'running' || initialState.completionState === 'pending')) {
      return reportProgressCurve(Date.now() - initialState.startedAt);
    }
    return 0;
  });
  const progressRafRef = useRef<number | null>(null);
  const completionRafRef = useRef<number | null>(null);
  const resetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [efficientFrontierAnalysis, setEfficientFrontierAnalysis] = useState<EfficientFrontierAnalysis | null>(null);
  const [efficientFrontierLoading, setEfficientFrontierLoading] = useState(false);
  const [efficientFrontierError, setEfficientFrontierError] = useState<string | null>(null);
  const [expandedSummaryCard, setExpandedSummaryCard] = useState<string | null>(null);
  const [hoveredSummaryCard, setHoveredSummaryCard] = useState<string | null>(null);
  const [hoveredFrontierIndex, setHoveredFrontierIndex] = useState<number | null>(null);
  const [hoveredFrontierPoint, setHoveredFrontierPoint] = useState<any | null>(null);
  const loggedObservabilityRef = useRef<Set<string>>(new Set());

  const selectedPortfolio = portfolios.find((p) => p.id === selectedPortfolioId);
  const selectedReport = previousReports.find((r) => r.id === selectedReportId);
  const reportPortfolio = selectedReport ? portfolios.find((p) => p.id === selectedReport.portfolioId) : null;
  const requestedPortfolioId = location.state && typeof location.state === 'object'
    ? (location.state as { selectedPortfolioId?: string }).selectedPortfolioId
    : undefined;
  const requestedReportId = location.state && typeof location.state === 'object'
    ? (location.state as { selectedReportId?: string }).selectedReportId
    : undefined;
  const requestedOpenMode = location.state && typeof location.state === 'object'
    ? (location.state as { openMode?: 'detail' }).openMode
    : undefined;
  const isGenerating = generationState.status === 'running';
  const isProgressActive = generationState.progressUiActive;
  const generationError = localGenerationError || (
    generationState.status === 'failed'
      ? (generationState.error || 'Unable to generate report. Please ensure the LangGraph server is running.')
      : null
  );

  useEffect(() => {
    if (!requestedPortfolioId) return;
    if (!portfolios.some((portfolio) => portfolio.id === requestedPortfolioId)) return;

    setViewMode('new');
    setSelectedReportId(null);
    setSelectedPortfolioId(requestedPortfolioId);
  }, [portfolios, requestedPortfolioId]);

  useEffect(() => {
    if (!requestedReportId || requestedOpenMode !== 'detail') return;
    if (!previousReports.some((report) => report.id === requestedReportId)) return;

    setSelectedReportId(requestedReportId);
    setViewMode('detail');
  }, [previousReports, requestedOpenMode, requestedReportId]);

  useEffect(() => {
    const sanitizedReports = loadPersistedReports();
    if (JSON.stringify(sanitizedReports) !== JSON.stringify(previousReports)) {
      persistReports(sanitizedReports);
    }
  }, []);

  useEffect(() => {
    const syncGenerationState = (state: ReportGenerationState, options?: { allowAutoOpen?: boolean }) => {
      setGenerationState(state);

      if (state.status === 'running') {
        setLocalGenerationError(null);
        return;
      }

      if (state.status === 'failed') {
        return;
      }

      if (state.status === 'completed') {
        const sanitizedReports = loadPersistedReports();
        persistReports(sanitizedReports);
        setLocalGenerationError(null);

        if (
          options?.allowAutoOpen &&
          state.reportId &&
          sanitizedReports.some((report) => report.id === state.reportId)
        ) {
          setSelectedReportId(state.reportId);
          setViewMode('detail');
        }
      }
    };

    syncGenerationState(getReportGenerationState(), { allowAutoOpen: false });
    return subscribeToReportGeneration((state) => syncGenerationState(state, { allowAutoOpen: true }));
  }, []);

  useEffect(() => {
    if (progressRafRef.current !== null) {
      cancelAnimationFrame(progressRafRef.current);
      progressRafRef.current = null;
    }
    if (completionRafRef.current !== null) {
      cancelAnimationFrame(completionRafRef.current);
      completionRafRef.current = null;
    }
    if (resetTimeoutRef.current !== null) {
      clearTimeout(resetTimeoutRef.current);
      resetTimeoutRef.current = null;
    }

    if (
      generationState.status === 'running' &&
      generationState.progressUiActive &&
      generationState.startedAt
    ) {
      const tick = () => {
        setGenerationProgress(reportProgressCurve(Date.now() - generationState.startedAt!));
        progressRafRef.current = requestAnimationFrame(tick);
      };

      setGenerationProgress(reportProgressCurve(Date.now() - generationState.startedAt));
      progressRafRef.current = requestAnimationFrame(tick);

      return () => {
        if (progressRafRef.current !== null) {
          cancelAnimationFrame(progressRafRef.current);
          progressRafRef.current = null;
        }
      };
    }

    if (generationState.status === 'failed') {
      setGenerationProgress(0);
      return;
    }

    if (
      generationState.status === 'completed' &&
      generationState.progressUiActive &&
      generationState.completionState === 'pending'
    ) {
      const fromProgress = Math.min(
        generationState.startedAt
          ? reportProgressCurve(Date.now() - generationState.startedAt)
          : 97.5,
        99.6,
      );
      const COMPLETION_MS = 320;
      const completionStart = performance.now();

      setGenerationProgress(fromProgress);

      const animateCompletion = (now: number) => {
        const u = Math.min((now - completionStart) / COMPLETION_MS, 1);
        const eased = 1 - Math.pow(1 - u, 3);
        setGenerationProgress(fromProgress + (100 - fromProgress) * eased);

        if (u < 1) {
          completionRafRef.current = requestAnimationFrame(animateCompletion);
        } else {
          completionRafRef.current = null;
          resetTimeoutRef.current = setTimeout(() => {
            setGenerationProgress(0);
            finalizeReportGenerationUi();
            resetTimeoutRef.current = null;
          }, 150);
        }
      };

      completionRafRef.current = requestAnimationFrame(animateCompletion);
    } else if (!generationState.progressUiActive) {
      setGenerationProgress(0);
    }

    return () => {
      if (completionRafRef.current !== null) {
        cancelAnimationFrame(completionRafRef.current);
        completionRafRef.current = null;
      }
      if (resetTimeoutRef.current !== null) {
        clearTimeout(resetTimeoutRef.current);
        resetTimeoutRef.current = null;
      }
    };
  }, [
    generationState.completionState,
    generationState.progressUiActive,
    generationState.startedAt,
    generationState.status,
  ]);

  // Sample chart data
  const chartData = [
    { time: 'Jan', price: 128.5 },
    { time: 'Jan 15', price: 132.2 },
    { time: 'Feb', price: 129.8 },
    { time: 'Feb 15', price: 135.1 },
    { time: 'Mar', price: 138.4 },
    { time: 'Mar 15', price: 136.8 },
    { time: 'Today', price: 140.25 },
  ];

  const persistReports = (reports: GeneratedReport[]) => {
    setPreviousReports(reports);
    localStorage.setItem('investmentReports', JSON.stringify(reports));
  };

  const handleGenerateReport = async () => {
    if (!selectedPortfolio || isGenerating) {
      if (!selectedPortfolio) {
        setLocalGenerationError('Select a portfolio before generating a report.');
      }
      return;
    }

    setLocalGenerationError(null);

    await startReportGeneration(
      {
        portfolio: selectedPortfolio,
        portfolioId: selectedPortfolio.id,
        portfolioName: selectedPortfolio.name,
        timeHorizon,
        riskPreference,
        strategyType,
        notes,
        userId: getUserId(),
        generatedAt: new Date().toISOString(),
      },
      {
        sourceLabel: 'AI generated via report_supervisor',
        reportSource: 'live_phase1',
      }
    );
  };

  useEffect(() => {
    if (!selectedReport) return;

    const resolved = resolvePhase1Payload(selectedReport);
    const logKey = `${selectedReport.id}:${resolved.renderSource}:${resolved.diagnostics.join('|')}`;

    if (loggedObservabilityRef.current.has(logKey)) {
      return;
    }

    loggedObservabilityRef.current.add(logKey);

    console.info('[InvestmentReport] Render source resolved', {
      reportId: selectedReport.id,
      reportSource: resolved.reportSource,
      renderSource: resolved.renderSource,
      diagnostics: resolved.diagnostics,
      contractVersion: selectedReport.reportContractVersion,
    });

    if (resolved.renderSource === 'fallback_completed') {
      console.warn('[InvestmentReport] Phase 1 payload required frontend fallback completion.', {
        reportId: selectedReport.id,
        diagnostics: resolved.diagnostics,
      });
    }
  }, [selectedReport]);

  useEffect(() => {
    if (viewMode !== 'detail' || !reportPortfolio) {
      setEfficientFrontierAnalysis(null);
      setEfficientFrontierLoading(false);
      setEfficientFrontierError(null);
      return;
    }

    let cancelled = false;

    setEfficientFrontierLoading(true);
    setEfficientFrontierError(null);
    setEfficientFrontierAnalysis(null);

    (async () => {
      try {
        const analysis = await buildEfficientFrontierAnalysis(reportPortfolio.items);
        if (cancelled) {
          return;
        }

        if (!analysis) {
          setEfficientFrontierAnalysis(null);
          setEfficientFrontierError('Not enough overlapping historical data to build a stable efficient frontier for this portfolio.');
          return;
        }

        setEfficientFrontierAnalysis(analysis);
        setEfficientFrontierError(null);
      } catch (error) {
        console.error('Unable to compute efficient frontier analysis:', error);
        if (!cancelled) {
          setEfficientFrontierAnalysis(null);
          setEfficientFrontierError('Unable to compute the efficient frontier with the available price history.');
        }
      } finally {
        if (!cancelled) {
          setEfficientFrontierLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [reportPortfolio, viewMode]);

  const handleDeleteReport = (reportId: string) => {
    const confirmed = window.confirm('Are you sure you want to delete this report? This action cannot be undone.');
    if (!confirmed) return;
    
    const updated = previousReports.filter((r) => r.id !== reportId);
    persistReports(updated);
    if (selectedReportId === reportId) {
      setViewMode('review');
      setSelectedReportId(null);
    }
  };

  const handleViewReport = (reportId: string) => {
    setSelectedReportId(reportId);
    setViewMode('detail');
  };

  const handleBackToReview = () => {
    setSelectedReportId(null);
    setViewMode('review');
  };

  const buildCanonicalExportReport = (
    report: GeneratedReport,
    portfolio: Portfolio
  ): CanonicalInvestmentReportExport | null => {
    if (!report.phase1Payload) return null;

    return buildCanonicalInvestmentReportExport({
      portfolioName: report.portfolioName,
      generatedAt: report.timestamp,
      timeHorizon: report.timeHorizon,
      note: report.notes,
      strategyType: report.strategyType,
      portfolio,
      phase1Payload: report.phase1Payload,
      efficientFrontierAnalysis,
    });
  };

  const handleOpenReportDocument = () => {
    if (!selectedReport || !reportPortfolio) return;
    const reportData = buildCanonicalExportReport(selectedReport, reportPortfolio);
    if (!reportData) {
      window.alert('This saved report cannot be exported because it does not contain a valid canonical Phase 1 payload.');
      return;
    }

    const markup = renderToStaticMarkup(<InvestmentReportPrintView report={reportData} />);
    const documentTitle = `${reportData.metadata.portfolio_name} Investment Report`;
    const printHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(documentTitle)}</title>
    <style>${INVESTMENT_REPORT_PRINT_CSS}</style>
  </head>
  <body>
    ${markup}
  </body>
</html>`;

    const printWindow = window.open('', '_blank', 'width=1024,height=900');
    if (!printWindow) {
      window.alert('Unable to open the print view. Please allow pop-ups and try again.');
      return;
    }

    printWindow.document.open('text/html', 'replace');
    printWindow.document.write(printHtml);
    printWindow.document.close();
    printWindow.focus();
  };

  const openReportInChat = (report: GeneratedReport, portfolio: Portfolio) => {
    const canonicalReport = buildCanonicalExportReport(report, portfolio);
    if (!canonicalReport) {
      window.alert('This saved report cannot be opened in chat because it does not contain a valid canonical Phase 1 payload.');
      return;
    }

    const chatContext = {
      handoffType: 'investment_report',
      report: canonicalReport,
    };
    const autoRunIntentId = `report-handoff-${Date.now()}`;
    localStorage.setItem(CHAT_PORTFOLIO_CONTEXT_STORAGE_KEY, JSON.stringify(chatContext));
    sessionStorage.setItem(
      CHAT_AUTO_RUN_INTENT_STORAGE_KEY,
      JSON.stringify({
        intentId: autoRunIntentId,
        source: 'investment_report_open_in_chat',
        createdAt: new Date().toISOString(),
      })
    );

    navigate('/chat', {
      state: {
        autoRunIntentId,
        source: 'investment-report-open-in-chat',
      },
    });
  };

  const handleOpenInChat = () => {
    if (!selectedReport || !reportPortfolio) return;
    openReportInChat(selectedReport, reportPortfolio);
  };

  const handleGenerateNew = () => {
    setViewMode('new');
    setSelectedPortfolioId(requestedPortfolioId || '');
    setNotes('');
    setTimeHorizon('90 Days');
    setRiskPreference('Balanced');
    setStrategyType('Growth');
  };

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="border rounded-lg p-2.5 shadow-xl" style={REPORT_SURFACES.tooltip}>
          <p className="text-slate-400 text-xs mb-1">{payload[0].payload.time}</p>
          <p className="text-emerald-400 text-sm font-semibold">${payload[0].value.toFixed(2)}</p>
        </div>
      );
    }
    return null;
  };

  const CustomAssetTypeTooltip = ({ active, payload }: any) => {
    if (!(active && payload && payload.length)) return null;

    const data = payload[0].payload;
    return (
      <div className="bg-slate-900 border border-slate-700 rounded-lg p-4 shadow-xl min-w-[200px]">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: data.color }} />
          <p className="text-slate-100 font-semibold text-sm">{data.type}</p>
        </div>
        <div className="space-y-2 mb-3">
          <div className="flex items-center justify-between gap-4">
            <span className="text-slate-400 text-xs">Allocation:</span>
            <span className="text-cyan-400 font-semibold text-sm">{data.allocation}%</span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-slate-400 text-xs">Value:</span>
            <span className="text-slate-100 font-semibold text-sm">${data.amount.toLocaleString()}</span>
          </div>
        </div>
        {data.holdings?.length > 0 && (
          <div className="pt-3 border-t border-slate-700">
            <p className="text-slate-400 text-xs uppercase tracking-wide mb-2">Holdings in this category:</p>
            <div className="space-y-1.5">
              {data.holdings.map((holding: any) => (
                <div key={holding.ticker} className="flex justify-between items-center">
                  <span className="text-slate-300 text-xs font-medium">{holding.ticker}</span>
                  <span className="text-cyan-400 text-xs font-semibold">{holding.allocation}%</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderReportContent = (portfolio: Portfolio | null | undefined, report: GeneratedReport | undefined) => (
    (() => {
      const holdings = (portfolio?.items || []).map((item, index) => {
        const allocation = portfolio?.budget ? Number(((item.amount / portfolio.budget) * 100).toFixed(1)) : 0;
        const assetType = classifyAssetType(item.ticker, item.name);
        return {
          ticker: item.ticker,
          asset: item.name,
          allocation,
          amount: item.amount,
          color: ASSET_TYPE_COLORS[assetType],
          assetType,
        };
      });

      const getHoldingDetailPath = (holding: typeof holdings[number]) => {
        if (holding.assetType === 'Option') {
          return `/research/options/${encodeURIComponent(getOptionUnderlyingTicker(holding.ticker) || holding.ticker)}`;
        }

        return getResearchAssetDetailPath(holding.ticker, holding.assetType === 'Crypto' ? 'crypto' : 'stock');
      };
      const sortedHoldings = holdings.slice().sort((a, b) => {
        if (holdingsSort === 'name') {
          return a.ticker.localeCompare(b.ticker);
        }

        if (holdingsSort === 'type') {
          const typeCompare = a.assetType.localeCompare(b.assetType);
          return typeCompare !== 0 ? typeCompare : a.ticker.localeCompare(b.ticker);
        }

        return b.allocation - a.allocation;
      });

      const groupedAssetTypes = holdings.reduce<Record<string, { type: string; allocation: number; amount: number; color: string; holdings: typeof holdings }>>((acc, holding) => {
        if (!acc[holding.assetType]) {
          acc[holding.assetType] = {
            type: holding.assetType,
            allocation: 0,
            amount: 0,
            color: holding.color,
            holdings: [],
          };
        }

        acc[holding.assetType].allocation += holding.allocation;
        acc[holding.assetType].amount += holding.amount;
        acc[holding.assetType].holdings.push(holding);
        return acc;
      }, {});

      const assetTypeData = Object.values(groupedAssetTypes)
        .map((entry) => ({
          ...entry,
          allocation: Number(entry.allocation.toFixed(1)),
        }))
        .sort((a, b) => b.allocation - a.allocation);

      const top3Concentration = Number(
        holdings
          .slice()
          .sort((a, b) => b.allocation - a.allocation)
          .slice(0, 3)
          .reduce((sum, item) => sum + item.allocation, 0)
          .toFixed(1)
      );
      const concentrationSortedHoldings = holdings.slice().sort((a, b) => b.allocation - a.allocation);
      const top3Holdings = concentrationSortedHoldings.slice(0, 3);
      const remainingHoldings = concentrationSortedHoldings.slice(3);
      const concentrationTooltipItems = hoveredConcentrationSegment === 'top3' ? top3Holdings : remainingHoldings;
      const resolvedReport = resolvePhase1Payload(report);
      const phase1Payload = resolvedReport.payload;
      const methodology = buildReferencesMethodologySection({
        phase1Payload,
        timeHorizon: report?.timeHorizon || '',
        note: report?.notes || '',
        strategyType: report?.strategyType || '',
        portfolio,
      });
      const researchInsightPoints = normalizePoints(phase1Payload.research_agent.key_insight, 'No research insight available.');
      const researchDriverPoints = normalizePoints(phase1Payload.research_agent.key_drivers, 'No research drivers available.');
      const quantMetricPoints = normalizePoints(phase1Payload.quant_agent.metrics, 'No quant metrics available.');
      const quantIndicatorPoints = normalizePoints(phase1Payload.quant_agent.indicators, 'No quant indicators available.');
      const riskStructuralPoints = normalizePoints(phase1Payload.risk_agent.structural_risks, 'No structural risks available.');
      const riskMetricPoints = normalizePoints(phase1Payload.risk_agent.risk_metrics, 'No risk metrics available.');
      const diagnostics = HIGHLIGHT_CARD_META.map(({ key, label, cardStyle }) => ({
        name: label,
        score: phase1Payload.portfolio_highlights[key].score,
        explanation: phase1Payload.portfolio_highlights[key].explanation,
        cardStyle,
      }));
      const committeeMetrics = [
        {
          name: 'Recommendation',
          score: phase1Payload.ai_committee_summary.recommendation.value,
          explanation: phase1Payload.ai_committee_summary.recommendation.explanation,
          cardStyle: REPORT_ACCENTS.emerald,
          scoreClassName: 'text-white',
        },
        {
          name: 'Position Size',
          score: phase1Payload.ai_committee_summary.position_size.value,
          explanation: phase1Payload.ai_committee_summary.position_size.explanation,
          cardStyle: REPORT_ACCENTS.blue,
          scoreClassName: 'text-white',
        },
        {
          name: 'Risk Level',
          score: phase1Payload.ai_committee_summary.risk_level.value,
          explanation: phase1Payload.ai_committee_summary.risk_level.explanation,
          cardStyle: REPORT_ACCENTS.amber,
          scoreClassName: 'text-white',
        },
        {
          name: 'Conviction',
          score: phase1Payload.ai_committee_summary.conviction.value,
          explanation: phase1Payload.ai_committee_summary.conviction.explanation,
          cardStyle: REPORT_ACCENTS.violet,
          scoreClassName: 'text-white',
        },
      ];

      const concentrationColors = {
        top3: {
          fill: '#9f1239',
          dot: '#9f1239',
        },
        remaining: {
          fill: '#0e7490',
          dot: '#0e7490',
        },
      };
      const scenarioCards = [
        ...phase1Payload.risk_agent.scenario_analysis.map((scenario) => ({
          label: scenario.label,
          description: scenario.description,
          accentColor: scenario.label === 'Bull Case' ? '#34d399' : scenario.label === 'Bear Case' ? '#f87171' : '#cbd5e1',
          backgroundImage: scenario.label === 'Bull Case' ? REPORT_GRADIENTS.emerald : scenario.label === 'Bear Case' ? REPORT_GRADIENTS.red : REPORT_GRADIENTS.slate,
          borderColor: scenario.label === 'Bull Case' ? REPORT_ACCENTS.emerald.borderColor : scenario.label === 'Bear Case' ? REPORT_ACCENTS.red.borderColor : REPORT_ACCENTS.slate.borderColor,
          icon: scenario.label === 'Bull Case'
            ? <TrendingUp className="w-5 h-5 text-emerald-400" />
            : scenario.label === 'Bear Case'
              ? <TrendingDown className="w-5 h-5 text-red-400" />
            : <Minus className="w-5 h-5 text-slate-400" />,
        })),
      ];
      const efficientFrontierCurve = efficientFrontierAnalysis?.frontierPortfolios.map((portfolio) => ({
        ...portfolio,
        kind: 'frontier',
      })) || [];
      const efficientFrontierSingleAssetPoints = efficientFrontierAnalysis?.singleAssetPoints.map((asset) => ({
        ...asset,
        label: asset.name,
        shortLabel: asset.ticker,
        kind: 'single-asset',
      })) || [];
      const efficientFrontierCurrentPoint = efficientFrontierAnalysis
        ? [{ ...efficientFrontierAnalysis.currentPortfolio, kind: 'current' as const }]
        : [];
      const efficientFrontierTangencyPoint = efficientFrontierAnalysis
        ? [{ ...efficientFrontierAnalysis.maxSharpePortfolio, kind: 'tangency' as const }]
        : [];
      const efficientFrontierMinimumVolatilityPoint = efficientFrontierAnalysis
        ? [{ ...efficientFrontierAnalysis.minimumVolatilityPortfolio, kind: 'minimum-volatility' as const }]
        : [];
      const efficientFrontierGuideLine = efficientFrontierAnalysis
        ? buildFrontierGuideLine(
            efficientFrontierAnalysis.frontierPortfolios,
            {
              label: efficientFrontierAnalysis.currentPortfolio.shortLabel,
              volatility: efficientFrontierAnalysis.currentPortfolio.volatility,
              expectedReturn: efficientFrontierAnalysis.currentPortfolio.expectedReturn,
            },
          )
        : [];
      const frontierVolatilityValues = [
        ...efficientFrontierCurve.map((point) => point.volatility),
        ...efficientFrontierSingleAssetPoints.map((point) => point.volatility),
        ...efficientFrontierCurrentPoint.map((point) => point.volatility),
        ...efficientFrontierTangencyPoint.map((point) => point.volatility),
        ...efficientFrontierMinimumVolatilityPoint.map((point) => point.volatility),
        ...efficientFrontierGuideLine.map((point) => point.volatility),
      ];
      const frontierReturnValues = [
        ...efficientFrontierCurve.map((point) => point.expectedReturn),
        ...efficientFrontierSingleAssetPoints.map((point) => point.expectedReturn),
        ...efficientFrontierCurrentPoint.map((point) => point.expectedReturn),
        ...efficientFrontierTangencyPoint.map((point) => point.expectedReturn),
        ...efficientFrontierMinimumVolatilityPoint.map((point) => point.expectedReturn),
        ...efficientFrontierGuideLine.map((point) => point.expectedReturn),
      ];
      const frontierXAxisDomain = computeAxisDomain(frontierVolatilityValues, { paddingRatio: 0.14, minSpan: 0.04 });
      const frontierYAxisDomain = computeAxisDomain(frontierReturnValues, { paddingRatio: 0.14, minSpan: 0.06 });
      const efficientFrontierSummaryCards = efficientFrontierAnalysis
        ? [
            {
              title: efficientFrontierAnalysis.currentPortfolio.label,
              accent: REPORT_ACCENTS.amber,
              portfolio: efficientFrontierAnalysis.currentPortfolio,
              weights: getNonZeroPortfolioWeights(efficientFrontierAnalysis.currentPortfolio.weights),
            },
            {
              title: 'Tangency Portfolio',
              accent: REPORT_ACCENTS.emerald,
              portfolio: efficientFrontierAnalysis.maxSharpePortfolio,
              weights: getNonZeroPortfolioWeights(efficientFrontierAnalysis.maxSharpePortfolio.weights),
            },
            {
              title: 'Minimum Volatility Portfolio',
              accent: REPORT_ACCENTS.blue,
              portfolio: efficientFrontierAnalysis.minimumVolatilityPortfolio,
              weights: getNonZeroPortfolioWeights(efficientFrontierAnalysis.minimumVolatilityPortfolio.weights),
            },
          ]
        : [];

      return (
        <div className="space-y-6">
          <div className="border rounded-lg p-6" style={REPORT_SURFACES.section}>
            <div className="flex items-start justify-between mb-6">
              <div>
                <h2 className="text-slate-100 text-3xl font-semibold mb-2 tracking-tight">
                  Portfolio Analysis
                </h2>
                <p className="text-slate-400 text-sm">
                  {report?.notes ? `Notes: "${report.notes}"` : 'AI-generated portfolio analysis'}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-5 gap-4 pt-6 border-t border-slate-800">
              <div>
                <div className="text-slate-500 text-xs mb-1.5">Portfolio Name</div>
                <div className="text-slate-200 text-sm font-medium">{portfolio?.name || 'Untitled Portfolio'}</div>
              </div>
              <div>
                <div className="text-slate-500 text-xs mb-1.5">Generated Time</div>
                <div className="text-slate-200 text-sm font-medium">
                  {report
                    ? `${new Date(report.timestamp).toLocaleDateString()} ${new Date(report.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                    : '-'}
                </div>
              </div>
              <div>
                <div className="text-slate-500 text-xs mb-1.5">Total Capital</div>
                <div className="text-slate-200 text-sm font-medium">${portfolio?.budget.toLocaleString() || 0}</div>
              </div>
              <div>
                <div className="text-slate-500 text-xs mb-1.5">Holdings</div>
                <div className="text-slate-200 text-sm font-medium">{portfolio?.items.length || 0}</div>
              </div>
              <div>
                <div className="text-slate-500 text-xs mb-1.5">Time Horizon</div>
                <div className="text-slate-200 text-sm font-medium">{report?.timeHorizon || timeHorizon}</div>
              </div>
            </div>
          </div>

          <div className="border rounded-lg p-6" style={REPORT_SURFACES.section}>
            <h2 className="text-slate-200 text-xl font-semibold mb-6">Portfolio Overview</h2>
            <div className="grid grid-cols-3 gap-8 items-start">
              <div className="col-span-2 border rounded-lg p-6 min-w-0" style={REPORT_SURFACES.sectionStrong}>
                <div className="grid grid-cols-2 gap-8 items-start">
                  <div className="flex flex-col min-w-0">
                    <div className="text-slate-400 text-ms uppercase tracking-wider mb-5 font-semibold">Portfolio Composition</div>
                    <div className="flex items-center justify-center relative mb-4 min-h-[300px]">
                      <div className="relative z-10 w-full">
                        <ResponsiveContainer width="100%" height={300}>
                        <PieChart>
                          <Pie
                            data={assetTypeData}
                            cx="50%"
                            cy="50%"
                            innerRadius={82}
                            outerRadius={128}
                            paddingAngle={2}
                            dataKey="allocation"
                            onMouseEnter={(_, index) => setHoveredAssetType(assetTypeData[index]?.type || null)}
                            onMouseLeave={() => setHoveredAssetType(null)}
                          >
                            {assetTypeData.map((entry, index) => (
                              <Cell
                                key={`asset-type-${index}`}
                                fill={entry.color}
                                stroke="#0f172a"
                                strokeWidth={3}
                                opacity={hoveredAssetType === null || hoveredAssetType === entry.type ? 1 : 0.3}
                              />
                            ))}
                          </Pie>
                          <Tooltip
                            content={<CustomAssetTypeTooltip />}
                            allowEscapeViewBox={{ x: true, y: true }}
                            wrapperStyle={{ zIndex: 30 }}
                          />
                        </PieChart>
                      </ResponsiveContainer>
                      </div>
                      <div className="absolute inset-0 z-0 flex items-center justify-center pointer-events-none">
                        <div className="text-center">
                          <div className="text-slate-500 text-[9px] uppercase tracking-[0.18em] mb-2">Total Capital</div>
                          <div className="text-slate-100 text-2xl font-bold leading-none mb-3">${portfolio?.budget.toLocaleString() || 0}</div>
                          <div className="text-slate-400 text-sm leading-none">{portfolio?.items.length || 0} Holdings</div>
                        </div>
                      </div>
                    </div>
                    <div className="space-y-1.5 mt-2">
                      {assetTypeData.map((entry) => {
                        const isHovered = hoveredAssetType === entry.type;
                        return (
                          <div
                            key={entry.type}
                            className="flex items-center justify-between p-1.5 rounded-md cursor-pointer transition-all border"
                            style={isHovered ? {
                              backgroundColor: 'rgba(30, 41, 59, 0.6)',
                              borderColor: 'rgb(51, 65, 85)',
                            } : {
                              borderColor: 'transparent',
                            }}
                            onMouseEnter={() => setHoveredAssetType(entry.type)}
                            onMouseLeave={() => setHoveredAssetType(null)}
                          >
                            <div className="flex items-center gap-2">
                              <div
                                className={`w-3 h-3 rounded-full flex-shrink-0 shadow-[0_0_0_2px_rgba(15,23,42,0.9)] transition-transform ${isHovered ? 'scale-110' : 'scale-100'}`}
                                style={{ backgroundColor: entry.color }}
                              />
                              <span className={`text-xs font-medium transition-colors ${isHovered ? 'text-slate-100' : 'text-slate-300'}`}>
                                {entry.type}
                              </span>
                            </div>
                            <span className={`text-xs font-semibold transition-colors ${isHovered ? 'text-slate-100' : 'text-slate-400'}`}>
                              {entry.allocation}%
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="flex flex-col min-w-0 border-l pl-10" style={REPORT_SURFACES.divider}>
                    <div className="flex items-center justify-between gap-3 mb-5">
                      <div />
                      <label>
                        <select
                          value={holdingsSort}
                          onChange={(event) => setHoldingsSort(event.target.value as 'name' | 'type' | 'allocation')}
                          className="rounded-md border px-2.5 py-1 text-xs text-slate-200 outline-none transition-colors hover:border-slate-600 focus:border-blue-500"
                          style={REPORT_SURFACES.input}
                        >
                          <option value="allocation">Holding %</option>
                          <option value="name">Name</option>
                          <option value="type">Type</option>
                        </select>
                      </label>
                    </div>
                    <div className="space-y-2.5 overflow-y-auto pr-2" style={{ maxHeight: '420px' }}>
                      {sortedHoldings.map((holding) => (
                        <button
                          key={holding.ticker}
                          type="button"
                          onMouseEnter={() => setHoveredHoldingTicker(holding.ticker)}
                          onMouseLeave={() => setHoveredHoldingTicker(null)}
                          onClick={() => {
                            setSelectedHoldingTicker(holding.ticker);
                            navigate(getHoldingDetailPath(holding), {
                              state: {
                                source: 'investment-report',
                                selectedReportId: report?.id,
                              },
                            });
                          }}
                          className="w-full text-left rounded-lg p-3 transition-all flex-shrink-0 border hover:border-slate-700"
                          style={selectedHoldingTicker === holding.ticker
                            ? {
                                ...REPORT_SURFACES.rowSelected,
                                boxShadow: '0 0 0 1px rgba(71, 85, 105, 0.25)',
                              }
                            : hoveredHoldingTicker === holding.ticker
                              ? {
                                  backgroundColor: 'rgba(30, 41, 59, 0.6)',
                                  borderColor: 'rgb(51, 65, 85)',
                                  boxShadow: '0 0 0 1px rgba(51, 65, 85, 0.2)',
                                }
                              : REPORT_SURFACES.rowIdle}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3 flex-1 min-w-0">
                              <div className="w-3 h-3 rounded-full flex-shrink-0 shadow-[0_0_0_2px_rgba(15,23,42,0.85)]" style={{ backgroundColor: holding.color }} />
                              <div className="flex-1 min-w-0">
                                <div className="text-slate-100 font-bold text-sm mb-1">{holding.ticker}</div>
                                <div className="text-slate-500 text-xs truncate">{holding.asset}</div>
                              </div>
                            </div>
                            <div className="text-right ml-4 flex-shrink-0">
                              <div className="text-slate-100 font-bold text-sm mb-1">{holding.allocation}%</div>
                              <div className="text-slate-500 text-xs">${holding.amount.toLocaleString()}</div>
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              <div className="border rounded-lg p-6 flex flex-col h-full min-w-0" style={REPORT_SURFACES.sectionStrong}>
                <div className="text-slate-400 text-ms uppercase tracking-wider mb-5 font-semibold">Portfolio Highlights</div>
                <div className="space-y-2.5">
                  {diagnostics.map((metric) => {
                    const isExpanded = expandedDiagnostic === metric.name;
                    const isHovered = hoveredDiagnostic === metric.name;
                    return (
                      <button
                        key={metric.name}
                        type="button"
                        onClick={() => setExpandedDiagnostic(isExpanded ? null : metric.name)}
                        onMouseEnter={() => setHoveredDiagnostic(metric.name)}
                        onMouseLeave={() => setHoveredDiagnostic(null)}
                        className="w-full rounded-lg p-4 text-left transition-colors border hover:border-slate-600"
                        style={{
                          backgroundColor: isExpanded || isHovered
                            ? REPORT_SURFACES.rowSelected.backgroundColor
                            : REPORT_SURFACES.rowIdle.backgroundColor,
                          borderColor: isExpanded || isHovered
                            ? REPORT_SURFACES.rowSelected.borderColor
                            : REPORT_SURFACES.rowIdle.borderColor,
                          boxShadow: isExpanded || isHovered
                            ? '0 0 0 1px rgba(71, 85, 105, 0.25)'
                            : 'none',
                        }}
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0">
                            <div className="text-sm mb-1 uppercase tracking-wide font-semibold" style={{ color: metric.cardStyle.labelColor }}>{metric.name}</div>
                            <div className="text-sm font-semibold text-white">{metric.score}</div>
                          </div>
                          {isExpanded ? (
                            <ChevronUp className="mt-0.5 h-4 w-4 flex-shrink-0 text-slate-400" />
                          ) : (
                            <ChevronDown className="mt-0.5 h-4 w-4 flex-shrink-0 text-slate-400" />
                          )}
                        </div>
                        {isExpanded && (
                          <div className="mt-4 pt-4">
                            <p className="text-slate-400 text-sm leading-relaxed">{metric.explanation}</p>
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          <div className="border rounded-lg p-8" style={REPORT_SURFACES.section}>
            <h2 className="text-slate-200 text-xl font-semibold mb-6">AI Investment Insights</h2>
            <div className="space-y-6">
              <div className="border rounded-lg p-6" style={REPORT_SURFACES.sectionStrong}>
                <h3 className="text-slate-400 text-ms font-semibold mb-6">AI COMMITTEE SUMMARY</h3>
                <div className="grid grid-cols-3 gap-4 items-start">
                  <div className="border rounded-lg p-5 col-span-2" style={REPORT_SURFACES.rowIdle}>
                    <div className="text-[11px] tracking-[0.16em] mb-4 text-slate-400 font-semibold">{phase1Payload.ai_committee_summary.thesis.title}</div>
                    <p className="text-slate-300 text-sm leading-relaxed">
                      {phase1Payload.ai_committee_summary.thesis.body}
                    </p>
                    <div className="mt-6 space-y-4">
                      {phase1Payload.ai_committee_summary.summary_points.map((point, index) => (
                        <div key={`committee-summary-${index}`} className="flex items-start gap-2.5">
                          <span className="text-slate-300 text-sm leading-relaxed">•</span>
                          <p
                            className={index === 0 ? 'text-sm font-medium leading-relaxed' : 'text-slate-300 text-sm leading-relaxed'}
                            style={index === 0 ? { color: 'rgba(255, 255, 255, 0.8)' } : undefined}
                          >
                            {point}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4 col-span-1">
                    {committeeMetrics.map((metric) => {
                      const isExpanded = expandedCommitteeMetric === metric.name;
                      const isHovered = hoveredCommitteeMetric === metric.name;
                      return (
                        <button
                          key={metric.name}
                          type="button"
                          onClick={() => setExpandedCommitteeMetric(isExpanded ? null : metric.name)}
                          onMouseEnter={() => setHoveredCommitteeMetric(metric.name)}
                          onMouseLeave={() => setHoveredCommitteeMetric(null)}
                          className="w-full rounded-lg p-4 text-left transition-colors border hover:border-slate-600"
                          style={{
                            backgroundColor: isExpanded || isHovered
                              ? REPORT_SURFACES.rowSelected.backgroundColor
                              : REPORT_SURFACES.rowIdle.backgroundColor,
                            borderColor: isExpanded || isHovered
                              ? REPORT_SURFACES.rowSelected.borderColor
                              : REPORT_SURFACES.rowIdle.borderColor,
                            boxShadow: isExpanded || isHovered
                              ? '0 0 0 1px rgba(71, 85, 105, 0.25)'
                              : 'none',
                          }}
                        >
                          <div className="flex items-start justify-between gap-4">
                            <div className="min-w-0">
                              <div className="text-sm mb-1 uppercase tracking-wide font-semibold" style={{ color: metric.cardStyle.labelColor }}>{metric.name}</div>
                              <div className={`text-sm font-semibold flex items-center gap-2 ${metric.scoreClassName}`}>
                                <span>{metric.score}</span>
                                {metric.showTrendIcon ? <TrendingUp className="h-4 w-4 flex-shrink-0" /> : null}
                              </div>
                            </div>
                            {isExpanded ? (
                              <ChevronUp className="mt-0.5 h-4 w-4 flex-shrink-0 text-slate-400" />
                            ) : (
                              <ChevronDown className="mt-0.5 h-4 w-4 flex-shrink-0 text-slate-400" />
                            )}
                          </div>
                          {isExpanded && (
                            <div className="mt-4 border-t border-slate-800 pt-4">
                              <p className="text-slate-400 text-sm leading-relaxed">{metric.explanation}</p>
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="border rounded-lg p-6" style={REPORT_SURFACES.sectionStrong}>
                <div className="mb-4">
                  <h4 className="text-sm font-semibold uppercase tracking-wide" style={{ color: REPORT_ACCENTS.blue.labelColor }}>Research Agent</h4>
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <div className="border rounded-lg p-4" style={REPORT_SURFACES.rowIdle}>
                    <div className="text-[11px] tracking-[0.16em] mb-3 font-semibold" style={{ color: REPORT_ACCENTS.blue.labelColor }}>Insight</div>
                    <ul className="space-y-3 text-slate-300 text-sm">
                      {researchInsightPoints.map((point, index) => (
                        <li key={`research-insight-${index}`} className="flex items-start gap-2"><span className="text-white text-sm leading-relaxed">•</span><span className="leading-relaxed">{point}</span></li>
                      ))}
                    </ul>
                  </div>
                  <div className="border rounded-lg p-4" style={REPORT_SURFACES.rowIdle}>
                    <div className="text-[11px] tracking-[0.16em] mb-3 font-semibold" style={{ color: REPORT_ACCENTS.blue.labelColor }}>News / Fundamental Drivers</div>
                    <ul className="space-y-3 text-slate-300 text-sm">
                      {researchDriverPoints.map((point, index) => (
                        <li key={`research-driver-${index}`} className="flex items-start gap-2"><span className="text-white text-sm leading-relaxed">•</span><span className="leading-relaxed">{point}</span></li>
                      ))}
                    </ul>
                  </div>
                  <div className="border rounded-lg p-4" style={REPORT_SURFACES.rowIdle}>
                    <div className="text-[11px] tracking-[0.16em] mb-3 font-semibold" style={{ color: REPORT_ACCENTS.blue.labelColor }}>Implications</div>
                    <p className="text-slate-300 text-sm leading-relaxed">{phase1Payload.research_agent.implications}</p>
                  </div>
                </div>
              </div>

              <div className="border rounded-lg p-6" style={REPORT_SURFACES.sectionStrong}>
                <div className="mb-4">
                  <h4 className="text-sm font-semibold uppercase tracking-wide" style={{ color: REPORT_ACCENTS.purple.labelColor }}>Quant Agent & Frontier Analysis</h4>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="border rounded-lg p-4" style={REPORT_SURFACES.rowIdle}>
                    <div className="text-[11px] tracking-[0.16em] mb-3 font-semibold" style={{ color: REPORT_ACCENTS.purple.labelColor }}>Concentration</div>
                    <div className="relative mb-4">
                      <div className="relative w-full h-9 bg-slate-800 rounded-lg overflow-hidden">
                        <div
                          className="absolute left-0 top-0 h-full flex items-center justify-center transition-opacity border-r"
                          style={{
                            width: `${Math.min(top3Concentration, 100).toFixed(1)}%`,
                            backgroundColor: concentrationColors.top3.fill,
                            borderColor: 'rgba(15, 23, 42, 0.45)',
                            opacity: hoveredConcentrationSegment === null || hoveredConcentrationSegment === 'top3' ? 1 : 0.55,
                          }}
                          onMouseEnter={() => setHoveredConcentrationSegment('top3')}
                          onMouseLeave={() => setHoveredConcentrationSegment(null)}
                        >
                          <span className="text-slate-100 text-sm font-semibold">{top3Concentration.toFixed(1)}%</span>
                        </div>
                        <div
                          className="absolute right-0 top-0 h-full flex items-center justify-center transition-opacity"
                          style={{
                            width: `${Math.max(100 - top3Concentration, 0).toFixed(1)}%`,
                            backgroundColor: concentrationColors.remaining.fill,
                            opacity: hoveredConcentrationSegment === null || hoveredConcentrationSegment === 'remaining' ? 1 : 0.55,
                          }}
                          onMouseEnter={() => setHoveredConcentrationSegment('remaining')}
                          onMouseLeave={() => setHoveredConcentrationSegment(null)}
                        >
                          <span className="text-slate-100 text-sm font-semibold">{Math.max(100 - top3Concentration, 0).toFixed(1)}%</span>
                        </div>
                      </div>
                      {hoveredConcentrationSegment && (
                        <div
                          className="pointer-events-none absolute top-full z-20 mt-3 min-w-[200px] rounded-lg border p-4 shadow-xl"
                          style={{
                            ...(hoveredConcentrationSegment === 'top3' ? { left: 0 } : { right: 0 }),
                            backgroundColor: 'rgb(15, 23, 42)',
                            borderColor: 'rgb(51, 65, 85)',
                          }}
                        >
                          <div className="flex items-center gap-2 mb-3">
                            <div
                              className="w-3 h-3 rounded-full"
                              style={{
                                backgroundColor: hoveredConcentrationSegment === 'top3'
                                  ? concentrationColors.top3.dot
                                  : concentrationColors.remaining.dot,
                              }}
                            />
                            <p className="text-slate-100 font-semibold text-sm">
                              {hoveredConcentrationSegment === 'top3' ? 'Top 3 Holdings' : 'Remaining Holdings'}
                            </p>
                          </div>
                          <div className="space-y-2 mb-3">
                            <div className="flex items-center justify-between gap-4">
                              <span className="text-slate-400 text-xs">Allocation:</span>
                              <span className="text-cyan-400 font-semibold text-sm">
                                {hoveredConcentrationSegment === 'top3'
                                  ? `${top3Concentration.toFixed(1)}%`
                                  : `${Math.max(100 - top3Concentration, 0).toFixed(1)}%`}
                              </span>
                            </div>
                            <div className="flex items-center justify-between gap-4">
                              <span className="text-slate-400 text-xs">Holdings:</span>
                              <span className="text-slate-100 font-semibold text-sm">{concentrationTooltipItems.length}</span>
                            </div>
                          </div>
                          <div className="pt-3 border-t border-slate-700">
                            <p className="text-slate-400 text-xs uppercase tracking-wide mb-2">
                              Holdings in this category:
                            </p>
                            <div className="space-y-1.5">
                            {concentrationTooltipItems.length > 0 ? concentrationTooltipItems.map((holding) => (
                              <div key={`${hoveredConcentrationSegment}-${holding.ticker}`} className="flex justify-between items-center">
                                <span className="text-slate-300 text-xs font-medium">{holding.ticker}</span>
                                <span className="text-cyan-400 text-xs font-semibold">{holding.allocation.toFixed(1)}%</span>
                              </div>
                            )) : (
                              <div className="text-slate-400 text-xs">No holdings in this category.</div>
                            )}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="grid grid-cols-3 gap-1">
                      <div className="flex items-center gap-2 rounded-md px-1.5 py-1">
                        <div className="w-3 h-3 rounded" style={{ backgroundColor: concentrationColors.top3.dot }}></div>
                        <div className="flex-1">
                          <div className="text-slate-300 text-sm font-semibold">Top 3 Holdings</div>
                          <div className="text-slate-500 text-xs">Concentrated Risk</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 rounded-md px-1.5 py-1">
                        <div className="w-3 h-3 rounded" style={{ backgroundColor: concentrationColors.remaining.dot }}></div>
                        <div className="flex-1">
                          <div className="text-slate-300 text-sm font-semibold">Remaining Holdings</div>
                          <div className="text-slate-500 text-xs">Residual Diversification</div>
                        </div>
                      </div>
                    </div>
                    <div className="mt-4 border-t border-slate-800 pt-4">
                      <div className="text-[11px] tracking-[0.16em] mb-2 text-slate-400 font-semibold">Conclusion</div>
                      <p className="text-slate-300 text-sm leading-relaxed">
                        {phase1Payload.quant_agent.concentration.conclusion}
                      </p>
                    </div>
                  </div>
                  <div className="border rounded-lg p-4" style={REPORT_SURFACES.rowIdle}>
                    <div className="text-[11px] tracking-[0.16em] mb-3 font-semibold" style={{ color: REPORT_ACCENTS.purple.labelColor }}>Correlation</div>
                    <div className="text-slate-100 text-sm font-semibold mb-2">{phase1Payload.quant_agent.correlation.summary}</div>
                    <p className="text-slate-300 text-sm leading-relaxed">{phase1Payload.quant_agent.correlation.interpretation}</p>
                  </div>
                  <div className="border rounded-lg p-4" style={REPORT_SURFACES.rowIdle}>
                    <div className="text-[11px] tracking-[0.16em] mb-3 font-semibold" style={{ color: REPORT_ACCENTS.purple.labelColor }}>Metrics</div>
                    <ul className="space-y-3 text-slate-300 text-sm">
                      {quantMetricPoints.map((point, index) => (
                        <li key={`quant-metric-${index}`} className="flex items-start gap-2"><span className="text-white text-sm leading-relaxed">•</span><span className="leading-relaxed">{point}</span></li>
                      ))}
                    </ul>
                  </div>
                  <div className="border rounded-lg p-4" style={REPORT_SURFACES.rowIdle}>
                    <div className="text-[11px] tracking-[0.16em] mb-3 font-semibold" style={{ color: REPORT_ACCENTS.purple.labelColor }}>Indicators</div>
                    <ul className="space-y-3 text-slate-300 text-sm">
                      {quantIndicatorPoints.map((point, index) => (
                        <li key={`quant-indicator-${index}`} className="flex items-start gap-2"><span className="text-white text-sm leading-relaxed">•</span><span className="leading-relaxed">{point}</span></li>
                      ))}
                    </ul>
                  </div>
                </div>
                <div className="mt-6">
                  <div className="border rounded-lg p-6" style={REPORT_SURFACES.rowIdle}>
                    <div className="mb-6">
                      <div className="text-[11px] tracking-[0.16em] mb-3 font-semibold" style={{ color: REPORT_ACCENTS.purple.labelColor }}>
                        Efficient Frontier Chart
                      </div>
                    </div>

                    {efficientFrontierLoading ? (
                      <div className="border rounded-lg p-6 flex items-center gap-3" style={REPORT_SURFACES.sectionStrong}>
                        <Loader2 className="w-4 h-4 text-violet-300 animate-spin" />
                        <p className="text-slate-300 text-sm">
                          Computing efficient frontier from the portfolio&apos;s monthly return history...
                        </p>
                      </div>
                    ) : efficientFrontierError ? (
                      <div className="border rounded-lg p-5" style={REPORT_SURFACES.sectionStrong}>
                        <p className="text-slate-300 text-sm leading-relaxed">{efficientFrontierError}</p>
                      </div>
                    ) : efficientFrontierAnalysis ? (
                      <div className="grid grid-cols-3 gap-6 items-start">
                        <div className="col-span-2 border rounded-lg p-4" style={REPORT_SURFACES.sectionStrong}>
                          <ResponsiveContainer width="100%" height={420}>
                            <ComposedChart
                              margin={{ top: 20, right: 24, bottom: 12, left: 4 }}
                              onMouseLeave={() => {
                                setHoveredFrontierIndex(null);
                                setHoveredFrontierPoint(null);
                              }}
                            >
                              <CartesianGrid stroke="rgba(148, 163, 184, 0.12)" strokeDasharray="3 3" />
                              <XAxis
                                type="number"
                                dataKey="volatility"
                                domain={frontierXAxisDomain}
                                tickFormatter={(value) => formatMetricPercent(Number(value), 0)}
                                stroke="#94a3b8"
                                tick={{ fill: '#94a3b8', fontSize: 12 }}
                                label={{ value: 'Annualized Volatility', position: 'insideBottom', dy: 10, fill: '#94a3b8', fontSize: 12 }}
                              />
                              <YAxis
                                type="number"
                                dataKey="expectedReturn"
                                domain={frontierYAxisDomain}
                                tickFormatter={(value) => formatMetricPercent(Number(value), 0)}
                                stroke="#94a3b8"
                                tick={{ fill: '#94a3b8', fontSize: 12 }}
                                label={{ value: 'Annualized Return', angle: -90, position: 'insideLeft', dx: -2, fill: '#94a3b8', fontSize: 12 }}
                              />
                              <Tooltip
                                content={<EfficientFrontierTooltip />}
                                shared={false}
                                cursor={false}
                                active={Boolean(hoveredFrontierPoint)}
                                payload={hoveredFrontierPoint ? [{ payload: hoveredFrontierPoint.payload || hoveredFrontierPoint }] : []}
                                coordinate={hoveredFrontierPoint ? { x: hoveredFrontierPoint.cx, y: hoveredFrontierPoint.cy } : undefined}
                              />
                              <Line
                                data={efficientFrontierGuideLine}
                                type="linear"
                                dataKey="expectedReturn"
                                stroke="#f59e0b"
                                strokeWidth={2}
                                dot={false}
                                strokeDasharray="6 4"
                                isAnimationActive={false}
                              />
                              <Scatter
                                data={efficientFrontierCurve}
                                fill="#c084fc"
                                activeIndex={hoveredFrontierIndex ?? -1}
                                activeShape={{ stroke: '#ffffff', strokeWidth: 2, fill: '#c084fc', size: FRONTIER_ACTIVE_DOT_SIZE }}
                                line={{ stroke: '#a855f7', strokeWidth: 3 }}
                                lineType="joint"
                                lineJointType="monotoneX"
                                isAnimationActive={false}
                                onMouseEnter={(point: any, index: number) => {
                                  setHoveredFrontierIndex(index);
                                  setHoveredFrontierPoint(point);
                                }}
                                onMouseLeave={() => {
                                  setHoveredFrontierIndex(null);
                                  setHoveredFrontierPoint(null);
                                }}
                              >
                                {efficientFrontierCurve.map((point, index) => (
                                  <Cell key={`frontier-dot-${point.label}-${index}`} size={FRONTIER_DOT_SIZE} />
                                ))}
                              </Scatter>
                              <Scatter
                                data={efficientFrontierSingleAssetPoints}
                                fill="#94a3b8"
                                isAnimationActive={false}
                                onMouseEnter={(point: any) => setHoveredFrontierPoint(point)}
                                onMouseLeave={() => setHoveredFrontierPoint(null)}
                              >
                                <LabelList dataKey="shortLabel" content={renderAssetLabel} />
                              </Scatter>
                              <Scatter
                                data={efficientFrontierCurrentPoint}
                                fill="#f59e0b"
                                isAnimationActive={false}
                                onMouseEnter={(point: any) => setHoveredFrontierPoint(point)}
                                onMouseLeave={() => setHoveredFrontierPoint(null)}
                              >
                                <LabelList dataKey="shortLabel" content={renderOptimizationLabel} />
                              </Scatter>
                              <Scatter
                                data={efficientFrontierTangencyPoint}
                                fill="#10b981"
                                isAnimationActive={false}
                                onMouseEnter={(point: any) => setHoveredFrontierPoint(point)}
                                onMouseLeave={() => setHoveredFrontierPoint(null)}
                              >
                                <LabelList dataKey="shortLabel" content={renderOptimizationLabel} />
                              </Scatter>
                              <Scatter
                                data={efficientFrontierMinimumVolatilityPoint}
                                fill="#3b82f6"
                                isAnimationActive={false}
                                onMouseEnter={(point: any) => setHoveredFrontierPoint(point)}
                                onMouseLeave={() => setHoveredFrontierPoint(null)}
                              />
                            </ComposedChart>
                          </ResponsiveContainer>
                        </div>

                        <div className="col-span-1 space-y-4">
                          {efficientFrontierSummaryCards.map((card) => {
                            const isCollapsed = expandedSummaryCard !== card.title;
                            const isHovered = hoveredSummaryCard === card.title;

                            return (
                              <button
                                key={card.title}
                                type="button"
                                onClick={() => setExpandedSummaryCard(isCollapsed ? card.title : null)}
                                onMouseEnter={() => setHoveredSummaryCard(card.title)}
                                onMouseLeave={() => setHoveredSummaryCard(null)}
                                className="w-full self-start rounded-lg p-5 text-left transition-colors border hover:border-slate-600"
                                style={{
                                  backgroundColor: isCollapsed && !isHovered
                                    ? REPORT_SURFACES.rowIdle.backgroundColor
                                    : REPORT_SURFACES.rowSelected.backgroundColor,
                                  borderColor: isCollapsed && !isHovered
                                    ? REPORT_SURFACES.rowIdle.borderColor
                                    : REPORT_SURFACES.rowSelected.borderColor,
                                  boxShadow: isCollapsed && !isHovered
                                    ? 'none'
                                    : '0 0 0 1px rgba(71, 85, 105, 0.25)',
                                }}
                              >
                                <div className="flex items-start justify-between gap-4 mb-4">
                                  <div className="min-w-0">
                                    <div className="text-sm uppercase tracking-wide font-semibold" style={{ color: card.accent.labelColor }}>
                                      {card.title}
                                    </div>
                                  </div>
                                  {isCollapsed ? (
                                    <ChevronDown className="mt-0.5 h-4 w-4 flex-shrink-0 text-slate-400" />
                                  ) : (
                                    <ChevronUp className="mt-0.5 h-4 w-4 flex-shrink-0 text-slate-400" />
                                  )}
                                </div>
                                <div className="grid grid-cols-3 gap-4">
                                  <div>
                                    <div className="text-slate-500 text-xs mb-1">Return</div>
                                    <div className="text-slate-100 text-sm font-semibold">{formatMetricPercent(card.portfolio.expectedReturn)}</div>
                                  </div>
                                  <div>
                                    <div className="text-slate-500 text-xs mb-1">Volatility</div>
                                    <div className="text-slate-100 text-sm font-semibold">{formatMetricPercent(card.portfolio.volatility)}</div>
                                  </div>
                                  <div>
                                    <div className="text-slate-500 text-xs mb-1">Sharpe</div>
                                    <div className="text-slate-100 text-sm font-semibold">{formatMetricSharpe(card.portfolio.sharpe)}</div>
                                  </div>
                                </div>
                                {!isCollapsed && card.weights.length ? (
                                  <div className="mt-4 pt-4 space-y-1.5">
                                    <div className="text-slate-500 text-xs mb-1">Portfolio Weights</div>
                                    {card.weights.map(({ ticker, weight }) => (
                                      <div key={`${card.title}-${ticker}`} className="text-slate-100 text-sm font-semibold">
                                        <span>{ticker}</span>
                                        <span className="text-slate-200">: {formatMetricPercent(weight, 2)}</span>
                                      </div>
                                    ))}
                                  </div>
                                ) : null}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>

              <div className="border rounded-lg p-6" style={REPORT_SURFACES.sectionStrong}>
                <div className="mb-4">
                  <h4 className="text-sm font-semibold uppercase tracking-wide" style={{ color: REPORT_ACCENTS.amber.labelColor }}>Risk Agent</h4>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="border rounded-lg p-4" style={REPORT_SURFACES.rowIdle}>
                    <div className="text-[11px] tracking-[0.16em] mb-3 font-semibold" style={{ color: REPORT_ACCENTS.amber.labelColor }}>Structural Risks</div>
                    <ul className="space-y-3 text-slate-300 text-sm">
                      {riskStructuralPoints.map((point, index) => (
                        <li key={`risk-structural-${index}`} className="flex items-start gap-2"><span className="text-white text-sm leading-relaxed">•</span><span className="leading-relaxed">{point}</span></li>
                      ))}
                    </ul>
                  </div>
                  <div className="border rounded-lg p-4" style={REPORT_SURFACES.rowIdle}>
                    <div className="text-[11px] tracking-[0.16em] mb-3 font-semibold" style={{ color: REPORT_ACCENTS.amber.labelColor }}>Risk Metrics</div>
                    <ul className="space-y-3 text-slate-300 text-sm">
                      {riskMetricPoints.map((point, index) => (
                        <li key={`risk-metric-${index}`} className="flex items-start gap-2"><span className="text-white text-sm leading-relaxed">•</span><span className="leading-relaxed">{point}</span></li>
                      ))}
                    </ul>
                  </div>
                  <div className="border rounded-lg p-4" style={REPORT_SURFACES.rowIdle}>
                    <div className="text-[11px] tracking-[0.16em] mb-3 font-semibold" style={{ color: REPORT_ACCENTS.amber.labelColor }}>Scenario Analysis</div>
                    <div className="grid grid-cols-3 gap-3">
                      {scenarioCards.map((scenario) => (
                        <div
                          key={scenario.label}
                          className="border rounded-lg p-4"
                          style={{ backgroundImage: scenario.backgroundImage, borderColor: scenario.borderColor }}
                        >
                          <div className="flex items-start justify-between gap-4 mb-3">
                            <div className="flex items-center gap-2 min-w-0">
                              {scenario.icon}
                              <h5 className="font-semibold text-sm whitespace-nowrap" style={{ color: scenario.accentColor }}>{scenario.label}</h5>
                            </div>
                          </div>
                          <p className="text-slate-300 text-sm leading-relaxed">{scenario.description}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="border rounded-lg p-4" style={REPORT_SURFACES.rowIdle}>
                    <div className="text-[11px] tracking-[0.16em] mb-3 font-semibold" style={{ color: REPORT_ACCENTS.amber.labelColor }}>Guardrails</div>
                    <ul className="space-y-3 text-slate-300 text-sm">
                      {phase1Payload.risk_agent.guardrails.map((point, index) => (
                        <li key={`risk-guardrail-${index}`} className="flex items-start gap-2"><span className="text-white text-sm leading-relaxed">•</span><span className="leading-relaxed">{point}</span></li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="border rounded-lg overflow-hidden" style={REPORT_SURFACES.section}>
            <button
              onClick={() => setShowReferences(!showReferences)}
              className="w-full flex items-center justify-between p-8 text-left"
            >
              <h2 className="text-slate-200 text-xl font-semibold">References & Methodology</h2>
              {showReferences ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
            </button>
            {showReferences && (
              <div className="px-8 pb-20">
                <div className="space-y-4">
                  {methodology?.sections.map((section) => (
                    <div key={section.key}>
                      <h4 className="text-slate-400 text-xs font-semibold mb-2 uppercase tracking-wide">{section.title}</h4>
                      <p className="text-slate-500 text-sm">{section.body}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="border-t pt-6" style={REPORT_SURFACES.divider}>
            <p className="text-slate-500 text-xs leading-relaxed">
              This report is generated by AI agents for informational purposes only and does not constitute investment advice.
            </p>
          </div>
        </div>
      );
    })()
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-slate-100 mb-2">Investment Reports</h1>
        <p className="text-slate-400">AI-powered investment analysis and recommendations</p>
      </div>

      {/* Tab Navigation */}
      {(viewMode === 'new' || viewMode === 'review') && (
        <div className="flex gap-3 border-b border-slate-800">
          <button
            onClick={() => {
              setViewMode('new');
            }}
            className={`px-4 py-3 font-medium text-sm transition-colors ${
              viewMode === 'new'
                ? 'text-blue-400 border-b-2 border-blue-400 -mb-[2px]'
                : 'text-slate-400 hover:text-slate-300'
            }`}
          >
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4" />
              Generate Report
            </div>
          </button>
          <button
            onClick={() => {
              setViewMode('review');
            }}
            className={`px-4 py-3 font-medium text-sm transition-colors ${
              viewMode === 'review'
                ? 'text-blue-400 border-b-2 border-blue-400 -mb-[2px]'
                : 'text-slate-400 hover:text-slate-300'
            }`}
          >
            <div className="flex items-center gap-2">
              <Eye className="w-4 h-4" />
              Saved Reports ({previousReports.length})
            </div>
          </button>
        </div>
      )}

      {/* GENERATE NEW MODE */}
      {viewMode === 'new' && (
        <>
          {/* Input Panel */}
          <div className="border rounded-xl p-5" style={REPORT_SURFACES.sectionMid}>
            <div className="flex items-end gap-4 mb-4">
              <div className="flex-1">
                <label className="text-slate-400 text-xs mb-2 block">Select Portfolio</label>
                <select
                  value={selectedPortfolioId}
                  onChange={(e) => setSelectedPortfolioId(e.target.value)}
                  disabled={isGenerating}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2.5 text-slate-100 focus:outline-none focus:border-slate-600 focus:ring-1 focus:ring-slate-600 transition-opacity disabled:opacity-60 disabled:cursor-default"
                >
                  <option value="">Choose a portfolio to analyze...</option>
                  {portfolios.map((portfolio) => (
                    <option key={portfolio.id} value={portfolio.id}>
                      {portfolio.name} ({portfolio.items.length} assets, ${portfolio.totalAllocated.toLocaleString()})
                    </option>
                  ))}
                </select>
              </div>

              <div className="w-40">
                <label className="text-slate-400 text-xs mb-2 block">Time Horizon</label>
                <select
                  value={timeHorizon}
                  onChange={(e) => setTimeHorizon(e.target.value)}
                  disabled={isGenerating}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-slate-100 text-sm focus:outline-none focus:border-slate-600 transition-opacity disabled:opacity-60 disabled:cursor-default"
                >
                  <option>30 Days</option>
                  <option>90 Days</option>
                  <option>6 Months</option>
                  <option>1 Year</option>
                </select>
              </div>

              <button
                onClick={handleGenerateReport}
                disabled={!selectedPortfolioId || isGenerating}
                style={isProgressActive ? {
                  background: `linear-gradient(to right, #2563eb ${generationProgress}%, #1e3a8a ${generationProgress}%)`,
                } : undefined}
                className="relative overflow-hidden bg-blue-600 hover:bg-blue-700 text-white h-[42px] px-8 rounded-md text-sm font-medium disabled:opacity-50 disabled:cursor-default flex items-center justify-center shrink-0"
              >
                <span style={{ visibility: isGenerating ? 'hidden' : 'visible' }} className="whitespace-nowrap">Generate Report</span>
                {isGenerating && (
                  <span className="absolute inset-0 flex items-center justify-center whitespace-nowrap">Generating</span>
                )}
              </button>
            </div>

            <div>
              <label className="text-slate-400 text-xs mb-2 block">Notes (Optional)</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                disabled={isGenerating}
                placeholder="Add any specific analysis requirements or notes here..."
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2.5 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-slate-600 focus:ring-1 focus:ring-slate-600 text-sm resize-none transition-opacity disabled:opacity-60 disabled:cursor-default"
                rows={3}
              />
            </div>

            {generationError && (
              <div
                className="mt-4 rounded-lg border px-4 py-3 text-sm"
                style={{ backgroundColor: 'rgba(127, 29, 29, 0.18)', borderColor: 'rgba(239, 68, 68, 0.35)', color: '#fca5a5' }}
              >
                {generationError}
              </div>
            )}
          </div>

          {/* Empty State */}
          {portfolios.length === 0 && (
            <div className="flex items-center justify-center min-h-[400px] mt-16">
              <div className="text-center bg-slate-900/50 border border-slate-800 rounded-lg p-8 max-w-sm mx-auto">
                <h2 className="text-lg font-semibold text-slate-300 mb-2">No Portfolios Yet</h2>
                <p className="text-slate-400 text-sm">
                  Create your first portfolio by building and saving assets in the Portfolio Builder.
                </p>
              </div>
            </div>
          )}
        </>
      )}

      {/* REVIEW PREVIOUS MODE */}
      {viewMode === 'review' && (
        <>
          {previousReports.length === 0 ? (
            <div className="flex items-center justify-center min-h-[400px]">
              <div className="text-center max-w-md">
                <div className="w-16 h-16 rounded-full border border-slate-700 flex items-center justify-center mx-auto mb-4" style={{ backgroundColor: 'rgba(30, 41, 59, 0.5)' }}>
                  <Calendar className="w-8 h-8 text-slate-500" />
                </div>
                <h2 className="text-slate-100 text-xl mb-2">No Reports Yet</h2>
                <p className="text-slate-400 text-sm">Generate your first investment report to see your analysis history here.</p>
                <button
                  onClick={() => setViewMode('new')}
                  className="mt-6 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors"
                >
                  Generate First Report
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {previousReports.map((report) => {
                const portfolioForReport = portfolios.find((portfolio) => portfolio.id === report.portfolioId);

                return (
                  <div
                    key={report.id}
                    className="border rounded-xl p-6 transition-colors cursor-pointer"
                    style={REPORT_SURFACES.sectionStrong}
                    onClick={() => handleViewReport(report.id)}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="mb-5">
                          <h3 className="text-slate-100 text-2xl font-semibold tracking-tight">{report.portfolioName}</h3>
                        </div>

                        <div className="grid grid-cols-5 gap-4 pt-5">
                          <div>
                            <div className="text-slate-500 text-xs mb-1.5">Generated Time</div>
                            <div className="text-slate-200 text-sm font-medium">
                              {new Date(report.timestamp).toLocaleDateString()} {new Date(report.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </div>
                          </div>
                          <div>
                            <div className="text-slate-500 text-xs mb-1.5">Total Capital</div>
                            <div className="text-slate-200 text-sm font-medium">
                              ${portfolioForReport?.budget.toLocaleString() || '0'}
                            </div>
                          </div>
                          <div>
                            <div className="text-slate-500 text-xs mb-1.5">Holdings</div>
                            <div className="text-slate-200 text-sm font-medium">{portfolioForReport?.items.length || 0}</div>
                          </div>
                          <div>
                            <div className="text-slate-500 text-xs mb-1.5">Time Horizon</div>
                            <div className="text-slate-200 text-sm font-medium">{report.timeHorizon}</div>
                          </div>
                          <div>
                            <div className="text-slate-500 text-xs mb-1.5">Notes</div>
                            <div className="text-slate-300 text-sm italic truncate">
                              {report.notes ? `"${report.notes}"` : 'None'}
                            </div>
                          </div>
                        </div>
                      </div>

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteReport(report.id);
                        }}
                        className="p-2 text-slate-400 hover:text-red-400 transition-colors shrink-0"
                        title="Delete report"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* DETAIL VIEW MODE */}
      {viewMode === 'detail' && selectedReport && reportPortfolio && (
        <>
          <div className="flex items-center justify-between mb-4">
            <button
              onClick={handleBackToReview}
              className="text-blue-400 hover:text-blue-300 text-sm font-medium flex items-center gap-1 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              Back to History
            </button>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                className="flex items-center gap-2 border-blue-700 text-blue-400 hover:text-white transition-colors disabled:cursor-wait disabled:opacity-70"
                style={{ backgroundColor: 'rgba(30, 58, 138, 0.2)' }}
                onClick={handleOpenInChat}
              >
                <MessageSquare className="w-4 h-4" />
                Open in Chat
              </Button>
              <Button
                variant="outline"
                className="flex items-center gap-2 border-blue-700 text-blue-400 hover:text-white transition-colors"
                style={{ backgroundColor: 'rgba(30, 58, 138, 0.2)' }}
                onClick={handleOpenReportDocument}
              >
                <Download className="w-4 h-4" />
                Download Report
              </Button>
            </div>
          </div>
          {renderReportContent(reportPortfolio, selectedReport)}
        </>
      )}
    </div>
  );
}
