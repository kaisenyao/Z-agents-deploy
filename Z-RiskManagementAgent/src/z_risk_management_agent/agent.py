from z_framework.agent import build_agent
from z_framework.config import RiskManagementAgentConfig
from z_risk_management_agent.tools import *
from z_risk_management_agent.prompts import RMA_PROMPT


rma_config = RiskManagementAgentConfig(
    name="RiskManagementAgent",
    description="Agent responsible for managing and mitigating risks in trading strategies.",
    system_prompt=RMA_PROMPT,
    tools=[calculate_correlation_matrix, calculate_var_cvar, 
           get_historical_market_data, calculate_beta, calculate_comprehensive_risk_metrics,
           calculate_liquidity_risk, perform_monte_carlo_simulation, calculate_rsi,
           get_fundamental_valuation_metrics
    ],
    llm="gemini/gemini-2.0-flash",
    temperature=0.7)

risk_management_agent = build_agent(rma_config)
