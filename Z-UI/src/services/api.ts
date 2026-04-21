import { langGraphApi } from '../lib/apiBase';

export interface Message {
  sender: string;
  text: string;
  isUser: boolean;
  agent?: string;
  images?: MessageImage[];
  lightweightCharts?: LightweightChartSpec[];
  messageId?: string;
  hasToolCalls?: boolean;
}

// Payload shape expected by LangGraph runs.
// We support passing either a single user string (legacy) or full message history.
export type GraphInputMessageRole = 'system' | 'user' | 'assistant';

export interface GraphInputMessage {
  role: GraphInputMessageRole;
  content: string;
}

type GraphInput = { messages: GraphInputMessage[] };

export interface MessageImage {
  url: string;
  name?: string;
}

export type LightweightSeriesType =
  | 'line'
  | 'area'
  | 'baseline'
  | 'bar'
  | 'candlestick'
  | 'histogram';

export interface LightweightChartSeries {
  type: LightweightSeriesType;
  data: Array<Record<string, any>>;
  options?: Record<string, any>;
}

export interface LightweightChartSpec {
  id?: string;
  title?: string;
  chart_type?: string;
  options?: Record<string, any>;
  series: LightweightChartSeries[];
}

export interface ThreadResponse {
  thread_id: string;
}

export interface StreamEvent {
  event: string;
  data: any;
}

export interface ThreadInfo {
  thread_id: string;
  created_at: string;
  metadata: Record<string, any>;
}

export interface InvestmentReportHighlightCard {
  score: string;
  explanation: string;
}

export interface InvestmentReportPhase1DecisionCard {
  value: string;
  explanation: string;
}

// Frozen implementation contract for the live Generate Report flow.
// Do not change this shape without a deliberate Phase 2 migration.
export const INVESTMENT_REPORT_PHASE1_CONTRACT_VERSION = 'phase1' as const;
export type InvestmentReportSourceMarker =
  | 'live_phase1'
  | 'fallback_completed';

export interface InvestmentReportPhase1Payload {
  portfolio_highlights: {
    theme_exposure: InvestmentReportHighlightCard;
    diversification: InvestmentReportHighlightCard;
    concentration: InvestmentReportHighlightCard;
    volatility_profile: InvestmentReportHighlightCard;
  };
  ai_committee_summary: {
    recommendation: InvestmentReportPhase1DecisionCard;
    position_size: InvestmentReportPhase1DecisionCard;
    risk_level: InvestmentReportPhase1DecisionCard;
    conviction: InvestmentReportPhase1DecisionCard;
    thesis: {
      title: string;
      body: string;
    };
    summary_points: string[];
  };
  research_agent: {
    key_insight: string[];
    key_drivers: string[];
    implications: string;
  };
  quant_agent: {
    metrics: string[];
    indicators: string[];
    correlation: {
      summary: string;
      interpretation: string;
    };
    concentration: {
      conclusion: string;
    };
  };
  risk_agent: {
    structural_risks: string[];
    risk_metrics: string[];
    scenario_analysis: Array<{
      label: string;
      description: string;
    }>;
    guardrails: string[];
  };
  references: {
    market_data: string;
    model_assumptions: string;
  };
}

export interface InvestmentReportPortfolioInput {
  id?: string;
  name: string;
  budget: number;
  items: Array<{ ticker: string; name: string; amount: number }>;
  totalAllocated: number;
  createdAt?: string;
  updatedAt?: string;
}

interface InvestmentReportGroundingContext {
  generated_at: string;
  time_horizon: string;
  note: string;
  risk_preference: string;
  total_capital: number;
  holdings_count: number;
  top_3_concentration_pct: string;
  largest_holding_ticker: string;
  largest_holding_allocation_pct: string;
  crypto_allocation_pct: string;
  broad_market_anchor_ticker: string;
  broad_market_anchor_allocation_pct: string;
  references_market_data: string;
  references_model_assumptions: string;
}

const DATA_URI_RE = /data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=\s]+/g;

