from pydantic import BaseModel, Field
from typing import List, Optional

class AgentConfig(BaseModel):
    """Base configuration for an agent."""
    name: str
    description: str
    system_prompt: str = ""
    llm: str = "openai/gpt-4"
    temperature: float = 0.7
    max_tokens: int = 4096
    tools: List = []
    enable_code_execution: bool = False  # Enable code_execution tool (uses Gemini)
    enable_google_search: bool = False   # Enable google_search tool (uses Gemini)


class SupervisorAgentConfig(AgentConfig):
    """Configuration for the supervisor agent."""
    pass


class QuantAgentConfig(AgentConfig):
    """Configuration for the quant agent."""
    pass


class ResearchAgentConfig(AgentConfig):
    """Configuration for the research agent."""
    pass


class RiskManagementAgentConfig(AgentConfig):
    """Configuration for the risk management agent."""
    pass


class Config(BaseModel):
    """Main configuration class for the Z-Framework."""
    supervisor_agent: SupervisorAgentConfig
    quant_agent: QuantAgentConfig
    research_agent: ResearchAgentConfig
    risk_management_agent: RiskManagementAgentConfig
    max_iterations: int = 10
    verbose: bool = True
    allow_agent_communication: bool = True  # Toggle to allow/block agent-to-agent communication
