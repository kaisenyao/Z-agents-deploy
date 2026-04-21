from z_framework.agent import build_agent
from z_framework.config import ResearchAgentConfig
from z_research_agent.tools import *
from z_research_agent.prompts import get_research_prompt

r_config = ResearchAgentConfig(
    name="ResearchAgent",
    description="Agent responsible for research: gathering, analyzing, and synthesizing information.",
    system_prompt=get_research_prompt(),  # Use function to get fresh prompt with current date
    tools=[web_search, sec_document_retriever, polygon_stock_data, finnhub_data, fetch_comprehensive_finnhub_data, defeatbeta_earning_call],
    llm="gemini/gemini-2.5-flash",  # Changed from OpenAI to Gemini
    temperature=0.3,
)

research_agent = build_agent(r_config)
