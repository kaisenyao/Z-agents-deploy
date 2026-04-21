import type { CanonicalInvestmentReportExport } from '../services/investmentReportExport';
import {
  formatReportCurrency,
  formatReportDateTime,
  formatReportPercent,
} from '../services/investmentReportExport';

interface InvestmentReportPrintViewProps {
  report: CanonicalInvestmentReportExport;
}

function PrintList({ items }: { items: string[] }) {
  return (
    <ul className="print-list">
      {items.map((item, index) => (
        <li key={`${item}-${index}`}>{item}</li>
      ))}
    </ul>
  );
}

function SummaryCard(props: { label: string; value: string; explanation: string }) {
  return (
    <div className="summary-card">
      <div className="summary-label">{props.label}</div>
      <div className="summary-value">{props.value}</div>
      <p className="body-text compact">{props.explanation}</p>
    </div>
  );
}

function PrintPortfolioWeights({ weights }: { weights: Record<string, number> }) {
  const items = Object.entries(weights)
    .filter(([, weight]) => Number.isFinite(weight) && Math.abs(weight) > 1e-6)
    .sort((left, right) => right[1] - left[1]);

  if (!items.length) {
    return <p className="body-text compact">No active weights available.</p>;
  }

  return (
    <ul className="print-list">
      {items.map(([ticker, weight]) => (
        <li key={ticker}>{ticker}: {formatReportPercent(weight * 100)}</li>
      ))}
    </ul>
  );
}

function FrontierPortfolioCard(props: {
  title: string;
  expectedReturn: number;
  volatility: number;
  sharpe: number | null;
  weights: Record<string, number>;
}) {
  return (
    <div className="summary-card avoid-break">
      <div className="summary-label">{props.title}</div>
      <div className="meta-grid frontier-stats-grid">
        <div>
          <div className="meta-label">Return</div>
          <div className="meta-value">{formatReportPercent(props.expectedReturn * 100)}</div>
        </div>
        <div>
          <div className="meta-label">Volatility</div>
          <div className="meta-value">{formatReportPercent(props.volatility * 100)}</div>
        </div>
        <div>
          <div className="meta-label">Sharpe</div>
          <div className="meta-value">{props.sharpe === null ? '—' : props.sharpe.toFixed(2)}</div>
        </div>
      </div>
      <div className="summary-label" style={{ marginTop: '0.75rem' }}>Portfolio Weights</div>
      <PrintPortfolioWeights weights={props.weights} />
    </div>
  );
}

