import { Download, Edit2, Loader2, Paperclip, Plus, Send, Trash2, X } from 'lucide-react';
import { memo, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useLocation, useNavigate } from 'react-router';
import { LightweightChartCard } from '../components/LightweightChartCard';
import { Button } from '../components/ui/button';
import {
  createThreadWithUser,
  listThreads,
  parseAgentResponse,
  runAgentAndCollect,
  sendMessageToGraph,
  type GraphInputMessage,
  type LightweightChartSpec,
  type Message,
  type MessageImage,
} from '../services/api';
import type { CanonicalInvestmentReportExport } from '../services/investmentReportExport';
import {
  getHiddenDefaultChatIds,
  getSelectedChatId,
  getStoredChatSessions,
  getUserId,
  hideDefaultChatId,
  removeThreadTitle,
  saveSelectedChatId,
  saveStoredChatSessions,
  saveThreadTitle,
} from '../services/userStorage';

const MARKDOWN_COMPONENTS: Parameters<typeof ReactMarkdown>[0]['components'] = {
  h2: ({ children, ...props }) => (
    <h2 className="mt-5 mb-2 text-base font-semibold text-slate-100" {...props}>
      {children}
    </h2>
  ),
  h3: ({ children, ...props }) => (
    <h3 className="mt-4 mb-2 text-sm font-semibold text-slate-100" {...props}>
      {children}
    </h3>
  ),
  p: ({ children, ...props }) => (
    <p className="my-3 text-slate-200" {...props}>
      {children}
    </p>
  ),
  ul: ({ children, ...props }) => (
    <ul className="my-3 list-disc pl-5" {...props}>
      {children}
    </ul>
  ),
  ol: ({ children, ...props }) => (
    <ol className="my-3 list-decimal pl-5" {...props}>
      {children}
    </ol>
  ),
  li: ({ children, ...props }) => (
    <li className="my-1 text-slate-300" {...props}>
      {children}
    </li>
  ),
  strong: ({ children, ...props }) => (
    <strong className="font-medium text-slate-100" {...props}>
      {children}
    </strong>
  ),
  em: ({ children, ...props }) => (
    <em className="italic text-slate-200" {...props}>
      {children}
    </em>
  ),
  code: ({ children, ...props }) => (
    <code className="font-mono text-[0.95em] text-slate-100 bg-slate-800/60 rounded px-1 py-0.5" {...props}>
      {children}
    </code>
  ),
  a: ({ children, ...props }) => (
    <a className="text-slate-100 underline decoration-slate-500/70 underline-offset-2" {...props}>
      {children}
    </a>
  ),
};

// Streaming variant of MARKDOWN_COMPONENTS. Goals:
//   1. No element-type changes mid-stream (headings → same <p> tag throughout)
//   2. No large margin pops when a heading first appears (my-1 instead of mt-5)
//   3. No <pre> block reflow (rendered as inline div)
//   4. <strong> stays as <span> so no element-type swap when ** pair completes
//   5. Inline emphasis/code/link render as neutral <span> during streaming to
//      avoid font-weight/font-family/underline width pops while text is still growing
// ReactMarkdown is called WITHOUT remarkGfm so table/strikethrough parsing is skipped.
const STREAMING_MARKDOWN_COMPONENTS: Parameters<typeof ReactMarkdown>[0]['components'] = {
  h1: ({ children }) => <p className="font-semibold text-slate-100 my-1">{children}</p>,
  h2: ({ children }) => <p className="font-semibold text-slate-100 my-1">{children}</p>,
  h3: ({ children }) => <p className="font-semibold text-slate-100 my-1">{children}</p>,
  h4: ({ children }) => <p className="font-semibold text-slate-100 my-1">{children}</p>,
  h5: ({ children }) => <p className="font-semibold text-slate-100 my-1">{children}</p>,
  h6: ({ children }) => <p className="font-semibold text-slate-100 my-1">{children}</p>,
  strong: ({ children }) => <span className="text-slate-200">{children}</span>,
  em: ({ children }) => <span className="text-slate-200">{children}</span>,
  code: ({ children }) => <span className="text-slate-200">{children}</span>,
  a: ({ children }) => <span className="text-slate-200">{children}</span>,
  pre: ({ children }) => <div className="font-mono opacity-80 my-1">{children}</div>,
  p: ({ children }) => <p className="my-1 text-slate-200">{children}</p>,
  ul: ({ children }) => <ul className="my-1 list-disc pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="my-1 list-decimal pl-5">{children}</ol>,
  li: ({ children }) => <li className="my-0 text-slate-300">{children}</li>,
};

interface ChatMessage {
  id?: string;
  sender: 'User' | 'Research' | 'Quant' | 'Risk' | 'Committee' | string;
  content: React.ReactNode;
  timestamp?: string;
  isStreaming?: boolean;
  images?: MessageImage[];
  lightweightCharts?: LightweightChartSpec[];
}

interface ChatSession {
  id: string;
  threadId?: string;
  researchThreadId?: string;
  quantThreadId?: string;
  riskThreadId?: string;
  title: string;
  timestamp: string;
  messages: ChatMessage[];
  hiddenContextPrompt?: string;
  hiddenMessageContents?: string[];
}

interface InvestmentReportChatHandoff {
  handoffType: 'investment_report';
  report: CanonicalInvestmentReportExport;
}

interface ChatAutoRunIntent {
  intentId: string;
  source: 'investment_report_open_in_chat';
  createdAt: string;
}

type CommitteeAgentId = 'Research' | 'Quant' | 'Risk';

type EnabledAgents = Record<CommitteeAgentId, boolean>;

const DEFAULT_ENABLED_AGENTS: EnabledAgents = {
  Research: true,
  Quant: true,
  Risk: true,
};
const CHAT_PORTFOLIO_CONTEXT_STORAGE_KEY = 'chatPortfolioContext';
const CHAT_AUTO_RUN_INTENT_STORAGE_KEY = 'chatPortfolioAutoRunIntent';
const CHAT_TEXT_ATTACHMENT_EXTENSIONS = ['.txt', '.md'] as const;
const CHAT_TEXT_ATTACHMENT_ACCEPT = '.txt,.md,text/plain,text/markdown';
const CHAT_TEXT_ATTACHMENT_MAX_BYTES = 200 * 1024;
const CHAT_TEXT_ATTACHMENT_MAX_CHARS = 12000;

function formatAttachmentSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  return `${(bytes / 1024).toFixed(1)} KB`;
}

function getAttachmentExtension(filename: string): string {
  const lower = filename.toLowerCase();
  const lastDot = lower.lastIndexOf('.');
  return lastDot >= 0 ? lower.slice(lastDot) : '';
}

function isSupportedTextAttachment(filename: string): boolean {
  return CHAT_TEXT_ATTACHMENT_EXTENSIONS.includes(getAttachmentExtension(filename) as typeof CHAT_TEXT_ATTACHMENT_EXTENSIONS[number]);
}

function sanitizeAttachmentText(rawText: string): string {
  return rawText
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .replace(/\u0000/g, '')
    .trim();
}

async function readAttachmentContext(file: File): Promise<string> {
  const rawText = await file.text();
  const sanitized = sanitizeAttachmentText(rawText);

  if (!sanitized) {
    throw new Error('The selected file is empty.');
  }

  const truncated = sanitized.length > CHAT_TEXT_ATTACHMENT_MAX_CHARS;
  const content = truncated
    ? `${sanitized.slice(0, CHAT_TEXT_ATTACHMENT_MAX_CHARS)}\n\n[Attached file content truncated for length]`
    : sanitized;

  return [
    'Attached file context:',
    `Filename: ${file.name}`,
    'Content:',
    '"""',
    content,
    '"""',
  ].join('\n');
}

function isEnabledAgents(value: unknown): value is EnabledAgents {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.Research === 'boolean' &&
    typeof v.Quant === 'boolean' &&
    typeof v.Risk === 'boolean'
  );
}

function loadEnabledAgents(): EnabledAgents {
  try {
    const raw = localStorage.getItem('chatEnabledAgents');
    if (!raw) return DEFAULT_ENABLED_AGENTS;
    const parsed = JSON.parse(raw);
    return isEnabledAgents(parsed) ? parsed : DEFAULT_ENABLED_AGENTS;
  } catch {
    return DEFAULT_ENABLED_AGENTS;
  }
}

function saveEnabledAgents(value: EnabledAgents) {
  try {
    localStorage.setItem('chatEnabledAgents', JSON.stringify(value));
  } catch {
    // Ignore storage errors (e.g., private mode).
  }
}

function buildVisibleChatTranscript(messages: ChatMessage[]): string {
  // Note: Only include string messages that the user can see.
  // (Demo messages use ReactNode, and some sessions include hidden context prompts.)
  const parts: string[] = [];

  for (const msg of messages) {
    if (typeof msg.content !== 'string') continue;
    const content = msg.content.trim();
    if (!content) continue;

    // Keep content as-is (often markdown) but wrap each entry with a sender header.
    parts.push(`#### ${msg.sender}\n${content}`);
  }

  return parts.join('\n\n---\n\n');
}

function buildGraphInputFromTranscript(transcript: ChatMessage[]): GraphInputMessage[] {
  const out: GraphInputMessage[] = [];

  for (const msg of transcript) {
    if (typeof msg.content !== 'string') continue;
    const content = msg.content.trim();
    if (!content) continue;

    // Map into canonical roles for LangGraph.
    const role: GraphInputMessage['role'] = msg.sender === 'User' ? 'user' : 'assistant';

    // Preserve which agent said what by prefixing assistant messages.
    const rendered = role === 'assistant'
      ? `[${msg.sender}] ${content}`
      : content;

    out.push({ role, content: rendered });
  }

  return out;
}

function getDefaultChatSessions(): ChatSession[] {
  return [
    {
      id: 'chat-1',
      title: 'NVDA: 90-day outlook',
      timestamp: '2026-02-27T14:30:00',
      messages: demoMessages,
    },
  ];
}

