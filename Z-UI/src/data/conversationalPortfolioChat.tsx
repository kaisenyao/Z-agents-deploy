export interface ChatMessage {
  sender: 'User' | 'Research' | 'Quant' | 'Risk' | 'Committee';
  content: React.ReactNode;
  timestamp?: string;
}

export const conversationalPortfolioChat: ChatMessage[] = [
  {
    sender: 'User',
    content: 'I need a comprehensive evaluation of my current portfolio. Can you analyze the allocation, risk profile, and provide recommendations?',
  },
  {
    sender: 'Research',
    content: (
      <div className="space-y-4">
        <div>
          <h4 className="text-slate-100 font-medium mb-2">Portfolio Overview Analysis</h4>
          <p className="text-slate-300 mb-3">
            I've analyzed your portfolio composition and identified several key characteristics worth discussing.
          </p>
          
          <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4 mb-3">
            <h5 className="text-slate-100 font-medium mb-2">Current Allocation Breakdown</h5>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between items-center">
                <span className="text-slate-400">Technology Sector</span>
                <span className="text-slate-100 font-medium">45%</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-400">Healthcare</span>
                <span className="text-slate-100 font-medium">20%</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-400">Financial Services</span>
                <span className="text-slate-100 font-medium">15%</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-400">Consumer Discretionary</span>
                <span className="text-slate-100 font-medium">12%</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-400">Cash/Other</span>
                <span className="text-slate-100 font-medium">8%</span>
              </div>
            </div>
          </div>
        </div>

        <div>
          <h4 className="text-slate-100 font-medium mb-2">Key Observations</h4>
          <ul className="space-y-1.5 text-slate-300">
            <li>• <strong>Tech-Heavy Concentration:</strong> 45% allocation to technology represents elevated sector risk</li>
            <li>• <strong>Growth Bias:</strong> Portfolio skews toward growth stocks with limited value exposure</li>
            <li>• <strong>Geographic Concentration:</strong> Predominantly U.S.-focused with minimal international diversification</li>
            <li>• <strong>Dividend Yield:</strong> Current portfolio yield of 1.2% is below market average</li>
          </ul>
        </div>

        <div>
          <h4 className="text-slate-100 font-medium mb-2">Top Holdings Performance Context</h4>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="bg-slate-800/50 border border-slate-700 rounded p-3">
              <div className="text-slate-400 mb-1">Best Performer (YTD)</div>
              <div className="text-emerald-400 font-medium">NVDA +78%</div>
            </div>
            <div className="bg-slate-800/50 border border-slate-700 rounded p-3">
              <div className="text-slate-400 mb-1">Laggard (YTD)</div>
              <div className="text-red-400 font-medium">JNJ -8%</div>
            </div>
            <div className="bg-slate-800/50 border border-slate-700 rounded p-3">
              <div className="text-slate-400 mb-1">Portfolio Beta</div>
              <div className="text-slate-100 font-medium">1.35</div>
            </div>
            <div className="bg-slate-800/50 border border-slate-700 rounded p-3">
              <div className="text-slate-400 mb-1">Sharpe Ratio (1Y)</div>
              <div className="text-slate-100 font-medium">1.18</div>
            </div>
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
          <h4 className="text-slate-100 font-medium mb-2">Quantitative Portfolio Metrics</h4>
          
          <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4 mb-3">
            <h5 className="text-slate-100 font-medium mb-3">Risk-Adjusted Performance</h5>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <div className="text-slate-500 mb-1">Annualized Return</div>
                <div className="text-emerald-400 font-medium text-lg">+24.3%</div>
              </div>
              <div>
                <div className="text-slate-500 mb-1">Annualized Volatility</div>
                <div className="text-yellow-400 font-medium text-lg">22.1%</div>
              </div>
              <div>
                <div className="text-slate-500 mb-1">Max Drawdown (1Y)</div>
                <div className="text-red-400 font-medium">-18.2%</div>
              </div>
              <div>
                <div className="text-slate-500 mb-1">Sortino Ratio</div>
                <div className="text-slate-100 font-medium">1.52</div>
              </div>
            </div>
          </div>
        </div>

        <div>
          <h4 className="text-slate-100 font-medium mb-2">Correlation Analysis</h4>
          <p className="text-slate-300 text-sm mb-2">
            High correlation between holdings suggests limited diversification benefits:
          </p>
          <ul className="space-y-1.5 text-slate-300 text-sm">
            <li>• NVDA-MSFT correlation: 0.72 (high tech sector correlation)</li>
            <li>• AAPL-GOOGL correlation: 0.68 (mega-cap tech cluster)</li>
            <li>• Portfolio correlation to S&P 500: 0.89 (tracks market closely)</li>
          </ul>
        </div>

        <div>
          <h4 className="text-slate-100 font-medium mb-2">Factor Exposure Breakdown</h4>
          <div className="space-y-2">
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span className="text-slate-400">Growth Factor</span>
                <span className="text-emerald-400 font-medium">+2.1σ</span>
              </div>
              <div className="w-full bg-slate-700 rounded-full h-2">
                <div className="bg-emerald-500 h-2 rounded-full" style={{ width: '82%' }}></div>
              </div>
            </div>
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span className="text-slate-400">Quality Factor</span>
                <span className="text-blue-400 font-medium">+1.3σ</span>
              </div>
              <div className="w-full bg-slate-700 rounded-full h-2">
                <div className="bg-blue-500 h-2 rounded-full" style={{ width: '65%' }}></div>
              </div>
            </div>
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span className="text-slate-400">Value Factor</span>
                <span className="text-red-400 font-medium">-1.8σ</span>
              </div>
              <div className="w-full bg-slate-700 rounded-full h-2">
                <div className="bg-red-500 h-2 rounded-full" style={{ width: '30%' }}></div>
              </div>
            </div>
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span className="text-slate-400">Momentum Factor</span>
                <span className="text-emerald-400 font-medium">+1.6σ</span>
              </div>
              <div className="w-full bg-slate-700 rounded-full h-2">
                <div className="bg-emerald-500 h-2 rounded-full" style={{ width: '72%' }}></div>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-blue-900/20 border border-blue-800/30 rounded-lg p-4">
          <h5 className="text-blue-400 font-medium mb-2">Rebalancing Signals</h5>
          <ul className="space-y-1.5 text-slate-300 text-sm">
            <li>• NVDA position has drifted to 18% (from target 12%) due to appreciation</li>
            <li>• Healthcare allocation 5% below target range</li>
            <li>• Consider trimming tech winners and rotating to defensive sectors</li>
          </ul>
        </div>
      </div>
    ),
  },
  {
    sender: 'Risk',
    content: (
      <div className="space-y-4">
        <div>
          <h4 className="text-slate-100 font-medium mb-2">Portfolio Risk Assessment</h4>
          
          <div className="bg-yellow-900/20 border border-yellow-800/30 rounded-lg p-4 mb-3">
            <h5 className="text-yellow-400 font-medium mb-2 flex items-center gap-2">
              <span>⚠️</span> Key Risk Factors Identified
            </h5>
            <ul className="space-y-2 text-slate-300 text-sm">
              <li>• <strong>Concentration Risk:</strong> Top 3 holdings represent 42% of portfolio value</li>
              <li>• <strong>Sector Risk:</strong> Technology concentration creates vulnerability to sector-specific shocks</li>
              <li>• <strong>Volatility Risk:</strong> Portfolio beta of 1.35 amplifies market movements</li>
              <li>• <strong>Interest Rate Sensitivity:</strong> Growth-heavy allocation vulnerable to rising rates</li>
              <li>• <strong>Geographic Risk:</strong> 92% U.S. exposure creates home country bias</li>
            </ul>
          </div>
        </div>

        <div>
          <h4 className="text-slate-100 font-medium mb-2">Stress Test Scenarios (Portfolio Impact)</h4>
          <div className="space-y-2 text-sm">
            <div className="p-3 bg-slate-800/50 border border-slate-700 rounded">
              <div className="flex justify-between mb-1">
                <span className="text-slate-400">Tech Sector Correction (-20%)</span>
                <span className="text-red-400 font-medium">Portfolio: -12.4%</span>
              </div>
              <div className="text-slate-500 text-xs">High sector concentration amplifies impact</div>
            </div>
            <div className="p-3 bg-slate-800/50 border border-slate-700 rounded">
              <div className="flex justify-between mb-1">
                <span className="text-slate-400">Market Crash (-30%)</span>
                <span className="text-red-400 font-medium">Portfolio: -38.2%</span>
              </div>
              <div className="text-slate-500 text-xs">High beta magnifies downside</div>
            </div>
            <div className="p-3 bg-slate-800/50 border border-slate-700 rounded">
              <div className="flex justify-between mb-1">
                <span className="text-slate-400">Rising Rate Environment (+200bps)</span>
                <span className="text-red-400 font-medium">Portfolio: -15.8%</span>
              </div>
              <div className="text-slate-500 text-xs">Growth stocks particularly vulnerable</div>
            </div>
          </div>
        </div>

        <div>
          <h4 className="text-slate-100 font-medium mb-2">Value at Risk (VaR) Analysis</h4>
          <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <div className="text-slate-500 mb-1">1-Day VaR (95%)</div>
                <div className="text-red-400 font-medium">-2.4%</div>
              </div>
              <div>
                <div className="text-slate-500 mb-1">1-Day VaR (99%)</div>
                <div className="text-red-400 font-medium">-3.8%</div>
              </div>
              <div>
                <div className="text-slate-500 mb-1">Expected Shortfall</div>
                <div className="text-red-400 font-medium">-4.2%</div>
              </div>
              <div>
                <div className="text-slate-500 mb-1">Tail Risk Index</div>
                <div className="text-yellow-400 font-medium">Elevated</div>
              </div>
            </div>
          </div>
        </div>

        <div>
          <h4 className="text-slate-100 font-medium mb-2">Risk Mitigation Recommendations</h4>
          <ul className="space-y-1.5 text-slate-300 text-sm">
            <li>• <strong>Diversify Sector Exposure:</strong> Reduce tech to 30-35%, add defensive sectors</li>
            <li>• <strong>Add International Exposure:</strong> Target 15-20% non-U.S. allocation</li>
            <li>• <strong>Rebalance Overweight Positions:</strong> Trim NVDA, MSFT to original targets</li>
            <li>• <strong>Incorporate Value Stocks:</strong> Add value-oriented positions to offset growth tilt</li>
            <li>• <strong>Consider Hedging:</strong> Use options or inverse positions during high volatility periods</li>
            <li>• <strong>Maintain Cash Buffer:</strong> Keep 10-15% in cash for opportunistic buying</li>
          </ul>
        </div>
      </div>
    ),
  },
  {
    sender: 'Committee',
    content: (
      <div className="space-y-4">
        <div>
          <h3 className="text-slate-100 font-semibold mb-3">Portfolio Evaluation Summary</h3>
          <p className="text-slate-300 leading-relaxed">
            Your portfolio has delivered strong absolute returns (+24.3% annualized) driven primarily by technology sector outperformance. However, this success has created concentration risks that warrant strategic rebalancing. The portfolio exhibits elevated volatility (beta 1.35) and limited diversification, making it vulnerable to sector-specific and market-wide corrections.
          </p>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div className="bg-emerald-900/20 border border-emerald-800/30 rounded-lg p-4">
            <h4 className="text-emerald-400 font-medium mb-2">Strengths</h4>
            <ul className="space-y-1 text-slate-300 text-sm">
              <li>• Strong absolute performance</li>
              <li>• High-quality holdings</li>
              <li>• Positive momentum exposure</li>
              <li>• Good liquidity profile</li>
            </ul>
          </div>
          <div className="bg-yellow-900/20 border border-yellow-800/30 rounded-lg p-4">
            <h4 className="text-yellow-400 font-medium mb-2">Concerns</h4>
            <ul className="space-y-1 text-slate-300 text-sm">
              <li>• Tech sector concentration</li>
              <li>• Elevated portfolio beta</li>
              <li>• Limited diversification</li>
              <li>• Growth factor over-exposure</li>
            </ul>
          </div>
          <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4">
            <h4 className="text-slate-300 font-medium mb-2">Opportunities</h4>
            <ul className="space-y-1 text-slate-300 text-sm">
              <li>• Strategic rebalancing</li>
              <li>• International diversification</li>
              <li>• Factor balance improvement</li>
              <li>• Defensive positioning</li>
            </ul>
          </div>
        </div>

        <div className="bg-purple-900/20 border border-purple-800/30 rounded-lg p-4">
          <h4 className="text-purple-400 font-medium mb-3">Strategic Recommendations</h4>
          
          <div className="space-y-3 text-slate-300 text-sm">
            <div>
              <div className="font-medium text-slate-200 mb-1">Phase 1: Risk Reduction (Immediate)</div>
              <ul className="space-y-1">
                <li>• <strong>Trim Winners:</strong> Reduce NVDA from 18% to 12%, take profits</li>
                <li>• <strong>Tech Rebalancing:</strong> Target 35% tech allocation (from current 45%)</li>
                <li>• <strong>Raise Cash:</strong> Build 12% cash position for future opportunities</li>
              </ul>
            </div>

            <div>
              <div className="font-medium text-slate-200 mb-1">Phase 2: Diversification (30-60 days)</div>
              <ul className="space-y-1">
                <li>• <strong>Add Healthcare:</strong> Increase to 25% (from 20%) - defensive positioning</li>
                <li>• <strong>International Exposure:</strong> Add 15% allocation to non-U.S. equities</li>
                <li>• <strong>Value Injection:</strong> Add 10-15% to value-oriented positions</li>
              </ul>
            </div>

            <div>
              <div className="font-medium text-slate-200 mb-1">Phase 3: Optimization (60-90 days)</div>
              <ul className="space-y-1">
                <li>• <strong>Sector Balance:</strong> Target equal-weight across 6-8 sectors</li>
                <li>• <strong>Factor Neutrality:</strong> Balance growth tilt with value/quality factors</li>
                <li>• <strong>Volatility Management:</strong> Target portfolio beta of 1.0-1.1</li>
              </ul>
            </div>
          </div>
        </div>

        <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4">
          <h4 className="text-slate-100 font-medium mb-2">Target Portfolio Allocation</h4>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between items-center">
              <span className="text-slate-400">Technology</span>
              <span className="text-slate-300">45% → <span className="text-emerald-400 font-medium">35%</span></span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-slate-400">Healthcare</span>
              <span className="text-slate-300">20% → <span className="text-emerald-400 font-medium">25%</span></span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-slate-400">Financials</span>
              <span className="text-slate-300">15% → <span className="text-slate-400 font-medium">15%</span></span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-slate-400">International</span>
              <span className="text-slate-300">0% → <span className="text-emerald-400 font-medium">15%</span></span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-slate-400">Consumer/Other</span>
              <span className="text-slate-300">20% → <span className="text-slate-400 font-medium">10%</span></span>
            </div>
          </div>
        </div>

        <div className="bg-blue-900/20 border border-blue-800/30 rounded-lg p-4">
          <h4 className="text-blue-400 font-medium mb-2">Expected Outcomes</h4>
          <div className="grid grid-cols-2 gap-3 text-sm text-slate-300">
            <div>
              <strong>Risk Profile:</strong> Beta reduced from 1.35 to ~1.05
            </div>
            <div>
              <strong>Max Drawdown:</strong> Improved from -18% to ~-13% (estimated)
            </div>
            <div>
              <strong>Sharpe Ratio:</strong> Expected improvement from 1.18 to 1.35+
            </div>
            <div>
              <strong>Diversification:</strong> Correlation to S&P 500 reduced to 0.75
            </div>
          </div>
        </div>

        <div className="text-center pt-2">
          <p className="text-slate-500 text-xs">
            Committee consensus reached • Portfolio evaluation complete • Rebalancing plan ready for execution
          </p>
        </div>
      </div>
    ),
  },
];