function normalizeMessageText(content: any): string {
  if (typeof content === 'string') return content;

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object') {
          if (typeof part.text === 'string') return part.text;
          if (part.type === 'text' && typeof part.text === 'string') return part.text;
        }
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }

  if (content && typeof content === 'object') {
    if (content.kwargs?.content !== undefined) {
      return normalizeMessageText(content.kwargs.content);
    }
    if (typeof content.text === 'string') return content.text;
    if (typeof content.content === 'string') return content.content;
    try {
      return JSON.stringify(content, null, 2);
    } catch {
      return String(content);
    }
  }

  return '';
}

function classifyReportAssetType(ticker: string, name: string): 'ETF' | 'Stock' | 'Crypto' | 'Option' {
  const upperTicker = ticker.toUpperCase();
  const upperName = name.toUpperCase();

  if (
    upperTicker.includes('BTC') ||
    upperTicker.includes('ETH') ||
    upperName.includes('BITCOIN') ||
    upperName.includes('CRYPTO')
  ) {
    return 'Crypto';
  }

  if (
    /\d{6}[CP]\d+/i.test(ticker) ||
    /\bCALL\b/i.test(name) ||
    /\bPUT\b/i.test(name) ||
    /\bOPTION\b/i.test(name)
  ) {
    return 'Option';
  }

  if (
    upperName.includes('ETF') ||
    upperName.includes('FUND') ||
    upperTicker === 'SPY' ||
    upperTicker === 'QQQ' ||
    upperTicker === 'DIA' ||
    upperTicker === 'IWM'
  ) {
    return 'ETF';
  }

  return 'Stock';
}

function buildInvestmentReportGroundingContext(
  portfolio: InvestmentReportPortfolioInput,
  context?: {
    generatedAt?: string;
    timeHorizon?: string;
    note?: string;
    riskPreference?: string;
  }
): InvestmentReportGroundingContext {
  const totalCapital =
    portfolio.totalAllocated ||
    portfolio.budget ||
    portfolio.items.reduce((sum, item) => sum + item.amount, 0);

  const holdings = portfolio.items
    .map((item) => ({
      ...item,
      assetType: classifyReportAssetType(item.ticker, item.name),
      allocationPct: totalCapital > 0 ? (item.amount / totalCapital) * 100 : 0,
    }))
    .sort((a, b) => b.allocationPct - a.allocationPct);

  const top3 = holdings.slice(0, 3);
  const largest = holdings[0];
  const top3Concentration = top3.reduce((sum, item) => sum + item.allocationPct, 0);
  const cryptoAllocation = holdings
    .filter((item) => item.assetType === 'Crypto')
    .reduce((sum, item) => sum + item.allocationPct, 0);
  const broadMarketAnchor =
    holdings.find((item) => item.ticker.toUpperCase() === 'SPY') ||
    holdings.find((item) => item.assetType === 'ETF');

  const generatedAt = context?.generatedAt || new Date().toISOString();

  return {
    generated_at: generatedAt,
    time_horizon: context?.timeHorizon || '',
    note: context?.note || '',
    risk_preference: context?.riskPreference || '',
    total_capital: totalCapital,
    holdings_count: holdings.length,
    top_3_concentration_pct: top3Concentration.toFixed(1),
    largest_holding_ticker: largest?.ticker || '',
    largest_holding_allocation_pct: largest ? largest.allocationPct.toFixed(1) : '0.0',
    crypto_allocation_pct: cryptoAllocation.toFixed(1),
    broad_market_anchor_ticker: broadMarketAnchor?.ticker || '',
    broad_market_anchor_allocation_pct: broadMarketAnchor ? broadMarketAnchor.allocationPct.toFixed(1) : '0.0',
    references_market_data: `Portfolio composition and user-supplied position sizes reflected as of ${generatedAt}.`,
    references_model_assumptions:
      'This report combines deterministic portfolio-structure analysis with qualitative committee reasoning.',
  };
}

function toDataUri(base64OrUri: string, mediaType = 'image/png'): string {
  const value = base64OrUri.trim();
  if (value.startsWith('data:image/')) return value;
  return `data:${mediaType};base64,${value}`;
}