function isBuiltInDefaultChat(session: Pick<ChatSession, 'id'>): boolean {
  return session.id === 'chat-1';
}

function parseSessionTimestamp(timestamp: string): number {
  if (!timestamp) return 0;
  const direct = Date.parse(timestamp);
  if (Number.isFinite(direct)) return direct;
  const normalized = Date.parse(timestamp.replace(' ', 'T'));
  return Number.isFinite(normalized) ? normalized : 0;
}

function sortSessionsByLastEdited(sessions: ChatSession[]): ChatSession[] {
  return [...sessions].sort((a, b) => parseSessionTimestamp(b.timestamp) - parseSessionTimestamp(a.timestamp));
}

function getInitialChatSessions(): ChatSession[] {
  const hiddenDefaultIds = new Set(getHiddenDefaultChatIds());
  const stored = getStoredChatSessions();
  const restored: ChatSession[] = stored.map((session) => ({
    id: session.id,
    threadId: session.threadId,
    researchThreadId: session.researchThreadId,
    quantThreadId: session.quantThreadId,
    riskThreadId: session.riskThreadId,
    title: session.title,
    timestamp: session.timestamp,
    hiddenContextPrompt: session.hiddenContextPrompt,
    hiddenMessageContents: session.hiddenMessageContents,
    messages: session.messages.map((message) => ({
      sender: message.sender,
      content: message.content,
      timestamp: message.timestamp,
    })),
  }));

  const visibleDefaults = getDefaultChatSessions().filter((chat) => !hiddenDefaultIds.has(chat.id));
  return [...restored, ...visibleDefaults];
}

function buildInvestmentReportHandoffPrompt(report: CanonicalInvestmentReportExport): string {
  return [
    'You are receiving a previously generated investment report as authoritative conversation context.',
    'Use the attached report JSON as the source of truth for this chat.',
    'Do not regenerate the report from scratch.',
    'Do not ask the user to upload or restate the report.',
    'Provide a concise opening summary in natural prose that:',
    '- confirms you reviewed the report',
    '- summarizes the portfolio composition',
    '- notes the main concentration or risk posture',
    '- reflects the committee conclusion',
    '- invites follow-up questions',
    'Keep the opening summary to one short paragraph.',
    '',
    'Canonical investment report JSON:',
    JSON.stringify(report, null, 2),
  ].join('\n');
}

function buildInvestmentReportFallbackOpening(report: CanonicalInvestmentReportExport): string {
  const topHoldings = report.portfolio_composition.holdings
    .slice()
    .sort((a, b) => b.allocation_pct - a.allocation_pct)
    .slice(0, 3)
    .map((holding) => `${holding.ticker} (${holding.allocation_pct.toFixed(1)}%)`)
    .join(', ');

  return `I've reviewed your investment report for ${report.metadata.portfolio_name}. The portfolio holds ${report.portfolio_composition.holdings.length} positions led by ${topHoldings || 'the reported allocation set'}, with total capital of ${report.portfolio_composition.total_capital.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}. The report flags ${report.phase1Payload.portfolio_highlights.concentration.score.toLowerCase()} concentration, assesses overall risk as ${report.phase1Payload.ai_committee_summary.risk_level.value.toLowerCase()}, and lands on a ${report.phase1Payload.ai_committee_summary.recommendation.value.toLowerCase()} recommendation. Ask me about the thesis, scenarios, guardrails, or any specific holding and I'll use the report as context.`;
}