export function InvestmentReportPrintView({ report }: InvestmentReportPrintViewProps) {
  const { metadata, portfolio_composition, analysis, efficient_frontier, phase1Payload, references_methodology } = report;
  const note = analysis.note.trim();

  return (
    <div className="report-document">
      <header className="report-header section avoid-break">
        <div>
          <div className="eyebrow">ClearPath</div>
          <h1>Investment Report</h1>
          <p className="subtitle">Professional portfolio analysis generated from the canonical report contract.</p>
        </div>
        <div className="meta-grid">
          <div>
            <div className="meta-label">Portfolio</div>
            <div className="meta-value">{metadata.portfolio_name}</div>
          </div>
          <div>
            <div className="meta-label">Generated</div>
            <div className="meta-value">{formatReportDateTime(metadata.generated_at)}</div>
          </div>
          <div>
            <div className="meta-label">Time Horizon</div>
            <div className="meta-value">{analysis.time_horizon || 'Not provided'}</div>
          </div>
          <div>
            <div className="meta-label">Investor Note</div>
            <div className="meta-value">{note || 'None provided'}</div>
          </div>
        </div>
      </header>

      <section className="section">
        <div className="section-heading">Portfolio Composition</div>
        <div className="callout avoid-break">
          <div className="meta-label">Total Capital</div>
          <div className="callout-value">{formatReportCurrency(portfolio_composition.total_capital)}</div>
        </div>
        <div className="table-wrap">
          <table className="holdings-table">
            <thead>
              <tr>
                <th>Ticker</th>
                <th>Name</th>
                <th>Amount</th>
                <th>Allocation %</th>
              </tr>
            </thead>
            <tbody>
              {portfolio_composition.holdings.map((holding) => (
                <tr key={`${holding.ticker}-${holding.name}`}>
                  <td>{holding.ticker}</td>
                  <td>{holding.name}</td>
                  <td>{formatReportCurrency(holding.amount)}</td>
                  <td>{formatReportPercent(holding.allocation_pct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="section avoid-break">
        <div className="section-heading">Portfolio Highlights</div>
        <div className="card-grid two-col">
          <SummaryCard label="Theme Exposure" value={phase1Payload.portfolio_highlights.theme_exposure.score} explanation={phase1Payload.portfolio_highlights.theme_exposure.explanation} />
          <SummaryCard label="Diversification" value={phase1Payload.portfolio_highlights.diversification.score} explanation={phase1Payload.portfolio_highlights.diversification.explanation} />
          <SummaryCard label="Concentration" value={phase1Payload.portfolio_highlights.concentration.score} explanation={phase1Payload.portfolio_highlights.concentration.explanation} />
          <SummaryCard label="Volatility Profile" value={phase1Payload.portfolio_highlights.volatility_profile.score} explanation={phase1Payload.portfolio_highlights.volatility_profile.explanation} />
        </div>
      </section>

      <section className="section">
        <div className="section-heading">AI Committee Summary</div>
        <div className="callout avoid-break">
          <div className="meta-label">{phase1Payload.ai_committee_summary.thesis.title}</div>
          <p className="body-text">{phase1Payload.ai_committee_summary.thesis.body}</p>
          <PrintList items={phase1Payload.ai_committee_summary.summary_points} />
        </div>
        <div className="card-grid two-col">
          <SummaryCard label="Recommendation" value={phase1Payload.ai_committee_summary.recommendation.value} explanation={phase1Payload.ai_committee_summary.recommendation.explanation} />
          <SummaryCard label="Position Size" value={phase1Payload.ai_committee_summary.position_size.value} explanation={phase1Payload.ai_committee_summary.position_size.explanation} />
          <SummaryCard label="Risk Level" value={phase1Payload.ai_committee_summary.risk_level.value} explanation={phase1Payload.ai_committee_summary.risk_level.explanation} />
          <SummaryCard label="Conviction" value={phase1Payload.ai_committee_summary.conviction.value} explanation={phase1Payload.ai_committee_summary.conviction.explanation} />
        </div>
      </section>

      <section className="section">
        <div className="section-heading">Research Insights</div>
        <div className="card-grid three-col">
          <div className="summary-card avoid-break">
            <div className="summary-label">Key Insight</div>
            <PrintList items={phase1Payload.research_agent.key_insight} />
          </div>
          <div className="summary-card avoid-break">
            <div className="summary-label">Key Drivers</div>
            <PrintList items={phase1Payload.research_agent.key_drivers} />
          </div>
          <div className="summary-card avoid-break">
            <div className="summary-label">Implications</div>
            <p className="body-text compact">{phase1Payload.research_agent.implications}</p>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="section-heading">Quantitative Diagnostics</div>
        <div className="card-grid two-col">
          <div className="summary-card avoid-break">
            <div className="summary-label">Metrics</div>
            <PrintList items={phase1Payload.quant_agent.metrics} />
          </div>
          <div className="summary-card avoid-break">
            <div className="summary-label">Indicators</div>
            <PrintList items={phase1Payload.quant_agent.indicators} />
          </div>
          <div className="summary-card avoid-break">
            <div className="summary-label">Correlation</div>
            <div className="summary-value">{phase1Payload.quant_agent.correlation.summary}</div>
            <p className="body-text compact">{phase1Payload.quant_agent.correlation.interpretation}</p>
          </div>
          <div className="summary-card avoid-break">
            <div className="summary-label">Concentration Conclusion</div>
            <p className="body-text compact">{phase1Payload.quant_agent.concentration.conclusion}</p>
          </div>
        </div>
        {efficient_frontier ? (
          <>
          <div className="callout avoid-break frontier-callout">
            <div className="meta-grid frontier-meta-grid">
              <div>
                <div className="meta-label">Modeled Assets</div>
                <div className="meta-value">{efficient_frontier.universe.assetCount}</div>
              </div>
              <div>
                <div className="meta-label">Shared Monthly Observations</div>
                <div className="meta-value">{efficient_frontier.universe.sharedMonthlyObservations}</div>
              </div>
              <div>
                <div className="meta-label">Frontier Portfolios</div>
                <div className="meta-value">{efficient_frontier.frontierPortfolios.length}</div>
              </div>
              <div>
                <div className="meta-label">Modeled Range</div>
                <div className="meta-value">{efficient_frontier.universe.startDate} to {efficient_frontier.universe.endDate}</div>
              </div>
            </div>
          </div>
          <div className="card-grid three-col">
            <FrontierPortfolioCard
              title={efficient_frontier.currentPortfolio.label}
              expectedReturn={efficient_frontier.currentPortfolio.expectedReturn}
              volatility={efficient_frontier.currentPortfolio.volatility}
              sharpe={efficient_frontier.currentPortfolio.sharpe}
              weights={efficient_frontier.currentPortfolio.weights}
            />
            <FrontierPortfolioCard
              title="Tangency Portfolio"
              expectedReturn={efficient_frontier.maxSharpePortfolio.expectedReturn}
              volatility={efficient_frontier.maxSharpePortfolio.volatility}
              sharpe={efficient_frontier.maxSharpePortfolio.sharpe}
              weights={efficient_frontier.maxSharpePortfolio.weights}
            />
            <FrontierPortfolioCard
              title="Minimum Volatility Portfolio"
              expectedReturn={efficient_frontier.minimumVolatilityPortfolio.expectedReturn}
              volatility={efficient_frontier.minimumVolatilityPortfolio.volatility}
              sharpe={efficient_frontier.minimumVolatilityPortfolio.sharpe}
              weights={efficient_frontier.minimumVolatilityPortfolio.weights}
            />
          </div>
          </>
        ) : null}
      </section>

      <section className="section">
        <div className="section-heading">Risk Analysis</div>
        <div className="card-grid two-col">
          <div className="summary-card avoid-break">
            <div className="summary-label">Structural Risks</div>
            <PrintList items={phase1Payload.risk_agent.structural_risks} />
          </div>
          <div className="summary-card avoid-break">
            <div className="summary-label">Risk Metrics</div>
            <PrintList items={phase1Payload.risk_agent.risk_metrics} />
          </div>
          <div className="summary-card avoid-break">
            <div className="summary-label">Scenario Analysis</div>
            <div className="scenario-grid">
              {phase1Payload.risk_agent.scenario_analysis.map((scenario) => (
                <div key={scenario.label} className="scenario-card">
                  <div className="scenario-label">{scenario.label}</div>
                  <p className="body-text compact">{scenario.description}</p>
                </div>
              ))}
            </div>
          </div>
          <div className="summary-card avoid-break">
            <div className="summary-label">Guardrails</div>
            <PrintList items={phase1Payload.risk_agent.guardrails} />
          </div>
        </div>
      </section>

      <section className="section avoid-break">
        <div className="section-heading">{references_methodology.title}</div>
        <div className="callout">
          {references_methodology.sections.map((section) => (
            <div key={section.key} className="stacked-item">
              <div className="summary-label">{section.title}</div>
              <p className="body-text compact">{section.body}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