function extractImagesDeep(value: any, acc: MessageImage[]) {
  if (!value) return;

  if (typeof value === 'string') {
    const matches = value.match(DATA_URI_RE);
    if (matches) {
      for (const match of matches) {
        acc.push({ url: match.replace(/\s+/g, '') });
      }
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) extractImagesDeep(item, acc);
    return;
  }

  if (typeof value !== 'object') return;

  if (value.type === 'image' && value.source?.type === 'base64' && typeof value.source?.data === 'string') {
    acc.push({
      name: typeof value.name === 'string' ? value.name : undefined,
      url: toDataUri(value.source.data, value.source.media_type || 'image/png'),
    });
  }

  if (typeof value.data_uri === 'string') {
    acc.push({
      name: typeof value.name === 'string' ? value.name : undefined,
      url: toDataUri(value.data_uri),
    });
  }

  for (const key of Object.keys(value)) {
    extractImagesDeep(value[key], acc);
  }
}

function dedupeImages(images: MessageImage[]): MessageImage[] {
  const seen = new Set<string>();
  const out: MessageImage[] = [];

  for (const image of images) {
    if (!image.url || seen.has(image.url)) continue;
    seen.add(image.url);
    out.push(image);
  }
  return out;
}

function normalizeSeriesType(value: any): LightweightSeriesType | null {
  if (typeof value !== 'string') return null;
  const v = value.toLowerCase();
  if (
    v === 'line' ||
    v === 'area' ||
    v === 'baseline' ||
    v === 'bar' ||
    v === 'candlestick' ||
    v === 'histogram'
  ) {
    return v;
  }
  return null;
}

function normalizeChartSpec(value: any): LightweightChartSpec | null {
  if (!value || typeof value !== 'object' || !Array.isArray(value.series)) return null;

  const series: LightweightChartSeries[] = [];
  for (const item of value.series) {
    const type = normalizeSeriesType(item?.type);
    if (!type || !Array.isArray(item?.data)) continue;
    series.push({
      type,
      data: item.data,
      options: item?.options && typeof item.options === 'object' ? item.options : undefined,
    });
  }

  if (series.length === 0) return null;
  return {
    id: typeof value.id === 'string' ? value.id : undefined,
    title: typeof value.title === 'string' ? value.title : undefined,
    chart_type: typeof value.chart_type === 'string' ? value.chart_type : undefined,
    options: value?.options && typeof value.options === 'object' ? value.options : undefined,
    series,
  };
}

function extractLightweightChartsDeep(value: any, acc: LightweightChartSpec[]) {
  if (!value) return;
  if (Array.isArray(value)) {
    for (const item of value) extractLightweightChartsDeep(item, acc);
    return;
  }
  if (typeof value !== 'object') return;

  if (value.type === 'lightweight_charts' && Array.isArray(value.charts)) {
    for (const chart of value.charts) {
      const normalized = normalizeChartSpec(chart);
      if (normalized) acc.push(normalized);
    }
  }

  const direct = normalizeChartSpec(value);
  if (direct) acc.push(direct);

  for (const key of Object.keys(value)) {
    extractLightweightChartsDeep(value[key], acc);
  }
}