// Applied ONLY to the live streaming render (never to msg.content).
// Closes unclosed inline delimiters so ReactMarkdown always sees complete elements.
// Without this, a cursor landing between ** and its closing ** produces a transient
// orphan * node that resolves to <strong> two commits later — a visible DOM type change.
// Appending a synthetic closer means the element forms on the first commit and just grows,
// eliminating structural churn. The synthetic closer vanishes when streaming ends and
// msg.content (untouched) takes over.
function stabilizeStreamingMarkdown(text: string): string {
  // Close unclosed bold (**). Count must be even for all pairs to be closed.
  const boldCount = (text.match(/\*\*/g) ?? []).length;
  if (boldCount % 2 !== 0) text += '**';
  // Close unclosed inline code (single backtick not part of ```).
  const codeCount = (text.match(/(?<!`)`(?!`)/g) ?? []).length;
  if (codeCount % 2 !== 0) text += '`';
  return text;
}

// Keep markdown as markdown: normalize newline encodings / common artifacts, but do NOT “invent” structure.
function normalizeAgentMarkdown(text: string): string {
  // Some backends/tooling accidentally double-escape newlines ("\\n") or emit raw <br/> tags.
  // Normalize these first so markdown + remark-breaks can do the right thing.
  const normalizedInput = text
    .replace(/\r\n/g, '\n')
    .replace(/<br\s*\/?>/gi, '\n');

  const unescaped = normalizedInput.includes('\\n') && !normalizedInput.includes('\n')
    ? normalizedInput.replace(/\\n/g, '\n')
    : normalizedInput;

  let result = unescaped
    // Remove pass-detection marker (internal, not meant for users)
    .replace(/\[FULL_ANALYSIS_DONE\]/gi, '')
    // Convert ──────...────── divider lines to markdown horizontal rules
    .replace(/^─{4,}.*─{4,}$/gm, '---')
    // Do not trim aggressively; keep author-intended spacing.
    .trim();

  return result;
}

// --- Module-level helpers (no component state, stable across renders) ---

function getAgentColor(agent: string): string {
  switch (agent) {
    case 'Research': return 'border-blue-500/30 bg-blue-500/5';
    case 'Quant':    return 'border-emerald-500/30 bg-emerald-500/5';
    case 'Risk':     return 'border-yellow-500/30 bg-yellow-500/5';
    case 'Committee':return 'border-purple-500/30 bg-purple-500/5';
    case 'System':   return 'border-red-500/30 bg-red-500/5';
    default:         return 'border-slate-700 bg-slate-800/50';
  }
}

function getAgentTextColor(agent: string): string {
  switch (agent) {
    case 'Research': return 'text-blue-400';
    case 'Quant':    return 'text-emerald-400';
    case 'Risk':     return 'text-yellow-400';
    case 'Committee':return 'text-purple-400';
    case 'System':   return 'text-red-400';
    default:         return 'text-slate-400';
  }
}

function getAgentIcon(agent: string): React.ReactNode {
  // SVG paths mirror the landing page icons exactly.
  const svgProps = { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  const icons: Record<string, React.ReactNode> = {
    Research: <svg {...svgProps}><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>,
    Quant:    <svg {...svgProps}><path d="M18 20V10M12 20V4M6 20v-6"/></svg>,
    Risk:     <svg {...svgProps}><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>,
    Committee:<svg {...svgProps}><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></svg>,
  };
  const styles: Record<string, React.CSSProperties> = {
    Research:  { background: 'rgba(59,130,246,0.15)',  color: 'rgb(96,165,250)' },   // blue-500/15 · blue-400
    Quant:     { background: 'rgba(16,185,129,0.15)',  color: 'rgb(52,211,153)' },   // emerald-500/15 · emerald-400
    Risk:      { background: 'rgba(234,179,8,0.15)',   color: 'rgb(250,204,21)' },   // yellow-500/15 · yellow-400
    Committee: { background: 'rgba(168,85,247,0.15)',  color: 'rgb(192,132,252)' },  // purple-500/15 · purple-400
  };
  const svg   = icons[agent]   ?? icons.Committee;
  const style = styles[agent]  ?? { background: 'rgba(100,116,139,0.15)', color: 'rgb(148,163,184)' };
  return (
    <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg flex-shrink-0" style={style}>
      {svg}
    </span>
  );
}

// Isolated, memoized card for agent messages.
// Only the one actively streaming re-renders on each typewriter tick;
// all finalized cards are skipped by React.memo's shallow prop check.
interface AgentMessageCardProps {
  msg: ChatMessage;
  streamingText?: string;
}

const AgentMessageCard = memo(function AgentMessageCard({ msg, streamingText }: AgentMessageCardProps) {
  const displayText = msg.isStreaming && msg.id !== undefined
    ? (streamingText ?? '')
    : (typeof msg.content === 'string' ? msg.content : null);

  const normalizedText = displayText !== null ? normalizeAgentMarkdown(displayText) : null;
  // Close unclosed inline delimiters during streaming to prevent DOM structural churn.
  // Unapplied once streaming ends — final content renders from msg.content untouched.
  const renderText = (normalizedText !== null && msg.isStreaming)
    ? stabilizeStreamingMarkdown(normalizedText)
    : normalizedText;

  return (
    <div className="max-w-[85%]">
      <div className="flex items-center gap-2 mb-2 ml-1">
        {getAgentIcon(msg.sender)}
        <span className={`text-sm font-medium ${getAgentTextColor(msg.sender)}`}>
          {msg.sender === 'Committee' ? 'Committee Summary' : msg.sender === 'System' ? 'System' : `${msg.sender} Agent`}
        </span>
        {msg.isStreaming && (
          <span className={`w-1.5 h-1.5 rounded-full opacity-40 ${
            msg.sender === 'Research' ? 'bg-blue-400' :
            msg.sender === 'Quant' ? 'bg-emerald-400' :
            msg.sender === 'Risk' ? 'bg-yellow-400' :
            msg.sender === 'Committee' ? 'bg-purple-400' : 'bg-slate-400'
          }`} />
        )}
      </div>
      <div className={`border rounded-xl p-5 ${getAgentColor(msg.sender)}`}>
        <div className="text-slate-200 text-sm leading-relaxed">
          {renderText !== null
            ? msg.isStreaming
              ? (
                  // During streaming: stabilized partial markdown. No remarkGfm so tables
                  // and strikethrough are never partially parsed. Headings render as <p>
                  // throughout (no element-type swap or margin pop). strong → <span> so
                  // the node type never changes when a ** pair completes. Tight my-1
                  // margins reduce layout shift from new list items. When streaming ends
                  // the card switches to full ReactMarkdown + MARKDOWN_COMPONENTS below.
                  <div className="prose prose-invert prose-sm max-w-none">
                    <ReactMarkdown components={STREAMING_MARKDOWN_COMPONENTS}>
                      {renderText}
                    </ReactMarkdown>
                  </div>
                )
              : (
                  <div className="prose prose-invert prose-sm max-w-none [&_h1]:text-slate-100 [&_h2]:text-slate-100 [&_h3]:text-slate-100 [&_h4]:text-slate-100 [&_strong]:text-slate-100 [&_p]:text-slate-200 [&_li]:text-slate-300 [&_table]:text-slate-300 [&_th]:text-slate-400 [&_th]:font-normal [&_td]:text-slate-300 [&_p]:my-3 [&_ul]:my-3 [&_ol]:my-3 [&_li]:my-1">
                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
                      {renderText}
                    </ReactMarkdown>
                  </div>
                )
            : msg.content}
          {msg.images && msg.images.length > 0 && (
            <div className="mt-3 space-y-3">
              {msg.images.map((image, i) => (
                <figure key={`${image.url}-${i}`} className="overflow-hidden rounded-lg border border-slate-700">
                  <img src={image.url} alt={image.name || `Chart ${i + 1}`} className="w-full h-auto block" />
                  {image.name && (
                    <figcaption className="px-3 py-2 text-xs text-slate-400">{image.name.replace(/_/g, ' ')}</figcaption>
                  )}
                </figure>
              ))}
            </div>
          )}
          {msg.lightweightCharts && msg.lightweightCharts.length > 0 && (
            <div className="mt-3 space-y-3">
              {msg.lightweightCharts.map((chart, i) => (
                <LightweightChartCard key={`${chart.id || chart.title || 'chart'}-${i}`} chart={chart} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

// Minimum duration a thinking phase must last before the indicator becomes visible.
// Phases shorter than this are suppressed entirely (e.g. very fast debate rounds).
const THINKING_SHOW_DELAY_MS = 400;
// Duration of the fade-out transition when the first streamed card appears.
const THINKING_FADE_MS = 350;

type CommitteeThinkingPhase = 'hidden' | 'visible' | 'fadingOut';

function buildThinkingLabel(agents: string[]): string {
  const named = agents.map(a => `${a} Agent`);
  if (named.length === 1) return `${named[0]} is thinking...`;
  if (named.length === 2) return `${named[0]} and ${named[1]} are thinking...`;
  const last = named[named.length - 1];
  const rest = named.slice(0, -1).join(', ');
  return `${rest} and ${last} are thinking...`;
}

function CommitteeThinkingIndicator({ phase, agents }: { phase: CommitteeThinkingPhase; agents: string[] }) {
  if (phase === 'hidden') return null;
  const fading = phase === 'fadingOut';
  return (
    <div
      className="px-6 py-2 text-xs text-slate-500 select-none"
      style={fading
        ? { opacity: 0, transition: `opacity ${THINKING_FADE_MS}ms ease-out` }
        : { animation: 'committee-fade 1.4s ease-in-out infinite' }
      }
    >
      {buildThinkingLabel(agents)}
    </div>
  );
}

export function Chat() {
  const navigate = useNavigate();
  const location = useLocation();
  const [message, setMessage] = useState('');
  const [userId] = useState(() => getUserId());
  const [selectedChatId, setSelectedChatId] = useState(() => getSelectedChatId() || 'chat-1');
  const [hoveredChatId, setHoveredChatId] = useState<string | null>(null);
  const [editingChatId, setEditingChatId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [isBackendOnline, setIsBackendOnline] = useState(false);
  const [enableDebateRound, setEnableDebateRound] = useState(true);
  const [enabledAgents, setEnabledAgents] = useState<EnabledAgents>(() => loadEnabledAgents());
  const [committeeThinking, setCommitteeThinking] = useState<{
    phase: CommitteeThinkingPhase;
    agents: string[];
  }>({ phase: 'hidden', agents: [] });
  const committeeShowTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const committeeFadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Show indicator only after THINKING_SHOW_DELAY_MS — suppresses short phases (e.g. fast debate rounds).
  const startCommitteeThinking = (agents: string[]) => {
    if (committeeShowTimerRef.current) clearTimeout(committeeShowTimerRef.current);
    if (committeeFadeTimerRef.current) { clearTimeout(committeeFadeTimerRef.current); committeeFadeTimerRef.current = null; }
    committeeShowTimerRef.current = setTimeout(() => {
      setCommitteeThinking({ phase: 'visible', agents });
      committeeShowTimerRef.current = null;
    }, THINKING_SHOW_DELAY_MS);
  };

  // Soft handoff: if indicator is visible, fade it out; if still in delay, cancel silently.
  const stopCommitteeThinkingFade = () => {
    if (committeeShowTimerRef.current) {
      clearTimeout(committeeShowTimerRef.current);
      committeeShowTimerRef.current = null;
      setCommitteeThinking({ phase: 'hidden', agents: [] });
      return;
    }
    setCommitteeThinking(prev =>
      prev.phase === 'visible' ? { phase: 'fadingOut', agents: prev.agents } : { phase: 'hidden', agents: [] }
    );
    if (committeeFadeTimerRef.current) clearTimeout(committeeFadeTimerRef.current);
    committeeFadeTimerRef.current = setTimeout(() => {
      setCommitteeThinking({ phase: 'hidden', agents: [] });
      committeeFadeTimerRef.current = null;
    }, THINKING_FADE_MS);
  };

  // Hard clear: used in error paths and finally blocks.
  const stopCommitteeThinkingImmediate = () => {
    if (committeeShowTimerRef.current) { clearTimeout(committeeShowTimerRef.current); committeeShowTimerRef.current = null; }
    if (committeeFadeTimerRef.current) { clearTimeout(committeeFadeTimerRef.current); committeeFadeTimerRef.current = null; }
    setCommitteeThinking({ phase: 'hidden', agents: [] });
  };

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const isMountedRef = useRef(true);
  const handledAutoRunIntentIdsRef = useRef<Set<string>>(new Set());

  // Typewriter state: a bounded-rate reveal that never "catches up" by dumping
  // large jumps when frames are late or when the backend has already finished.
  const [streamingTexts, setStreamingTexts] = useState<Record<string, string>>({});
  const typewriterStateRef = useRef<Record<string, {
    fullText: string;
    cursor: number;          // current visible char count
    carry: number;           // fractional chars accumulated between ticks
    speed: number;           // chars per ms
    lastTickTime: number;    // timestamp of the last paced tick
    rafId: number | null;
    timeoutId: number | null; // paced fallback when RAF is delayed/throttled
    onComplete: (() => void) | null;
  }>>({});
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const lastScrollTimeRef = useRef<number>(0);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      // Cancel all in-flight typewriter RAFs and fallback timers on unmount.
      for (const s of Object.values(typewriterStateRef.current)) {
        if (s.rafId != null) cancelAnimationFrame(s.rafId);
        if (s.timeoutId != null) clearTimeout(s.timeoutId);
      }
      typewriterStateRef.current = {};
    };
  }, []);

  useEffect(() => {
    saveEnabledAgents(enabledAgents);
  }, [enabledAgents]);

  useEffect(() => {
    let isActive = true;

    const checkBackendStatus = async () => {
      try {
        await listThreads(userId);
        if (isActive) setIsBackendOnline(true);
      } catch {
        if (isActive) setIsBackendOnline(false);
      }
    };

    checkBackendStatus();
    const intervalId = window.setInterval(checkBackendStatus, 15000);

    return () => {
      isActive = false;
      window.clearInterval(intervalId);
    };
  }, [userId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [selectedChatId]);

  // Auto-scroll during streaming: only if the user is already near the bottom,
  // throttled to ~5 Hz so it never fights the user or causes visible jerking.
  useEffect(() => {
    if (Object.keys(streamingTexts).length === 0) return;
    const now = performance.now();
    if (now - lastScrollTimeRef.current < 200) return;
    lastScrollTimeRef.current = now;

    const scrollEl = scrollContainerRef.current;
    if (!scrollEl) return;
    const distFromBottom = scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight;
    if (distFromBottom < 150) {
      scrollEl.scrollTop = scrollEl.scrollHeight;
    }
  }, [streamingTexts]);

  // Stable reveal pace, independent from message length or backend burst size.
  // At 60 chars/sec a short reply still feels lively, while long replies remain
  // readable and continue pacing naturally all the way to the end.
  const REVEAL_CHARS_PER_SECOND = 68;
  const REVEAL_TIMEOUT_FALLBACK_MS = 120;
  // Maximum characters revealed in one visible tick. This prevents late frames
  // from exposing backend/render jitter as large text jumps.
  const REVEAL_MAX_CHARS_PER_COMMIT = 4;

  const scheduleTypewriterFallback = (key: string) => {
    const s = typewriterStateRef.current[key];
    if (!s) return;
    if (s.timeoutId != null) clearTimeout(s.timeoutId);
    s.timeoutId = window.setTimeout(() => {
      const next = typewriterStateRef.current[key];
      if (!next) return;
      next.timeoutId = null;
      if (next.rafId != null) {
        cancelAnimationFrame(next.rafId);
        next.rafId = null;
      }
      advanceTypewriter(key, performance.now());
    }, REVEAL_TIMEOUT_FALLBACK_MS);
  };

  // RAF loop: reveal at a paced, bounded rate. Late frames add fractional credit,
  // but each visible commit is capped, so the UI stays steady instead of catching up.
  const advanceTypewriter = (key: string, timestamp: number) => {
    const s = typewriterStateRef.current[key];
    if (!s) return;

    const elapsed = Math.max(0, timestamp - s.lastTickTime);
    s.lastTickTime = timestamp;
    s.carry += elapsed * s.speed;

    const step = Math.min(REVEAL_MAX_CHARS_PER_COMMIT, Math.floor(s.carry));
    if (step > 0) {
      s.carry -= step;
      s.cursor = Math.min(s.cursor + step, s.fullText.length);
      setStreamingTexts(prev => ({ ...prev, [key]: s.fullText.slice(0, Math.floor(s.cursor)) }));
    }

    const done = s.cursor >= s.fullText.length;
    if (!done) {
      s.rafId = requestAnimationFrame(t => advanceTypewriter(key, t));
      scheduleTypewriterFallback(key);
    } else {
      if (s.timeoutId != null) clearTimeout(s.timeoutId);
      s.rafId = null;
      s.timeoutId = null;
      s.onComplete?.();
    }
  };

  // Start a paced character-level reveal for `key`.
  const feedTypewriter = (key: string, fullText: string, onComplete?: () => void) => {
    const speed = REVEAL_CHARS_PER_SECOND / 1000;

    // Pre-advance past leading markdown syntax so the first render is already
    // a valid markdown element — avoids <p>#</p> → <h3> reflow on tick 1-2.
    const syntaxPrefix = /^[\n\r\s]*(#{1,6} |[-*+] |\d+\. |> |`{3})/.exec(fullText);
    const initialCursor = syntaxPrefix ? Math.min(syntaxPrefix[0].length + 1, fullText.length) : 0;

    const now = performance.now();

    typewriterStateRef.current[key] = {
      fullText,
      cursor: initialCursor,
      carry: 0,
      speed,
      lastTickTime: now,
      rafId: null,
      timeoutId: null,
      onComplete: onComplete ?? null,
    };
    if (initialCursor > 0) {
      setStreamingTexts(prev => ({ ...prev, [key]: fullText.slice(0, initialCursor) }));
    }
    typewriterStateRef.current[key].rafId = requestAnimationFrame(t => advanceTypewriter(key, t));
    scheduleTypewriterFallback(key);
  };

  // Cancel and remove typewriter state for a key without calling onComplete.
  const clearTypewriter = (key: string) => {
    const s = typewriterStateRef.current[key];
    if (s?.rafId != null) cancelAnimationFrame(s.rafId);
    if (s?.timeoutId != null) clearTimeout(s.timeoutId);
    delete typewriterStateRef.current[key];
    if (!isMountedRef.current) return;
    setStreamingTexts(prev => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const [chatSessions, setChatSessions] = useState<ChatSession[]>(() => getInitialChatSessions());
  const sortedChatSessions = useMemo(() => sortSessionsByLastEdited(chatSessions), [chatSessions]);
  const [attachedFile, setAttachedFile] = useState<File | null>(null);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const selectedChat = chatSessions.find(chat => chat.id === selectedChatId);

  // Handle report context handoff from Investment Report only when a matching one-time intent is present.
  useEffect(() => {
    const routeState = (location.state && typeof location.state === 'object'
      ? location.state
      : null) as { autoRunIntentId?: string } | null;
    const routeIntentId = typeof routeState?.autoRunIntentId === 'string' ? routeState.autoRunIntentId : null;
    const intentStr = sessionStorage.getItem(CHAT_AUTO_RUN_INTENT_STORAGE_KEY);
    const contextStr = localStorage.getItem(CHAT_PORTFOLIO_CONTEXT_STORAGE_KEY);

    if (!routeIntentId || !intentStr || !contextStr) {
      if (routeIntentId && !intentStr) {
        navigate(location.pathname, { replace: true, state: null });
      }
      return;
    }

    try {
      const parsedIntent = JSON.parse(intentStr) as Partial<ChatAutoRunIntent>;
      const context = JSON.parse(contextStr);

      if (
        parsedIntent?.source !== 'investment_report_open_in_chat' ||
        typeof parsedIntent?.intentId !== 'string' ||
        parsedIntent.intentId !== routeIntentId
      ) {
        navigate(location.pathname, { replace: true, state: null });
        return;
      }

      if (handledAutoRunIntentIdsRef.current.has(routeIntentId)) {
        navigate(location.pathname, { replace: true, state: null });
        return;
      }

      // Consume the one-time auto-run intent immediately so refresh/navigation cannot replay it.
      handledAutoRunIntentIdsRef.current.add(routeIntentId);
      sessionStorage.removeItem(CHAT_AUTO_RUN_INTENT_STORAGE_KEY);
      navigate(location.pathname, { replace: true, state: null });

      if (context?.handoffType === 'investment_report' && context?.report) {
        const handoff = context as InvestmentReportChatHandoff;
        const hiddenPrompt = buildInvestmentReportHandoffPrompt(handoff.report);
        const newChatId = `report-${Date.now()}`;
        const newSession: ChatSession = {
          id: newChatId,
          title: `Report: ${handoff.report.metadata.portfolio_name}`,
          timestamp: new Date().toISOString(),
          messages: [],
          hiddenContextPrompt: hiddenPrompt,
          hiddenMessageContents: [hiddenPrompt],
        };

        setChatSessions(prev => [newSession, ...prev]);
        setSelectedChatId(newChatId);
        localStorage.removeItem(CHAT_PORTFOLIO_CONTEXT_STORAGE_KEY);

        void (async () => {
          try {
            startCommitteeThinking(['Research', 'Quant', 'Risk']);
            // 1) Create the three agent threads and silently prime them with the hidden report prompt.
            const [researchThreadId, quantThreadId, riskThreadId] = await Promise.all([
              createThreadWithUser(userId),
              createThreadWithUser(userId),
              createThreadWithUser(userId),
            ]);

            await Promise.all([
              sendMessageToGraph(researchThreadId, hiddenPrompt, 'research_agent', () => {}),
              sendMessageToGraph(quantThreadId, hiddenPrompt, 'quant_agent', () => {}),
              sendMessageToGraph(riskThreadId, hiddenPrompt, 'risk_management_agent', () => {}),
            ]);

            if (!isMountedRef.current) return;
            startCommitteeThinking(['Committee']);

            // 2) Ask the supervisor (committee) for a single opening paragraph, but keep the real report JSON hidden.
            let committeeOpening = buildInvestmentReportFallbackOpening(handoff.report);
            try {
              const committeeThreadId = await createThreadWithUser(userId);
              const committeeMsgs = await runAgentAndCollect(committeeThreadId, hiddenPrompt, 'supervisor');
              const combined = committeeMsgs.map(m => m.text).filter(Boolean).join('\n').trim();
              if (combined.length > 0) committeeOpening = combined;

              if (!isMountedRef.current) return;
              const committeeTimestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
              const committeeMsgId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
              // Insert the Committee card and pre-seed the first visible character in the
              // same synchronous block. React 18 batches both setChatSessions and
              // setStreamingTexts into one render, so the card never appears as an
              // empty shell — identical to how Research/Quant/Risk behave when their
              // markdown-prefixed responses trigger feedTypewriter's initialCursor path.
              stopCommitteeThinkingFade();
              setChatSessions(prev => prev.map(chat =>
                chat.id === newChatId
                  ? {
                      ...chat,
                      threadId: committeeThreadId,
                      researchThreadId,
                      quantThreadId,
                      riskThreadId,
                      timestamp: new Date().toISOString(),
                      messages: [
                        {
                          id: committeeMsgId,
                          sender: 'Committee',
                          content: '',
                          isStreaming: true,
                          timestamp: committeeTimestamp,
                        },
                      ],
                    }
                  : chat
              ));
              if (committeeOpening.length > 0) {
                setStreamingTexts(prev => ({ ...prev, [committeeMsgId]: committeeOpening.slice(0, 1) }));
              }
              feedTypewriter(committeeMsgId, committeeOpening, () => {
                if (!isMountedRef.current) return;
                setChatSessions(prev => prev.map(chat =>
                  chat.id !== newChatId ? chat : {
                    ...chat,
                    messages: chat.messages.map(m =>
                      m.id === committeeMsgId ? { ...m, content: committeeOpening, isStreaming: false } : m
                    ),
                  }
                ));
                clearTypewriter(committeeMsgId);
              });
            } catch (error) {
              console.error('Committee opening failed; using fallback opening:', error);
              if (!isMountedRef.current) return;
              stopCommitteeThinkingImmediate();
              setChatSessions(prev => prev.map(chat =>
                chat.id === newChatId
                  ? {
                      ...chat,
                      researchThreadId,
                      quantThreadId,
                      riskThreadId,
                      timestamp: new Date().toISOString(),
                      messages: [
                        {
                          sender: 'System',
                          content: 'Live handoff to the backend was unavailable, but the report context has been summarized locally.',
                          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                        },
                      ],
                    }
                  : chat
              ));
            }
          } catch (error) {
            console.error('Failed to initialize report handoff chat:', error);
            if (!isMountedRef.current) return;
            stopCommitteeThinkingImmediate();
            setChatSessions(prev => prev.map(chat =>
              chat.id === newChatId
                ? {
                    ...chat,
                    timestamp: new Date().toISOString(),
                    messages: [
                      {
                        sender: 'System',
                        content: 'Live handoff to the backend was unavailable, but the report context has been summarized locally.',
                        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                      },
                    ],
                  }
                : chat
            ));
          }
        })();
      }
    } catch (error) {
      console.error('Failed to initialize report handoff context:', error);
      sessionStorage.removeItem(CHAT_AUTO_RUN_INTENT_STORAGE_KEY);
      localStorage.removeItem(CHAT_PORTFOLIO_CONTEXT_STORAGE_KEY);
      navigate(location.pathname, { replace: true, state: null });
    }
  }, [location.pathname, location.state, navigate, userId]);

  useEffect(() => {
    if (!chatSessions.some((chat) => chat.id === selectedChatId)) {
      setSelectedChatId(sortedChatSessions[0]?.id || '');
    }
  }, [chatSessions, selectedChatId, sortedChatSessions]);

  useEffect(() => {
    if (!selectedChatId) return;
    saveSelectedChatId(selectedChatId);
  }, [selectedChatId]);

  useEffect(() => {
    const persisted = chatSessions
      .filter((chat) => !isBuiltInDefaultChat(chat))
      .map((chat) => ({
        id: chat.id,
        threadId: chat.threadId,
        researchThreadId: chat.researchThreadId,
        quantThreadId: chat.quantThreadId,
        riskThreadId: chat.riskThreadId,
        title: chat.title,
        timestamp: chat.timestamp,
        hiddenContextPrompt: chat.hiddenContextPrompt,
        hiddenMessageContents: chat.hiddenMessageContents,
        messages: chat.messages
          .filter((msg) => !msg.isStreaming && typeof msg.content === 'string')
          .map((msg) => ({
            sender: msg.sender,
            content: msg.content as string,
            timestamp: msg.timestamp,
          })),
      }));

    saveStoredChatSessions(persisted);
  }, [chatSessions]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [selectedChat?.messages.length]);

  const clearAttachment = () => {
    setAttachedFile(null);
    setAttachmentError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleAttachmentSelect = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] || null;
    if (!file) {
      return;
    }

    if (!isSupportedTextAttachment(file.name)) {
      setAttachedFile(null);
      setAttachmentError('Unsupported file type. Attach a .txt or .md file.');
      event.target.value = '';
      return;
    }

    if (file.size > CHAT_TEXT_ATTACHMENT_MAX_BYTES) {
      setAttachedFile(null);
      setAttachmentError(`File is too large. Maximum size is ${formatAttachmentSize(CHAT_TEXT_ATTACHMENT_MAX_BYTES)}.`);
      event.target.value = '';
      return;
    }

    setAttachedFile(file);
    setAttachmentError(null);
  };

  const handleSendMessage = async () => {
    const typedUserMsg = message.trim();
    if ((!typedUserMsg && !attachedFile) || isStreaming) return;

    const currentChat = chatSessions.find(c => c.id === selectedChatId);
    if (!currentChat) return;

    let attachedContext = '';
    if (attachedFile) {
      try {
        attachedContext = await readAttachmentContext(attachedFile);
      } catch (error) {
        setAttachmentError(
          error instanceof Error
            ? error.message
            : 'Unable to read the selected file as text.',
        );
        return;
      }
    }

    const displayUserMsg = typedUserMsg && attachedFile
      ? `${typedUserMsg}\n\n[Attached file: ${attachedFile.name}]`
      : attachedFile
        ? `[Attached file: ${attachedFile.name}]`
        : typedUserMsg;
    const userMsg = typedUserMsg && attachedContext
      ? `User question:\n${typedUserMsg}\n\n${attachedContext}`
      : attachedContext || typedUserMsg;

    setMessage('');
    setAttachmentError(null);

    const capturedSessionId = selectedChatId;
    const nowIso = new Date().toISOString();
    const nowTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const nextTranscriptMessages: ChatMessage[] = [
      ...currentChat.messages,
      { sender: 'User', content: userMsg, timestamp: nowTime },
    ];

    // Ensure the 3 agent threads exist (lazy creation keeps demo sessions working)
    let { researchThreadId, quantThreadId, riskThreadId } = currentChat;
    if (!researchThreadId || !quantThreadId || !riskThreadId) {
      try {
        const [rId, qId, rmId] = await Promise.all([
          createThreadWithUser(userId),
          createThreadWithUser(userId),
          createThreadWithUser(userId),
        ]);
        researchThreadId = rId;
        quantThreadId = qId;
        riskThreadId = rmId;
        if (!isMountedRef.current) return;
        setChatSessions(prev => prev.map(chat =>
          chat.id === capturedSessionId
            ? { ...chat, researchThreadId, quantThreadId, riskThreadId }
            : chat
        ));

        // If this session has hidden context (e.g., report handoff), prime the agent threads silently.
        if (currentChat.hiddenContextPrompt) {
          const hiddenPrompt = currentChat.hiddenContextPrompt;
          await Promise.all([
            sendMessageToGraph(researchThreadId, hiddenPrompt, 'research_agent', () => {}),
            sendMessageToGraph(quantThreadId, hiddenPrompt, 'quant_agent', () => {}),
            sendMessageToGraph(riskThreadId, hiddenPrompt, 'risk_management_agent', () => {}),
          ]);
          if (!isMountedRef.current) return;
        }
      } catch (err) {
        console.error('Failed to create threads:', err);
        if (!isMountedRef.current) return;
        setChatSessions(prev => prev.map(chat =>
          chat.id === capturedSessionId
            ? {
                ...chat,
                messages: [
                  ...chat.messages,
                  {
                    sender: 'System',
                    content: 'Connection to LangGraph server failed. Please ensure `langgraph dev` is running on port 2024.',
                    timestamp: nowTime,
                  },
                ],
                timestamp: nowIso,
              }
            : chat
        ));
        return;
      }
    }

    // Set title on first user message
    const isFirstUserMessage = currentChat.messages.filter(m => m.sender === 'User').length === 0;
    if (isFirstUserMessage) {
      const titleSource = typedUserMsg || (attachedFile ? `[Attached file: ${attachedFile.name}]` : 'New Chat');
      const title = titleSource.length > 30 ? `${titleSource.substring(0, 30)}...` : titleSource;
      setChatSessions(prev => prev.map(chat =>
        chat.id === capturedSessionId ? { ...chat, title, timestamp: nowIso } : chat
      ));
      if (researchThreadId) saveThreadTitle(researchThreadId, title);
      if (quantThreadId) saveThreadTitle(quantThreadId, title);
      if (riskThreadId) saveThreadTitle(riskThreadId, title);
    }

    // Append user message
    setChatSessions(prev => prev.map(chat =>
      chat.id === capturedSessionId
        ? {
            ...chat,
            messages: [...chat.messages, { sender: 'User', content: displayUserMsg, timestamp: nowTime }],
            timestamp: nowIso,
          }
        : chat
    ));
    clearAttachment();

    setIsStreaming(true);

    const enabledAgentList: CommitteeAgentId[] = (['Research', 'Quant', 'Risk'] as const)
      .filter((agent) => enabledAgents[agent]);

    if (enabledAgentList.length === 0) {
      setChatSessions(prev => prev.map(chat =>
        chat.id === capturedSessionId
          ? {
              ...chat,
              messages: [
                ...chat.messages,
                {
                  sender: 'System',
                  content: 'No agents are enabled. Toggle at least one agent (Research / Quant / Risk) to receive responses.',
                  timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                },
              ],
              timestamp: new Date().toISOString(),
            }
          : chat
      ));
      setIsStreaming(false);
      return;
    }

    // Per-turn reveal queue: all agents fetch in parallel, but only ONE card reveals
    // at a time. Once the active card finishes, the next queued job starts.
    // Agent cards are NOT inserted until the moment they begin speaking.
    type RevealJob = { card: ChatMessage; fullText: string; onComplete: () => void };
    const revealQueue: RevealJob[] = [];
    let isRevealing = false;

    const tryStartNextReveal = () => {
      if (isRevealing || revealQueue.length === 0) return;
      const job = revealQueue.shift()!;
      isRevealing = true;

      // Hide the thinking indicator the moment the first card begins streaming
      stopCommitteeThinkingFade();

      // Insert the agent card NOW — the moment it starts speaking
      const streamingCard = { ...job.card, isStreaming: true };
      setChatSessions(prev => prev.map(chat => {
        if (chat.id !== capturedSessionId) return chat;
        return { ...chat, messages: [...chat.messages, streamingCard], timestamp: new Date().toISOString() };
      }));

      feedTypewriter(job.card.id!, job.fullText, () => {
        if (!isMountedRef.current) {
          clearTypewriter(job.card.id!);
          isRevealing = false;
          job.onComplete();
          return;
        }
        setChatSessions(prev => prev.map(chat => {
          if (chat.id !== capturedSessionId) return chat;
          return {
            ...chat,
            messages: chat.messages.map(m =>
              m.id === job.card.id ? { ...m, content: job.fullText, isStreaming: false } : m
            ),
          };
        }));
        clearTypewriter(job.card.id!);
        isRevealing = false;
        job.onComplete();
        tryStartNextReveal();
      });
    };

    const runAgent = async (
      threadId: string,
      graphId: string,
      inputMsg: string | GraphInputMessage[],
      defaultSender: string
    ) => {
      const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const msgId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      try {
        const collected: Message[] = [];
        const seenKeys = new Set<string>();

        // Collect the full response. The backend (stream_mode: 'updates') sends one
        // SSE event per node completion — not per token — so onEvent fires only once
        // or a few times, always with a complete message. No partial chunks arrive.
        await sendMessageToGraph(threadId, inputMsg, graphId, (event) => {
          const parsed = parseAgentResponse(event.data);
          for (const msg of parsed) {
            const key = msg.messageId || `${msg.agent ?? msg.sender}|${String(msg.text).slice(0, 80)}`;
            if (seenKeys.has(key)) continue;
            seenKeys.add(key);
            collected.push(msg);
          }
        });

        if (!isMountedRef.current) return '';
        if (collected.length === 0) return '';

        const fullText = collected.filter(m => m.text).map(m => m.text).join('\n');
        const allImages = collected.flatMap(m => m.images ?? []);
        const allCharts = collected.flatMap(m => m.lightweightCharts ?? []);
        const agentSender = collected[0]?.agent || collected[0]?.sender || defaultSender;

        const card: ChatMessage = {
          id: msgId,
          sender: agentSender,
          content: '',
          images: allImages.length > 0 ? allImages : undefined,
          lightweightCharts: allCharts.length > 0 ? allCharts : undefined,
          timestamp,
        };

        if (fullText) {
          // Enqueue: card is invisible until its turn to speak
          await new Promise<void>(resolve => {
            revealQueue.push({ card, fullText, onComplete: resolve });
            tryStartNextReveal();
          });
        } else {
          // Images/charts only — insert directly, no typewriter needed
          if (!isMountedRef.current) return '';
          setChatSessions(prev => prev.map(chat => {
            if (chat.id !== capturedSessionId) return chat;
            return { ...chat, messages: [...chat.messages, card], timestamp: new Date().toISOString() };
          }));
        }

        return fullText;
      } catch (err) {
        console.error(`${graphId} error:`, err);
        if (!isMountedRef.current) return '';
        // Push error card directly — no placeholder to resolve
        const errorTimestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        setChatSessions(prev => prev.map(chat => {
          if (chat.id !== capturedSessionId) return chat;
          return {
            ...chat,
            messages: [...chat.messages, {
              sender: 'System',
              content: `Connection to LangGraph server failed (${graphId}). Please ensure \`langgraph dev\` is running.`,
              timestamp: errorTimestamp,
            }],
            timestamp: new Date().toISOString(),
          };
        }));
        return '';
      }
    };

    try {
      // Build transcript from the *visible* messages plus the new user message.
      // This ensures each agent gets full cross-agent context even though they run in separate threads.
      const nextVisibleTranscript = buildVisibleChatTranscript(nextTranscriptMessages);
      const nextGraphInput = buildGraphInputFromTranscript(nextTranscriptMessages);

      startCommitteeThinking(enabledAgentList);

      const pass1Runs: Array<Promise<{ agent: CommitteeAgentId; text: string }>> = [];
      if (enabledAgents.Research) {
        pass1Runs.push(
          runAgent(researchThreadId!, 'research_agent', nextGraphInput, 'Research')
            .then((text) => ({ agent: 'Research' as const, text }))
        );
      }
      if (enabledAgents.Quant) {
        pass1Runs.push(
          runAgent(quantThreadId!, 'quant_agent', nextGraphInput, 'Quant')
            .then((text) => ({ agent: 'Quant' as const, text }))
        );
      }
      if (enabledAgents.Risk) {
        pass1Runs.push(
          runAgent(riskThreadId!, 'risk_management_agent', nextGraphInput, 'Risk')
            .then((text) => ({ agent: 'Risk' as const, text }))
        );
      }

      const pass1Results = await Promise.all(pass1Runs);
      const pass1ByAgent: Partial<Record<CommitteeAgentId, string>> = Object.fromEntries(
        pass1Results.map((item) => [item.agent, item.text])
      );

      const researchText = pass1ByAgent.Research ?? '';
      const quantText = pass1ByAgent.Quant ?? '';
      const riskText = pass1ByAgent.Risk ?? '';

      // Pass 2: Discussion round (parallel)
      const participants = (['Research', 'Quant', 'Risk'] as const)
        .filter((agent) => enabledAgents[agent])
        .map((agent) => ({
          agent,
          text: (agent === 'Research' ? researchText : agent === 'Quant' ? quantText : riskText),
        }))
        .filter((item) => item.text.length > 20);

      if (enableDebateRound && participants.length >= 2) {
        const buildDiscussionPrompt = (agentName: string, otherAgents: { name: string; text: string }[]) => {
          const otherSummaries = otherAgents
            .filter(a => a.text.length > 20)
            .map(a => `**${a.name} Agent's analysis:**\n${a.text}`)
            .join('\n\n---\n\n');

          return `You are now in DISCUSSION AND RESPONSE MODE as part of a GROUP CHAT with the other agents.

The first analysis pass is complete.

CHAT TRANSCRIPT (full context):
${nextVisibleTranscript}

Below are the other agents' analyses on the same question from their unique perspectives.

As the ${agentName} Agent, review their findings and provide a focused discussion response. You should:
- Challenge any assumptions or conclusions you disagree with, citing your own analysis
- Highlight key agreements and where your analyses reinforce each other
- Add important context, data points, or risks the other agents may have missed
- Respond directly to points that relate to your area of expertise

IMPORTANT: This is a group chat discussion, not a full re-analysis.
Be concise and conversational.
Limit your response to 2-3 sentences.

FORMAT REQUIREMENTS (strict):
- Respond in GitHub-flavored Markdown
- Use bullet lists where helpful
- Use blank lines between paragraphs
- Do NOT hard-wrap lines mid-sentence

${otherSummaries}`;
        };

        const p2Runs: Promise<any>[] = [];
        if (participants.some((p) => p.agent === 'Research')) {
          const researchP2Msg = buildDiscussionPrompt('Research', participants
            .filter((p) => p.agent !== 'Research')
            .map((p) => ({ name: p.agent, text: p.text })));
          p2Runs.push(runAgent(researchThreadId!, 'research_agent', researchP2Msg, 'Research'));
        }
        if (participants.some((p) => p.agent === 'Quant')) {
          const quantP2Msg = buildDiscussionPrompt('Quant', participants
            .filter((p) => p.agent !== 'Quant')
            .map((p) => ({ name: p.agent, text: p.text })));
          p2Runs.push(runAgent(quantThreadId!, 'quant_agent', quantP2Msg, 'Quant'));
        }
        if (participants.some((p) => p.agent === 'Risk')) {
          const riskP2Msg = buildDiscussionPrompt('Risk', participants
            .filter((p) => p.agent !== 'Risk')
            .map((p) => ({ name: p.agent, text: p.text })));
          p2Runs.push(runAgent(riskThreadId!, 'risk_management_agent', riskP2Msg, 'Risk'));
        }

        startCommitteeThinking(participants.map(p => p.agent));
        await Promise.all(p2Runs);
      }
    } finally {
      if (!isMountedRef.current) return;
      setIsStreaming(false);
      stopCommitteeThinkingImmediate();
    }
  };

  const handleNewChat = async () => {
    // If an empty draft chat already exists, focus it instead of creating another.
    // This matches ChatGPT-style behavior: at most one unused chat at a time.
    const existingDraft = chatSessions.find(
      chat => !isBuiltInDefaultChat(chat) && chat.messages.length === 0
    );
    if (existingDraft) {
      setSelectedChatId(existingDraft.id);
      return;
    }

    const newId = `session-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const newChat: ChatSession = {
      id: newId,
      title: 'New Chat',
      timestamp: new Date().toISOString(),
      messages: [],
    };
    setChatSessions(prev => [newChat, ...prev]);
    setSelectedChatId(newId);
  };

  const handleDeleteChat = (chatId: string) => {
    const confirmed = window.confirm('Are you sure you want to delete this chat? This action cannot be undone.');
    if (!confirmed) return;
    
    const chatToDelete = chatSessions.find(chat => chat.id === chatId);
    if (chatToDelete?.threadId) {
      removeThreadTitle(chatToDelete.threadId);
    }
    if (chatToDelete?.researchThreadId) removeThreadTitle(chatToDelete.researchThreadId);
    if (chatToDelete?.quantThreadId) removeThreadTitle(chatToDelete.quantThreadId);
    if (chatToDelete?.riskThreadId) removeThreadTitle(chatToDelete.riskThreadId);

    if (chatToDelete?.id.startsWith('chat-')) {
      hideDefaultChatId(chatToDelete.id);
    }

    const nextSessions = chatSessions.filter(chat => chat.id !== chatId);
    setChatSessions(nextSessions);
    if (selectedChatId === chatId && nextSessions.length > 0) {
      setSelectedChatId(sortSessionsByLastEdited(nextSessions)[0]?.id || '');
    }
  };

  const handleStartRename = (chatId: string) => {
    const chat = chatSessions.find((item) => item.id === chatId);
    if (!chat) return;
    setEditingChatId(chatId);
    setEditingTitle(chat.title);
  };

  const handleSaveRename = (chatId: string) => {
    const nextTitle = editingTitle.trim();
    if (!nextTitle) {
      setEditingChatId(null);
      setEditingTitle('');
      return;
    }

    const chat = chatSessions.find((item) => item.id === chatId);
    if (chat?.threadId) saveThreadTitle(chat.threadId, nextTitle);
    if (chat?.researchThreadId) saveThreadTitle(chat.researchThreadId, nextTitle);
    if (chat?.quantThreadId) saveThreadTitle(chat.quantThreadId, nextTitle);
    if (chat?.riskThreadId) saveThreadTitle(chat.riskThreadId, nextTitle);

    setChatSessions(prev => prev.map(item => (
      item.id === chatId ? { ...item, title: nextTitle, timestamp: new Date().toISOString() } : item
    )));
    setEditingChatId(null);
    setEditingTitle('');
  };

  const handleDownloadChat = (chatId: string) => {
    const chat = chatSessions.find(c => c.id === chatId);
    if (!chat) return;

    // Create a formatted text version of the chat
    const chatContent = chat.messages
      .map((msg) => {
        const contentStr = typeof msg.content === 'string' ? msg.content : '';
        return `[${msg.sender}] ${msg.timestamp || new Date().toLocaleTimeString()}\n${contentStr}\n`;
      })
      .join('\n---\n\n');

    const fullContent = `Chat: ${chat.title}\nDate: ${chat.timestamp}\n\n${chatContent}`;

    // Create and download the file
    const blob = new Blob([fullContent], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `chat-${chat.title.replace(/\s+/g, '-')}-${new Date().toISOString().split('T')[0]}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex h-[calc(100vh-120px)] gap-6">
      {/* Left Sidebar - Chat History */}
      <div className="w-72 bg-slate-900/50 border border-slate-800 rounded-xl flex flex-col">
        <div className="p-4 border-b border-slate-800 flex items-center justify-between flex-shrink-0">
          <h2 className="text-slate-100 font-medium">Chat History</h2>
          <button
            onClick={handleNewChat}
            className="p-2 hover:bg-slate-800 rounded-lg transition-colors text-slate-400 hover:text-slate-100"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {chatSessions.length === 0 ? (
            <div className="text-center py-12 px-4">
              <p className="text-slate-500 text-sm">No chats yet. Create a new chat.</p>
            </div>
          ) : (
            sortedChatSessions.map((chat) => (
              <div
                key={chat.id}
                onMouseEnter={() => setHoveredChatId(chat.id)}
                onMouseLeave={() => setHoveredChatId(null)}
                onClick={() => setSelectedChatId(chat.id)}
                className={`p-3 rounded-lg cursor-pointer transition-colors relative group ${
                  selectedChatId === chat.id
                    ? 'bg-slate-800 border border-emerald-500/30'
                    : 'bg-slate-800/30 border border-transparent hover:bg-slate-800/50'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    {editingChatId === chat.id ? (
                      <input
                        autoFocus
                        value={editingTitle}
                        onChange={(e) => setEditingTitle(e.target.value)}
                        onBlur={() => handleSaveRename(chat.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleSaveRename(chat.id);
                          }
                          if (e.key === 'Escape') {
                            setEditingChatId(null);
                            setEditingTitle('');
                          }
                        }}
                        onClick={(e) => e.stopPropagation()}
                        className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1 text-slate-100 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                      />
                    ) : (
                      <h3 className="text-slate-100 text-sm font-medium truncate">{chat.title}</h3>
                    )}
                    <p className="text-slate-500 text-xs mt-1">
                      {new Date(chat.timestamp).toLocaleDateString()}
                    </p>
                  </div>
                  {(hoveredChatId === chat.id || editingChatId === chat.id) && (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={(e) => { e.stopPropagation(); handleStartRename(chat.id); }}
                        className="p-1 hover:bg-slate-700 rounded text-slate-400 hover:text-slate-100 transition-colors"
                      >
                        <Edit2 className="w-3 h-3" />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDeleteChat(chat.id); }}
                        className="p-1 hover:bg-slate-700 rounded text-slate-400 hover:text-red-400 transition-colors"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Right Panel - Group Chat Workspace */}
      <div className="flex-1 bg-slate-900/50 border border-slate-800 rounded-xl flex flex-col">
        <div className="p-5 border-b border-slate-800 flex-shrink-0">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-slate-100 text-lg font-medium mb-1">ClearPath Chat</h1>
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-slate-500 text-xs">Agents:</span>
                {(['Research', 'Quant', 'Risk'] as const).map((agent) => (
                  <label key={agent} className="flex items-center gap-2 text-slate-400 text-sm select-none">
                    <input
                      type="checkbox"
                      checked={enabledAgents[agent]}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setEnabledAgents((prev) => ({ ...prev, [agent]: checked }));
                      }}
                      className="accent-emerald-500"
                    />
                    <span className={getAgentTextColor(agent)}>{agent}</span>
                  </label>
                ))}
                <span className="text-slate-500 text-xs">Advanced:</span>
                <label className="flex items-center gap-2 text-slate-400 text-sm select-none">
                  <input
                    type="checkbox"
                    checked={enableDebateRound}
                    onChange={(e) => setEnableDebateRound(e.target.checked)}
                    className="accent-emerald-500"
                  />
                  <span>Debate round</span>
                </label>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <div
                  className="w-2 h-2 rounded-full animate-pulse"
                  style={{ backgroundColor: isBackendOnline ? '#10b981' : '#ef4444' }}
                ></div>
                <span className="text-slate-400 text-sm">System Status: {isBackendOnline ? 'Online' : 'Offline'}</span>
              </div>
              {selectedChat && selectedChat.messages.length > 0 && (
                <button
                  onClick={() => handleDownloadChat(selectedChat.id)}
                  className="p-2 hover:bg-slate-700 rounded text-slate-400 hover:text-emerald-400 transition-colors"
                  title="Download chat"
                >
                  <Download className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Messages Area */}
        <div ref={scrollContainerRef} className="flex-1 overflow-y-auto p-6 space-y-6 min-h-0">
          {selectedChat && selectedChat.messages.length > 0 && selectedChat.messages.map((msg, index) => (
              <div
                key={msg.id ?? index}
                className={`flex ${msg.sender === 'User' ? 'justify-end' : 'justify-start'}`}
              >
                {msg.sender === 'User' ? (
                  <div className="max-w-[70%]">
                    <div className="bg-emerald-600 text-white p-4 rounded-xl">
                      {msg.content}
                    </div>
                  </div>
                ) : (
                  <AgentMessageCard
                    msg={msg}
                    streamingText={msg.isStreaming && msg.id ? streamingTexts[msg.id] : undefined}
                  />
                )}
              </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        <CommitteeThinkingIndicator phase={committeeThinking.phase} agents={committeeThinking.agents} />

        {/* Input Area */}
        <div className="border-t border-slate-800 p-4 flex-shrink-0">
          <input
            ref={fileInputRef}
            type="file"
            accept={CHAT_TEXT_ATTACHMENT_ACCEPT}
            onChange={handleAttachmentSelect}
            tabIndex={-1}
            aria-hidden="true"
            style={{ display: 'none' }}
          />
          {(attachedFile || attachmentError) && (
            <div className="mb-3 space-y-2">
              {attachedFile && (
                <div className="inline-flex max-w-full items-center gap-3 rounded-lg border border-slate-700 bg-slate-800/70 px-3 py-2 text-sm">
                  <div className="min-w-0">
                    <div className="truncate text-slate-100">{attachedFile.name}</div>
                    <div className="text-xs text-slate-400">{formatAttachmentSize(attachedFile.size)}</div>
                  </div>
                  <button
                    type="button"
                    onClick={clearAttachment}
                    aria-label="Remove attachment"
                    className="shrink-0 rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-700/60 hover:text-slate-100"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )}
              {attachmentError && (
                <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                  {attachmentError}
                </div>
              )}
            </div>
          )}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="p-3 hover:bg-slate-800 rounded-lg transition-colors text-slate-400 hover:text-slate-100 cursor-pointer"
              title="Attach a text file"
            >
              <Paperclip className="w-5 h-5" />
            </button>
            <input
              type="text"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
              placeholder="Ask the committee a financial question..."
              className="flex-1 px-4 py-3 bg-slate-800/50 border border-slate-700 rounded-lg text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500"
            />
            <Button
              onClick={handleSendMessage}
              disabled={isStreaming}
              className="bg-emerald-600 hover:bg-emerald-700 text-white px-6 disabled:opacity-50"
            >
              {isStreaming ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Demo Messages for NVDA Chat
const demoMessages: ChatMessage[] = [
  {
    sender: 'User',
    content: "Evaluate NVDA over the next 90 days. I'm considering a medium-sized position.",
  },
  {
    sender: 'Research',
    content: (
      <div className="space-y-4">
        <div>
          <h4 className="text-slate-100 font-medium mb-2">Business Drivers & Context</h4>
          <ul className="space-y-1.5 text-slate-300">
            <li>• <strong>AI/Data Center Demand:</strong> Continued strong demand for H100/H200 GPUs, with new Blackwell architecture launching Q2</li>
            <li>• <strong>Product Cycle:</strong> Mid-cycle with robust order backlog extending through 2026</li>
            <li>• <strong>Market Position:</strong> Dominant 80%+ share in AI training chips, emerging competition from AMD/custom silicon</li>
          </ul>
        </div>
        <div>
          <h4 className="text-slate-100 font-medium mb-2">Recent Catalysts</h4>
          <ul className="space-y-1.5 text-slate-300">
            <li>• Q4 earnings beat expectations (revenue +265% YoY)</li>
            <li>• Raised FY guidance citing enterprise AI adoption acceleration</li>
            <li>• New partnerships with major cloud providers (MSFT, GOOGL)</li>
          </ul>
        </div>
        <div>
          <h4 className="text-slate-100 font-medium mb-2">Key Watch Items (90-day horizon)</h4>
          <ul className="space-y-1.5 text-slate-300">
            <li>• Export control policy changes (China exposure ~20% of revenue)</li>
            <li>• Fed rate trajectory and tech multiple compression risk</li>
            <li>• Customer concentration (top 5 customers = ~40% revenue)</li>
            <li>• Competitive product launches from AMD (MI300 ramp)</li>
          </ul>
        </div>
        <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4 mt-4">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div><div className="text-slate-500 mb-1">Revenue Growth (YoY)</div><div className="text-slate-100 font-medium">+122%</div></div>
            <div><div className="text-slate-500 mb-1">Gross Margin</div><div className="text-slate-100 font-medium">74.6%</div></div>
            <div><div className="text-slate-500 mb-1">Forward P/E</div><div className="text-slate-100 font-medium">32.5x</div></div>
            <div><div className="text-slate-500 mb-1">PEG Ratio</div><div className="text-slate-100 font-medium">0.41</div></div>
          </div>
        </div>
      </div>
    ),
  },
  {
    sender: 'Quant',
    content: (
      <div className="space-y-4">
        <div>
          <h4 className="text-slate-100 font-medium mb-2">Technical & Quantitative View</h4>
          <p className="text-slate-300 mb-3"><strong>Trend Direction:</strong> Bullish with consolidation pattern forming near recent highs</p>
          <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><div className="text-slate-500">Support Level</div><div className="text-emerald-400 font-medium">$128.50</div></div>
              <div><div className="text-slate-500">Resistance Level</div><div className="text-red-400 font-medium">$152.80</div></div>
              <div><div className="text-slate-500">Current Price</div><div className="text-slate-100 font-medium">$140.25</div></div>
              <div><div className="text-slate-500">Volatility (30d)</div><div className="text-slate-100 font-medium">High (48%)</div></div>
            </div>
          </div>
        </div>
        <div>
          <h4 className="text-slate-100 font-medium mb-2">90-Day Scenario Bands</h4>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between items-center p-2 bg-emerald-900/20 border border-emerald-800/30 rounded">
              <span className="text-slate-300">Bull Case (25th percentile)</span>
              <span className="text-emerald-400 font-medium">$168 - $182</span>
            </div>
            <div className="flex justify-between items-center p-2 bg-slate-800/50 border border-slate-700 rounded">
              <span className="text-slate-300">Base Case (median)</span>
              <span className="text-slate-100 font-medium">$148 - $158</span>
            </div>
            <div className="flex justify-between items-center p-2 bg-red-900/20 border border-red-800/30 rounded">
              <span className="text-slate-300">Bear Case (75th percentile)</span>
              <span className="text-red-400 font-medium">$118 - $132</span>
            </div>
          </div>
        </div>
        <div>
          <h4 className="text-slate-100 font-medium mb-2">Signal Summary</h4>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-700">
                  <th className="text-left text-slate-400 font-normal pb-2">Indicator</th>
                  <th className="text-center text-slate-400 font-normal pb-2">Signal</th>
                  <th className="text-right text-slate-400 font-normal pb-2">Strength</th>
                </tr>
              </thead>
              <tbody className="text-slate-300">
                <tr className="border-b border-slate-800"><td className="py-2">Momentum (RSI)</td><td className="text-center"><span className="text-emerald-400">Bullish</span></td><td className="text-right">7/10</td></tr>
                <tr className="border-b border-slate-800"><td className="py-2">Volatility Regime</td><td className="text-center"><span className="text-yellow-400">Elevated</span></td><td className="text-right">8/10</td></tr>
                <tr className="border-b border-slate-800"><td className="py-2">Market Breadth</td><td className="text-center"><span className="text-emerald-400">Positive</span></td><td className="text-right">6/10</td></tr>
                <tr><td className="py-2">Relative Strength</td><td className="text-center"><span className="text-emerald-400">Outperforming</span></td><td className="text-right">9/10</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    ),
  },
  {
    sender: 'Risk',
    content: (
      <div className="space-y-4">
        <div>
          <h4 className="text-slate-100 font-medium mb-2">Risk Assessment & Downside Framework</h4>
          <p className="text-slate-300 mb-3">High reward potential comes with elevated risk profile. Key concerns:</p>
        </div>
        <div className="bg-yellow-900/20 border border-yellow-800/30 rounded-lg p-4">
          <h5 className="text-yellow-400 font-medium mb-2 flex items-center gap-2"><span>⚠️</span> Primary Risk Factors</h5>
          <ul className="space-y-1.5 text-slate-300 text-sm">
            <li>• <strong>Event Risk:</strong> Earnings in 3 weeks—guidance sensitivity to any demand softness</li>
            <li>• <strong>Valuation Risk:</strong> Trading at premium multiples; vulnerable to sector rotation</li>
            <li>• <strong>Macro Risk:</strong> Fed policy uncertainty; rising rates compress growth stock valuations</li>
            <li>• <strong>Concentration Risk:</strong> If you already hold tech-heavy portfolio, adds to single-sector exposure</li>
            <li>• <strong>Regulatory Risk:</strong> Potential export restrictions could impact 20% of revenue base</li>
          </ul>
        </div>
        <div>
          <h4 className="text-slate-100 font-medium mb-2">Worst-Case Drawdown Scenarios (90-day)</h4>
          <div className="space-y-2 text-sm">
            <div className="p-3 bg-slate-800/50 border border-slate-700 rounded">
              <div className="flex justify-between mb-1"><span className="text-slate-400">Mild correction (earnings miss)</span><span className="text-red-400 font-medium">-12% to -18%</span></div>
              <div className="text-slate-500 text-xs">Price target: $115 - $123</div>
            </div>
            <div className="p-3 bg-slate-800/50 border border-slate-700 rounded">
              <div className="flex justify-between mb-1"><span className="text-slate-400">Sector selloff (macro shock)</span><span className="text-red-400 font-medium">-25% to -35%</span></div>
              <div className="text-slate-500 text-xs">Price target: $91 - $105</div>
            </div>
          </div>
        </div>
        <div>
          <h4 className="text-slate-100 font-medium mb-2">Risk Mitigation Suggestions</h4>
          <ul className="space-y-1.5 text-slate-300 text-sm">
            <li>• Limit position size to 5-8% of portfolio (medium position per your request)</li>
            <li>• Stage entries: 40% now, 30% on pullback, 30% post-earnings</li>
            <li>• Set mechanical stop-loss at -15% from entry ($119 level)</li>
            <li>• Consider protective puts (Feb $135 strike) if holding through earnings</li>
            <li>• Hedge with uncorrelated assets (bonds, commodities) or sector-neutral positions</li>
          </ul>
        </div>
      </div>
    ),
  },
  {
    sender: 'Quant',
    content: (
      <div className="text-slate-300 text-sm">
        <strong>Challenge to Research:</strong> The "pricing power" narrative assumes demand stays inelastic, but if multiple cloud providers develop custom ASICs (like Google's TPU v5), NVDA's pricing leverage could fade faster than the 2-year timeline you're modeling. We're seeing early signs in the margin data.
      </div>
    ),
  },
  {
    sender: 'Research',
    content: (
      <div className="text-slate-300 text-sm">
        <strong>Response:</strong> Fair point on custom silicon risk. However, the software moat (CUDA ecosystem) creates high switching costs—most enterprise AI frameworks are CUDA-native. Even with custom chips, hybrid architectures will likely include NVDA for the next 18-24 months. Agree we should monitor margin trends closely as a leading indicator.
      </div>
    ),
  },
  {
    sender: 'Risk',
    content: (
      <div className="text-slate-300 text-sm">
        <strong>Flagging uncertainty:</strong> Both of you make valid points, but this debate highlights execution risk. Given the binary nature of the next earnings call and macro crosscurrents, I recommend <strong>staged entry</strong> rather than full position immediately. This reduces regret risk if the thesis takes longer to play out.
      </div>
    ),
  },
  {
    sender: 'Committee',
    content: (
      <div className="space-y-4">
        <div>
          <h3 className="text-slate-100 font-semibold mb-3">Investment Thesis</h3>
          <p className="text-slate-300 leading-relaxed">
            NVDA presents a compelling but volatile opportunity over the next 90 days. The company maintains dominant positioning in AI infrastructure with strong secular tailwinds, robust order backlog, and significant product cycle momentum. However, elevated valuation multiples, upcoming earnings volatility, and macro uncertainty warrant a disciplined, risk-managed approach rather than aggressive accumulation.
          </p>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-emerald-900/20 border border-emerald-800/30 rounded-lg p-4">
            <h4 className="text-emerald-400 font-medium mb-2">Bull Case</h4>
            <ul className="space-y-1 text-slate-300 text-sm">
              <li>• AI demand exceeds guidance</li>
              <li>• Blackwell launch accelerates</li>
              <li>• Multiple expansion on scarcity</li>
            </ul>
          </div>
          <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4">
            <h4 className="text-slate-300 font-medium mb-2">Base Case</h4>
            <ul className="space-y-1 text-slate-300 text-sm">
              <li>• Steady growth, in-line earnings</li>
              <li>• Stable market share ~75-80%</li>
              <li>• Modest multiple compression</li>
            </ul>
          </div>
          <div className="bg-red-900/20 border border-red-800/30 rounded-lg p-4">
            <h4 className="text-red-400 font-medium mb-2">Bear Case</h4>
            <ul className="space-y-1 text-slate-300 text-sm">
              <li>• Demand normalization fears</li>
              <li>• Export restrictions tighten</li>
              <li>• Sector rotation out of tech</li>
            </ul>
          </div>
        </div>
        <div className="bg-purple-900/20 border border-purple-800/30 rounded-lg p-4">
          <h4 className="text-purple-400 font-medium mb-3">Recommended Approach</h4>
          <div className="space-y-3 text-slate-300 text-sm">
            <div>
              <div className="font-medium text-slate-200 mb-1">Entry Plan (Staged)</div>
              <ul className="space-y-1">
                <li>• <strong>Tranche 1 (40%):</strong> Enter at current levels $138-$142</li>
                <li>• <strong>Tranche 2 (30%):</strong> Add on any pullback to $128-$132 support</li>
                <li>• <strong>Tranche 3 (30%):</strong> Post-earnings if thesis confirms (reserve cash)</li>
              </ul>
            </div>
            <div>
              <div className="font-medium text-slate-200 mb-1">Position Size Guidance</div>
              <p>Allocate 5-7% of portfolio (medium position). Adjust down to 4% if your current tech exposure already exceeds 35%.</p>
            </div>
            <div>
              <div className="font-medium text-slate-200 mb-1">Risk Controls</div>
              <ul className="space-y-1">
                <li>• <strong>Stop-loss:</strong> -15% from average entry (mechanical exit at $119)</li>
                <li>• <strong>Hedge option:</strong> Buy Feb $135 puts if holding through earnings (costs ~2.5%)</li>
                <li>• <strong>Time-based exit:</strong> Reassess full position if no breakout above $155 by Day 60</li>
              </ul>
            </div>
          </div>
        </div>
        <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4">
          <h4 className="text-slate-100 font-medium mb-2">What Would Change Our View</h4>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <div className="text-emerald-400 font-medium mb-1">Bullish Triggers</div>
              <ul className="space-y-1 text-slate-300">
                <li>• Earnings beat + raised guidance</li>
                <li>• New hyperscaler contracts announced</li>
                <li>• Fed pivot signals (rate cuts)</li>
              </ul>
            </div>
            <div>
              <div className="text-red-400 font-medium mb-1">Bearish Triggers</div>
              <ul className="space-y-1 text-slate-300">
                <li>• Guidance miss or cautious tone</li>
                <li>• Export restrictions expanded</li>
                <li>• Break below $128 support level</li>
              </ul>
            </div>
          </div>
        </div>
        <div className="text-center pt-2">
          <p className="text-slate-500 text-xs">Committee consensus reached • Analysis complete • Confidence level: Medium-High</p>
        </div>
      </div>
    ),
  },
];
