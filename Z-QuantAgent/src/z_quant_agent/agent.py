from z_framework.agent import build_agent
from z_framework.config import QuantAgentConfig
from z_quant_agent.tools import *
from z_quant_agent.prompts import QUANT_PROMPT

q_config = QuantAgentConfig(
    name="QuantAgent",
    description="Agent responsible for quantitative analysis and trading strategy development.",
    system_prompt=QUANT_PROMPT,
    tools=[get_ohlcv_daily,correlation_analysis, compute_indicators_from_ohlcv,
           build_professional_chart_suite,
           plot_ta_report_charts,
           run_backtest,
           support_resistance_levels,return_stats,similarity_search_by_technical_profile,
           beta_vs_market],
    llm="gemini/gemini-2.5-flash",
    temperature=0.7,
    enable_code_execution=False,
)

quant_agent = build_agent(q_config)