function dedupeLightweightCharts(charts: LightweightChartSpec[]): LightweightChartSpec[] {
  const seen = new Set<string>();
  const out: LightweightChartSpec[] = [];
  for (const chart of charts) {
    const key = `${chart.id || ''}|${chart.title || ''}|${chart.series.map((s) => s.type).join(',')}|${chart.series.length}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(chart);
  }
  return out;
}

function parseMessageContent(rawMessage: any): { text: string; images: MessageImage[]; lightweightCharts: LightweightChartSpec[] } {
  const text = normalizeMessageText(rawMessage?.content);
  const images: MessageImage[] = [];
  const lightweightCharts: LightweightChartSpec[] = [];

  extractImagesDeep(rawMessage?.artifact, images);
  extractImagesDeep(rawMessage?.additional_kwargs, images);
  extractImagesDeep(rawMessage?.content, images);
  extractLightweightChartsDeep(rawMessage?.artifact, lightweightCharts);
  extractLightweightChartsDeep(rawMessage?.additional_kwargs, lightweightCharts);
  extractLightweightChartsDeep(rawMessage?.content, lightweightCharts);

  if (typeof rawMessage?.content === 'string') {
    try {
      const parsed = JSON.parse(rawMessage.content);
      extractImagesDeep(parsed, images);
      extractLightweightChartsDeep(parsed, lightweightCharts);
    } catch {
      // Non-JSON string content; ignore.
    }
  }

  return {
    text,
    images: dedupeImages(images),
    lightweightCharts: dedupeLightweightCharts(lightweightCharts),
  };
}

function normalizeRawMessage(rawMessage: any): any {
  if (!rawMessage || typeof rawMessage !== 'object') return rawMessage;
  if (rawMessage.type === 'constructor' && rawMessage.kwargs) {
    return rawMessage.kwargs;
  }
  return rawMessage;
}

function buildAssistantMessage(rawMessage: any, defaultAgent: string): Message | null {
  const message = normalizeRawMessage(rawMessage);
  if (!message) return null;

  const messageType = message.type || message.role;
  if (messageType === 'human' || messageType === 'user') return null;

  const { text, images, lightweightCharts } = parseMessageContent(message);
  const isToolMessage = messageType === 'tool';
  if (!text && images.length === 0 && lightweightCharts.length === 0) return null;
  if (isToolMessage && images.length === 0 && lightweightCharts.length === 0) return null;

  const agentName = isToolMessage
    ? defaultAgent
    : (message.name ? mapNodeToAgent(message.name) : defaultAgent);
  const hasToolCalls = !isToolMessage && (
    (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) ||
    message.additional_kwargs?.function_call != null
  );
  return {
    sender: agentName,
    text: text || 'Generated chart output.',
    isUser: false,
    agent: agentName,
    images,
    lightweightCharts,
    messageId:
      message.id ||
      (typeof message.tool_call_id === 'string' ? `${agentName}:${message.tool_call_id}` : undefined),
    hasToolCalls,
  };
}

function messageFingerprint(message: Message): string {
  if (message.messageId) return `id:${message.messageId}`;
  const imagePart = (message.images || [])
    .map((image) => `${image.name || ''}:${image.url.length}:${image.url.slice(0, 32)}`)
    .join('|');
  const chartPart = (message.lightweightCharts || [])
    .map((chart) => `${chart.id || chart.title || 'chart'}:${chart.series.length}`)
    .join('|');
  return `${message.agent || message.sender}|${message.text}|${imagePart}|${chartPart}`;
}

function dedupeMessages(messages: Message[]): Message[] {
  const seen = new Set<string>();
  const out: Message[] = [];
  for (const message of messages) {
    const key = messageFingerprint(message);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(message);
  }
  return out;
}

// Create a new thread
export async function createThread(): Promise<string> {
  return createThreadWithMetadata();
}

export async function createThreadWithMetadata(metadata?: Record<string, any>): Promise<string> {
  const response = await fetch(langGraphApi('/threads'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(metadata ? { metadata } : {}),
  });

  if (!response.ok) {
    throw new Error(`Failed to create thread: ${response.statusText}`);
  }

  const data: ThreadResponse = await response.json();
  return data.thread_id;
}

// Create a new thread with user_id metadata
export async function createThreadWithUser(userId: string): Promise<string> {
  return createThreadWithMetadata({ user_id: userId });
}

// List threads for a user
export async function listThreads(userId: string): Promise<ThreadInfo[]> {
  const response = await fetch(langGraphApi('/threads/search'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      metadata: { user_id: userId },
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to list threads: ${response.statusText}`);
  }

  return response.json();
}

