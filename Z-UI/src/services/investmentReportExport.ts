import type { InvestmentReportPhase1Payload } from './api';
import type { EfficientFrontierAnalysis } from './efficientFrontier';

export interface InvestmentReportExportPortfolio {
  name: string;
  budget: number;
  totalAllocated: number;
  items: Array<{ ticker: string; name: string; amount: number }>;
}

export interface CanonicalInvestmentReportExport {
  metadata: {
    portfolio_name: string;
    generated_at: string;
  };
  portfolio_composition: {
    total_capital: number;
    holdings: Array<{
      ticker: string;
      name: string;
      amount: number;
      allocation_pct: number;
    }>;
  };
  analysis: {
    time_horizon: string;
    note: string;
  };
  efficient_frontier?: EfficientFrontierAnalysis | null;
  phase1Payload: InvestmentReportPhase1Payload;
  references_methodology: InvestmentReportReferencesMethodology;
}

export interface InvestmentReportReferencesMethodologyItem {
  key:
    | 'market_data_sources'
    | 'analytical_framework'
    | 'model_assumptions'
    | 'user_inputs'
    | 'disclosure';
  title: string;
  body: string;
}

export interface InvestmentReportReferencesMethodology {
  title: 'References & Methodology';
  sections: InvestmentReportReferencesMethodologyItem[];
}

interface BuildReferencesMethodologyArgs {
  phase1Payload: InvestmentReportPhase1Payload;
  timeHorizon: string;
  note: string;
  strategyType?: string;
  portfolio?: InvestmentReportExportPortfolio;
}

export function buildDownloadPhase1Payload(payload: InvestmentReportPhase1Payload): InvestmentReportPhase1Payload {
  return {
    portfolio_highlights: {
      theme_exposure: payload.portfolio_highlights.theme_exposure,
      diversification: payload.portfolio_highlights.diversification,
      concentration: payload.portfolio_highlights.concentration,
      volatility_profile: payload.portfolio_highlights.volatility_profile,
    },
    ai_committee_summary: {
      recommendation: payload.ai_committee_summary.recommendation,
      position_size: payload.ai_committee_summary.position_size,
      risk_level: payload.ai_committee_summary.risk_level,
      conviction: payload.ai_committee_summary.conviction,
      thesis: payload.ai_committee_summary.thesis,
      summary_points: payload.ai_committee_summary.summary_points,
    },
    research_agent: {
      key_insight: payload.research_agent.key_insight,
      key_drivers: payload.research_agent.key_drivers,
      implications: payload.research_agent.implications,
    },
    quant_agent: {
      metrics: payload.quant_agent.metrics,
      indicators: payload.quant_agent.indicators,
      correlation: payload.quant_agent.correlation,
      concentration: payload.quant_agent.concentration,
    },
    risk_agent: {
      structural_risks: payload.risk_agent.structural_risks,
      risk_metrics: payload.risk_agent.risk_metrics,
      scenario_analysis: payload.risk_agent.scenario_analysis,
      guardrails: payload.risk_agent.guardrails,
    },
    references: {
      market_data: payload.references.market_data,
      model_assumptions: payload.references.model_assumptions,
    },
  };
}

export function buildReferencesMethodologySection(
  args: BuildReferencesMethodologyArgs
): InvestmentReportReferencesMethodology {
  const marketData = args.phase1Payload.references.market_data.trim() || 'Portfolio composition and asset allocations as of report generation.';
  const modelAssumptions = args.phase1Payload.references.model_assumptions.trim() || 'Factor exposure analysis, volatility framing, concentration diagnostics, and scenario descriptions are based on the current portfolio structure.';
  const holdingsCount = args.portfolio?.items.length ?? 0;
  const totalCapital = args.portfolio
    ? buildExportPortfolioComposition(args.portfolio).total_capital
    : 0;
  const note = args.note.trim();
  const strategyType = args.strategyType?.trim() || 'Not provided';
  const timeHorizon = args.timeHorizon.trim() || 'Not provided';
  const holdingsLabel = `${holdingsCount} user-specified holding${holdingsCount === 1 ? '' : 's'}`;
  const capitalSummary = totalCapital > 0
    ? `${holdingsLabel} across ${formatReportCurrency(totalCapital)} of total capital.`
    : `${holdingsLabel}.`;

  return {
    title: 'References & Methodology',
    sections: [
      {
        key: 'market_data_sources',
        title: 'Market Data Sources',
        body: `${marketData} Portfolio composition, position sizing, and allocation weights reflect the user-supplied holdings used to generate this report together with publicly available market information.`,
      },
      {
        key: 'analytical_framework',
        title: 'Analytical Framework',
        body: 'This report combines deterministic portfolio diagnostics with a multi-agent AI committee framework. Research evaluates fundamental and market context, Quant assesses structural and technical diagnostics, and Risk frames concentration, downside scenarios, and guardrails.',
      },
      {
        key: 'model_assumptions',
        title: 'Model Assumptions',
        body: `${modelAssumptions} The report does not rely on external factor models, proprietary risk models, or technical indicators unless those inputs are explicitly provided in the underlying analysis context.`,
      },
      {
        key: 'user_inputs',
        title: 'User Inputs',
        body: `Time horizon: ${timeHorizon}. Portfolio objective: ${strategyType}. Allocation inputs: ${capitalSummary} ${note ? `Analysis note: "${note}"` : 'No additional analysis note was provided.'}`,
      },
      {
        key: 'disclosure',
        title: 'Disclosure',
        body: 'This report is provided for informational purposes only. It reflects structured portfolio analysis and AI-generated committee reasoning and should not be construed as personalized investment advice, an offer, or a solicitation to buy or sell any security.',
      },
    ],
  };
}

export function buildExportPortfolioComposition(portfolio: InvestmentReportExportPortfolio) {
  const totalCapital =
    portfolio.totalAllocated ||
    portfolio.budget ||
    portfolio.items.reduce((sum, item) => sum + item.amount, 0);

  return {
    total_capital: totalCapital,
    holdings: portfolio.items.map((item) => ({
      ticker: item.ticker,
      name: item.name,
      amount: item.amount,
      allocation_pct: totalCapital > 0 ? Number(((item.amount / totalCapital) * 100).toFixed(2)) : 0,
    })),
  };
}

export function buildCanonicalInvestmentReportExport(args: {
  portfolioName: string;
  generatedAt: string;
  timeHorizon: string;
  note: string;
  strategyType?: string;
  portfolio: InvestmentReportExportPortfolio;
  phase1Payload: InvestmentReportPhase1Payload;
  efficientFrontierAnalysis?: EfficientFrontierAnalysis | null;
}): CanonicalInvestmentReportExport {
  return {
    metadata: {
      portfolio_name: args.portfolioName,
      generated_at: args.generatedAt,
    },
    portfolio_composition: buildExportPortfolioComposition(args.portfolio),
    analysis: {
      time_horizon: args.timeHorizon,
      note: args.note,
    },
    efficient_frontier: args.efficientFrontierAnalysis ?? null,
    phase1Payload: buildDownloadPhase1Payload(args.phase1Payload),
    references_methodology: buildReferencesMethodologySection({
      phase1Payload: args.phase1Payload,
      timeHorizon: args.timeHorizon,
      note: args.note,
      strategyType: args.strategyType,
      portfolio: args.portfolio,
    }),
  };
}

export function formatReportCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatReportPercent(value: number): string {
  return `${value.toFixed(2)}%`;
}

export function formatReportDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}