// Get thread state (including messages)
export async function getThreadState(threadId: string): Promise<Message[]> {
  const response = await fetch(langGraphApi(`/threads/${threadId}/state`), {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  });

  if (!response.ok) {
    throw new Error(`Failed to get thread state: ${response.statusText}`);
  }

  const state = await response.json();

  // Parse messages from thread state
  const messages: Message[] = [];
  if (state.values?.messages && Array.isArray(state.values.messages)) {
    for (const msg of state.values.messages) {
      if (msg.type === 'human' || msg.role === 'user') {
        messages.push({
          sender: 'User',
          text: normalizeMessageText(msg.content),
          isUser: true,
        });
      } else {
        const parsed = buildAssistantMessage(msg, msg.name ? mapNodeToAgent(msg.name) : 'Supervisor');
        if (parsed) messages.push(parsed);
      }
    }
  }

  return messages;
}

// Send message and stream response
export async function sendMessage(
  threadId: string,
  message: string,
  onEvent: (event: StreamEvent) => void
): Promise<void> {
  return sendMessageToGraph(threadId, message, 'supervisor', onEvent);
}

// Send message to a specific graph and stream response
export async function sendMessageToGraph(
  threadId: string,
  message: string | GraphInputMessage[],
  graphId: string,
  onEvent: (event: StreamEvent) => void
): Promise<void> {
  const input: GraphInput = {
    messages: typeof message === 'string'
      ? [{ role: 'user', content: message }]
      : message,
  };

  const response = await fetch(langGraphApi(`/threads/${threadId}/runs/stream`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      assistant_id: graphId,
      input: {
        messages: input.messages,
      },
      stream_mode: 'updates',
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    const details = errorText.trim() || response.statusText || 'No response body';
    throw new Error(`LangGraph stream failed (${response.status}): ${details}`);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('No response body');
  }

  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.startsWith('event:')) {
        continue;
      }
      if (line.startsWith('data:')) {
        try {
          const data = JSON.parse(line.slice(5).trim());
          onEvent({ event: 'data', data });
        } catch (e) {
          // Skip invalid JSON
        }
      }
    }
  }

  const trailing = buffer.trim();
  if (trailing.startsWith('data:')) {
    try {
      const data = JSON.parse(trailing.slice(5).trim());
      onEvent({ event: 'data', data });
    } catch {
      // Ignore incomplete trailing JSON.
    }
  }
}

// Run a graph and wait for completion (blocking), returns all messages
export async function runAndWait(
  threadId: string,
  message: string | GraphInputMessage[],
  graphId: string
): Promise<Message[]> {
  const input: GraphInput = {
    messages: typeof message === 'string'
      ? [{ role: 'user', content: message }]
      : message,
  };

  const response = await fetch(langGraphApi(`/threads/${threadId}/runs/wait`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      assistant_id: graphId,
      input: {
        messages: input.messages,
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Run failed: ${response.statusText}`);
  }

  const result = await response.json();
  // /runs/wait returns { messages: [...] } directly
  const rawMessages: any[] = result?.messages ?? [];
  const messages: Message[] = [];

  for (const msg of rawMessages) {
    if (msg.type === 'human' || msg.role === 'user') continue;
    const parsed = buildAssistantMessage(msg, msg.name ? mapNodeToAgent(msg.name) : graphId);
    if (parsed) messages.push(parsed);
  }

  return messages;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isHighlightCard(value: unknown): value is InvestmentReportHighlightCard {
  return isRecord(value) && typeof value.score === 'string' && typeof value.explanation === 'string';
}

function isDecisionCard(value: unknown): value is InvestmentReportPhase1DecisionCard {
  return isRecord(value) && typeof value.value === 'string' && typeof value.explanation === 'string';
}

function isScenarioList(value: unknown): value is Array<{ label: string; description: string }> {
  return Array.isArray(value) && value.every((item) => isRecord(item) && typeof item.label === 'string' && typeof item.description === 'string');
}

export function isInvestmentReportPhase1Payload(value: unknown): value is InvestmentReportPhase1Payload {
  if (!isRecord(value)) return false;
  if (!isRecord(value.portfolio_highlights)) return false;
  if (!isRecord(value.ai_committee_summary)) return false;
  if (!isRecord(value.research_agent)) return false;
  if (!isRecord(value.quant_agent)) return false;
  if (!isRecord(value.risk_agent)) return false;
  if (!isRecord(value.references)) return false;

  return (
    isHighlightCard(value.portfolio_highlights.theme_exposure) &&
    isHighlightCard(value.portfolio_highlights.diversification) &&
    isHighlightCard(value.portfolio_highlights.concentration) &&
    isHighlightCard(value.portfolio_highlights.volatility_profile) &&
    isDecisionCard(value.ai_committee_summary.recommendation) &&
    isDecisionCard(value.ai_committee_summary.position_size) &&
    isDecisionCard(value.ai_committee_summary.risk_level) &&
    isDecisionCard(value.ai_committee_summary.conviction) &&
    isRecord(value.ai_committee_summary.thesis) &&
    typeof value.ai_committee_summary.thesis.title === 'string' &&
    typeof value.ai_committee_summary.thesis.body === 'string' &&
    isStringArray(value.ai_committee_summary.summary_points) &&
    isRecord(value.research_agent) &&
    isStringArray(value.research_agent.key_insight) &&
    isStringArray(value.research_agent.key_drivers) &&
    typeof value.research_agent.implications === 'string' &&
    isRecord(value.quant_agent.correlation) &&
    isStringArray(value.quant_agent.metrics) &&
    isStringArray(value.quant_agent.indicators) &&
    typeof value.quant_agent.correlation.summary === 'string' &&
    typeof value.quant_agent.correlation.interpretation === 'string' &&
    isRecord(value.quant_agent.concentration) &&
    typeof value.quant_agent.concentration.conclusion === 'string' &&
    isStringArray(value.risk_agent.structural_risks) &&
    isStringArray(value.risk_agent.risk_metrics) &&
    isScenarioList(value.risk_agent.scenario_analysis) &&
    isStringArray(value.risk_agent.guardrails) &&
    typeof value.references.market_data === 'string' &&
    typeof value.references.model_assumptions === 'string'
  );
}

export function normalizeInvestmentReportPhase1Payload(value: unknown): InvestmentReportPhase1Payload | undefined {
  if (isInvestmentReportPhase1Payload(value)) {
    return value;
  }

  if (!isRecord(value)) return undefined;
  if (
    !isRecord(value.portfolio_highlights) ||
    !isRecord(value.ai_committee_summary) ||
    !isRecord(value.research_agent) ||
    !isRecord(value.quant_agent) ||
    !isRecord(value.risk_agent) ||
    !isRecord(value.references)
  ) {
    return undefined;
  }

  const normalized = {
    portfolio_highlights: value.portfolio_highlights,
    ai_committee_summary: value.ai_committee_summary,
    research_agent: value.research_agent,
    quant_agent: value.quant_agent,
    risk_agent: value.risk_agent,
    references: {
      market_data: value.references.market_data,
      model_assumptions: value.references.model_assumptions,
    },
  };

  return isInvestmentReportPhase1Payload(normalized) ? normalized : undefined;
}

export function parseInvestmentReportPayload(rawText: string): {
  payload?: InvestmentReportPhase1Payload;
  error?: string;
  source?: 'phase1';
} {
  let parsed: unknown;

  try {
    parsed = JSON.parse(rawText);
  } catch {
    return { error: 'Invalid JSON response. Expected a valid report payload.' };
  }

  const normalized = normalizeInvestmentReportPhase1Payload(parsed);
  if (normalized) {
    return { payload: normalized, source: 'phase1' };
  }

  return {
    error: 'Unsupported report format. Expected the Phase 1 investment report contract.',
  };
}

function buildInvestmentReportPrompt(
  portfolio: InvestmentReportPortfolioInput,
  context?: {
    generatedAt?: string;
    timeHorizon?: string;
    note?: string;
    riskPreference?: string;
  }
): string {
  const grounding = buildInvestmentReportGroundingContext(portfolio, context);

  return `Generate a minimal structured Investment Report payload in valid JSON.

IMPORTANT WORKFLOW:
- Before you produce the final JSON, call the committee.
- If the system exposes a committee tool (e.g., run_committee), call it with loops=2 and a concise instruction to analyze the provided portfolio + context and produce inputs for each required section (committee summary, research, quant, risk).
- If a committee tool is not available, explicitly consult ResearchAgent, QuantAgent, and RiskManagementAgent and integrate their findings.
- Then synthesize the committee outputs into the required Phase 1 JSON payload.

Use the following portfolio input as the source of truth.

Use the following analysis context when populating metadata and committee decisions:

${JSON.stringify(grounding, null, 2)}

Return ONLY valid JSON.
Do not include markdown.
Do not include explanations before or after the JSON.
Do not wrap the JSON in code fences.

The output must match exactly this structure:

{
  "portfolio_highlights": {
    "theme_exposure": {
      "score": "string",
      "explanation": "string"
    },
    "diversification": {
      "score": "string",
      "explanation": "string"
    },
    "concentration": {
      "score": "string",
      "explanation": "string"
    },
    "volatility_profile": {
      "score": "string",
      "explanation": "string"
    }
  },
  "ai_committee_summary": {
    "recommendation": {
      "value": "Buy | Hold | Reduce | Sell",
      "explanation": "string"
    },
    "position_size": {
      "value": "Small | Medium | Large",
      "explanation": "string"
    },
    "risk_level": {
      "value": "Conservative | Balanced | Aggressive",
      "explanation": "string"
    },
    "conviction": {
      "value": "Low | Moderate | High",
      "explanation": "string"
    },
    "thesis": {
      "title": "string",
      "body": "string"
    },
    "summary_points": ["string"]
  },
  "research_agent": {
    "key_insight": ["string"],
    "key_drivers": ["string"],
    "implications": "string"
  },
  "quant_agent": {
    "metrics": ["string"],
    "indicators": ["string"],
    "correlation": {
      "summary": "string",
      "interpretation": "string"
    },
    "concentration": {
      "conclusion": "string"
    }
  },
  "risk_agent": {
    "structural_risks": ["string"],
    "risk_metrics": ["string"],
    "scenario_analysis": [
      {
        "label": "string",
        "description": "string"
      }
    ],
    "guardrails": ["string"]
  },
  "references": {
    "market_data": "string",
    "model_assumptions": "string"
  }
}

Additional grounding requirements:
- recommendation.value must be exactly one of: Buy, Hold, Reduce, Sell.
- position_size.value must be exactly one of: Small, Medium, Large.
- risk_level.value must be exactly one of: Conservative, Balanced, Aggressive.
- risk_preference is context only. It may inform the analysis, but risk_level must reflect the portfolio's assessed risk posture rather than simply mirroring the input preference.
- conviction.value must be exactly one of: Low, Moderate, High.
- For ai_committee_summary.position_size.explanation, explain why the selected size fits the portfolio's current concentration, broad-market anchor, and 90-day mandate. Do not mention full-budget deployment or retail-style allocation percentages.
- Do not fabricate precise numeric metrics such as beta, Sharpe ratio, VaR, max drawdown, support levels, or stop-loss prices unless they are explicitly supplied by a real tool-backed analysis.
- If exact numeric quant/risk metrics are not available, use qualitative grounded statements instead.
- quant_agent.metrics should describe structural portfolio diagnostics only, such as concentration, diversification limits, thematic dependence, or broad-market anchoring. Do not use pseudo-metric labels.
- quant_agent.indicators should describe only grounded qualitative trend or leadership observations. Do not reference RSI, moving averages, crossover states, or overbought/oversold language unless those indicator outputs are explicitly provided.
- scenario_analysis must contain exactly three qualitative scenarios labeled Bull Case, Base Case, and Bear Case.
- portfolio_highlights.concentration.explanation must be anchored to the actual concentration structure in the context above, including the top_3_concentration_pct and largest_holding_ticker when relevant.
- guardrails should be qualitative portfolio-level triggers, not invented numeric stop-loss rules.
- risk_agent.guardrails should be based on concentration, thematic dependence, diversification limits, or crypto exposure from the provided context.
- references.market_data must exactly equal: "${grounding.references_market_data}"
- references.model_assumptions must exactly equal: "${grounding.references_model_assumptions}"

Portfolio input:
${JSON.stringify(portfolio, null, 2)}`;
}

function extractInvestmentReportPayload(messages: Message[]): InvestmentReportPhase1Payload | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const candidate = messages[i];
    if (candidate.isUser || !candidate.text) continue;
    const { payload } = parseInvestmentReportPayload(candidate.text);
    if (payload) return payload;
  }

  return null;
}

export async function generateInvestmentReport(
  portfolio: InvestmentReportPortfolioInput,
  options?: {
    userId?: string;
    generatedAt?: string;
    timeHorizon?: string;
    note?: string;
    riskPreference?: string;
  }
): Promise<InvestmentReportPhase1Payload> {
  const generatedAt = options?.generatedAt || new Date().toISOString();
  const metadata: Record<string, any> = {
    request_type: 'investment_report',
    graph_id: 'report_supervisor',
    portfolio_name: portfolio.name,
    generated_at: generatedAt,
  };

  if (portfolio.id) {
    metadata.portfolio_id = portfolio.id;
  }

  if (options?.userId) {
    metadata.user_id = options.userId;
  }

  const threadId = await createThreadWithMetadata(metadata);
  const prompt = buildInvestmentReportPrompt(portfolio, {
    generatedAt,
    timeHorizon: options?.timeHorizon,
    note: options?.note,
    riskPreference: options?.riskPreference,
  });
  const messages = await runAndWait(threadId, prompt, 'report_supervisor');
  const payload = extractInvestmentReportPayload(messages);

  if (!payload) {
    throw new Error('Report supervisor did not return a valid Phase 1 report JSON payload.');
  }

  return payload;
}

// Parse agent response from stream data
export function parseAgentResponse(data: any): Message[] {
  const collected: Message[] = [];

  const collectFromMessages = (rawMessages: any[], defaultAgent: string) => {
    for (const rawMessage of rawMessages) {
      const parsed = buildAssistantMessage(rawMessage, defaultAgent);
      if (parsed) collected.push(parsed);
    }
  };

  // Handle different response formats from LangGraph
  if (data.messages && Array.isArray(data.messages)) {
    const agentName = getAgentNameFromData(data);
    collectFromMessages(data.messages, agentName);
  }

  // Handle node output format
  for (const key of Object.keys(data)) {
    if (key !== '__pregel_pull' && key !== '__pregel_push') {
      const nodeData = data[key];
      if (nodeData?.messages && Array.isArray(nodeData.messages)) {
        collectFromMessages(nodeData.messages, mapNodeToAgent(key));
      }
    }
  }

  return dedupeMessages(collected);
}

function getAgentNameFromData(data: any): string {
  if (data.name) return mapNodeToAgent(data.name);
  return 'Supervisor';
}

// Run a graph using SSE streaming, collect all messages, return as Promise<Message[]>
export async function runAgentAndCollect(
  threadId: string,
  message: string | GraphInputMessage[],
  graphId: string
): Promise<Message[]> {
  const collected: Message[] = [];
  const seenKeys = new Set<string>();

  await sendMessageToGraph(threadId, message, graphId, (event) => {
    const parsed = parseAgentResponse(event.data);
    for (const msg of parsed) {
      const key = msg.messageId || `${msg.agent ?? msg.sender}|${String(msg.text).slice(0, 80)}`;
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        collected.push(msg);
      }
    }
  });

  return dedupeMessages(collected);
}

function mapNodeToAgent(nodeName: string): string {
  const mapping: Record<string, string> = {
    model: 'Committee',       // LangGraph internal node name for supervisor LLM
    supervisor: 'Committee',
    SupervisorAgent: 'Committee',
    research_agent: 'Research',
    ResearchAgent: 'Research',
    quant_agent: 'Quant',
    QuantAgent: 'Quant',
    risk_management_agent: 'Risk',
    RiskManagementAgent: 'Risk',
  };
  return mapping[nodeName] || nodeName;
}
