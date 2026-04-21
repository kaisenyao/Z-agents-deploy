import os
from z_framework.agent import build_deep_agent_with_committee_subagent, build_set_workflow_graph, build_supervisor_graph, build_agent
from z_framework.config import SupervisorAgentConfig
from z_framework.prompts import SUPERVISOR_PROMPT, DC_PROMPT, SWARM_MEMBER_PROMPT, COMM_PROMPT, SUPERVISOR_SET_WORKFLOW_PROMPT, SUPERVISOR_REPORT_PROMPT
from z_framework.test_prompts import WORKFLOW_RESEARCH_PROMPT, WORKFLOW_QUANT_PROMPT, WORKFLOW_RISK_PROMPT
from dotenv import load_dotenv
from langgraph_swarm import create_handoff_tool
from z_framework.agent import google_search

load_dotenv()

# Import member agent executors (graphs)
# These imports are actually used and called by langgraph.json, do not delete
from z_quant_agent.agent import  q_config
from z_research_agent.agent import r_config
from z_risk_management_agent.agent import rma_config


# architecture_type = "supervisor_framework"  # Options: "supervisor_only", "supervisor_framework", "supervisor_swarm", "set_workflow", "forced_debate"
architecture_type = "set_workflow"
use_doc = True
use_open_router = True # Set to True to use OpenRouter for model routing, False to specify models directly
model_set = os.getenv("MODEL_SET", "gemini")  # Options: "gemini", "openai", "anthropic"

# Define supervisor configuration
supervisor_config = SupervisorAgentConfig(
    name="SupervisorAgent",
    description="Orchestrates Quant, Research, and Risk Management agents to fulfill high-level tasks.",
    system_prompt=SUPERVISOR_PROMPT,
    # llm = "gemini/gemini-3-flash-preview",
    llm=os.getenv("SUPERVISOR_LLM", "google/gemini-3-flash-preview"),
    # llm="openai/gpt-5.2-chat",
    # llm = "anthropic/claude-opus-4.6",
    temperature=0.1,
    tools=[],
)

# Define supervisor configuration
report_supervisor_config = SupervisorAgentConfig(
    name="SupervisorAgent",
    description="Orchestrates Quant, Research, and Risk Management agents to fulfill high-level tasks.",
    system_prompt=SUPERVISOR_REPORT_PROMPT,
    # llm = "gemini/gemini-3-flash-preview",
    llm=os.getenv("SUPERVISOR_LLM", "google/gemini-3-flash-preview"),
    # llm="openai/gpt-5.2-chat",
    # llm = "anthropic/claude-opus-4.6",
    temperature=0.1,
    tools=[],
)

llm_only_config = supervisor_config.model_copy(deep=True)
llm_only_config.tools = []
llm_only_config.system_prompt = """You are a financial analyst agent.
                                Answer the question to the best of your ability.
                                If you don't know the answer, say you don't know.

                                Think step by step.
                                """


llm_with_tools_config = supervisor_config
llm_with_tools_config.tools = (
    q_config.tools + rma_config.tools + r_config.tools[1:] + [google_search]
)  # Give it access to all tools from member agents
llm_with_tools_config.system_prompt = """
                                        You are a financial analyst agent. 
                                        Answer the question to the best of your ability using the tools at your disposal. 
                                        If you don't know the answer, say you don't know. 

                                        Think step by step.
                                        """


if model_set == "gemini":
    if use_open_router:
        supervisor_config.llm = "google/gemini-3-flash-preview"
        q_config.llm = "google/gemini-3-flash-preview"
        r_config.llm = "google/gemini-3-flash-preview"
        rma_config.llm = "google/gemini-3-flash-preview"
    else:
        supervisor_config.llm = "gemini/gemini-3-flash-preview"
        q_config.llm = "gemini/gemini-3-flash-preview"
        r_config.llm = "gemini/gemini-3-flash-preview"
        rma_config.llm = "gemini/gemini-3-flash-preview"
elif model_set == "openai":
    if use_open_router:
        supervisor_config.llm = "openai/gpt-5.2"
        q_config.llm = "openai/gpt-5.2"
        r_config.llm = "openai/gpt-5.2"
        rma_config.llm = "openai/gpt-5.2"
    else:
        supervisor_config.llm = "openai/gpt-5.2-chat"
        q_config.llm = "openai/gpt-5.2-chat"
        r_config.llm = "openai/gpt-5.2-chat"
        rma_config.llm = "openai/gpt-5.2-chat"
elif model_set == "anthropic":
    if use_open_router:
        supervisor_config.llm = "anthropic/claude-sonnet-4.6"
        q_config.llm = "anthropic/claude-sonnet-4.6"
        r_config.llm = "anthropic/claude-sonnet-4.6"
        rma_config.llm = "anthropic/claude-sonnet-4.6"
    else:
        supervisor_config.llm = "anthropic/claude-sonnet-4.6"
        q_config.llm = "anthropic/claude-sonnet-4.6"
        r_config.llm = "anthropic/claude-sonnet-4.6"
        rma_config.llm = "anthropic/claude-sonnet-4.6"

# Allow individual overrides via environment variables if present
supervisor_config.llm = os.getenv("SUPERVISOR_LLM", supervisor_config.llm)
q_config.llm = os.getenv("QUANT_LLM", q_config.llm)
r_config.llm = os.getenv("RESEARCH_LLM", r_config.llm)
rma_config.llm = os.getenv("RISK_LLM", rma_config.llm)

# Ensure derived configs also get the override if they haven't been copied yet, 
# or re-apply if they were copied before this block (moving the copy logic after this block is safer, but re-assigning here works too)
llm_only_config.llm = supervisor_config.llm
llm_with_tools_config.llm = supervisor_config.llm
report_supervisor_config.llm = supervisor_config.llm

# q_config.llm = "google/gemini-3-flash-preview"
# r_config.llm = "google/gemini-3-flash-preview"
# rma_config.llm = "google/gemini-3-flash-preview"

# q_config.llm = "openai/gpt-5.2-chat"
# r_config.llm = "openai/gpt-5.2-chat"
# rma_config.llm = "openai/gpt-5.2-chat"

# q_config.llm = "anthropic/claude-opus-4.6"
# r_config.llm = "anthropic/claude-opus-4.6"
# rma_config.llm = "anthropic/claude-opus-4.6"

use_swarm = architecture_type == "supervisor_swarm"

if use_swarm:
    # Add handoff tools to member agents
    supervisor_config.tools += [create_handoff_tool(agent_name = "QuantAgent", description="Handoff to Quant Agent"), 
                                create_handoff_tool(agent_name = "ResearchAgent", description="Handoff to Research Agent"), 
                                create_handoff_tool(agent_name = "RiskManagementAgent", description="Handoff to Risk Management Agent")]
    q_config.tools += [create_handoff_tool(agent_name = "SupervisorAgent", description="Handoff to Supervisor Agent"), 
                       create_handoff_tool(agent_name = "ResearchAgent", description="Handoff to Research Agent"), 
                       create_handoff_tool(agent_name = "RiskManagementAgent", description="Handoff to Risk Management Agent")]
    r_config.tools += [create_handoff_tool(agent_name = "SupervisorAgent", description="Handoff to Supervisor Agent"), 
                       create_handoff_tool(agent_name = "QuantAgent", description="Handoff to Quant Agent"), 
                       create_handoff_tool(agent_name = "RiskManagementAgent", description="Handoff to Risk Management Agent")]
    rma_config.tools += [create_handoff_tool(agent_name = "SupervisorAgent", description="Handoff to Supervisor Agent"), 
                         create_handoff_tool(agent_name = "QuantAgent", description="Handoff to Quant Agent"), 
                         create_handoff_tool(agent_name = "ResearchAgent", description="Handoff to Research Agent")]

# Map member agent names to their executors

if use_swarm:
    q_config.system_prompt += SWARM_MEMBER_PROMPT
    r_config.system_prompt += SWARM_MEMBER_PROMPT
    rma_config.system_prompt += SWARM_MEMBER_PROMPT
elif architecture_type != "supervisor_framework":
    q_config.system_prompt = WORKFLOW_QUANT_PROMPT 
    r_config.system_prompt = WORKFLOW_RESEARCH_PROMPT 
    rma_config.system_prompt = WORKFLOW_RISK_PROMPT 


# Enable google_search only on ResearchAgent (it's the agent that needs web lookups)
r_config.enable_google_search = True

members = {
     "QuantAgent": build_agent(q_config, use_open_router),
     "ResearchAgent": build_agent(r_config, use_open_router),
     "RiskManagementAgent": build_agent(rma_config, use_open_router),
}

research_agent = members["ResearchAgent"]
quant_agent = members["QuantAgent"]
risk_management_agent = members["RiskManagementAgent"]

# Expose the supervisor graph for LangGraph tooling
# allow_agent_communication = os.getenv("ALLOW_AGENT_COMMUNICATION", "True").lower() == "true"

# graph = build_supervisor_graph(supervisor_config, members, allow_agent_communication=allow_agent_communication).compile().with_config({"recursion_limit": 100})
if architecture_type in ["supervisor_only", "supervisor_framework", "supervisor_swarm"]:
    graph = (
        build_supervisor_graph(supervisor_config, members, allow_agent_communication=use_swarm, use_open_router=use_open_router)
        .with_config({"recursion_limit": 100})
    )
    report_graph = build_supervisor_graph(
        report_supervisor_config,
        members,
        allow_agent_communication=use_swarm,
        use_open_router=use_open_router,
    ).with_config({"recursion_limit": 100})
else:
    # graph = build_deep_agent_with_committee_subagent(deep_model_config = supervisor_config,
    #                                              deep_system_prompt = SUPERVISOR_SET_WORKFLOW_PROMPT,
    #                                              base_tools =supervisor_config.tools,
    #                                             members = members,
    #                                             attach_individuals_as_subagents = True)

    committee_graph_no_doc = build_set_workflow_graph(
        supervisor_config, members, use_open_router=use_open_router
    ).with_config({"recursion_limit": 100})

    report_graph_no_doc = build_set_workflow_graph(
        report_supervisor_config, members, use_open_router=use_open_router, report_generation=True
    ).with_config({"recursion_limit": 100})

    supervisor_graph_no_doc = build_supervisor_graph(
        supervisor_config,
        members,
        allow_agent_communication=use_swarm,
        use_open_router=use_open_router,
    ).with_config({"recursion_limit": 100})
    
    q_config.system_prompt += DC_PROMPT
    r_config.system_prompt += DC_PROMPT
    rma_config.system_prompt += DC_PROMPT
    
    members = {
     "QuantAgent": build_agent(q_config, use_open_router),
     "ResearchAgent": build_agent(r_config, use_open_router),
     "RiskManagementAgent": build_agent(rma_config, use_open_router),
    }

    research_agent = members["ResearchAgent"]
    quant_agent = members["QuantAgent"]
    risk_management_agent = members["RiskManagementAgent"]

    committee_graph = build_set_workflow_graph(supervisor_config, 
                                               members, 
                                               use_open_router = use_open_router).with_config({"recursion_limit": 100})

    report_graph = build_set_workflow_graph(
        report_supervisor_config, 
        members, 
        use_open_router=use_open_router, 
        report_generation=True
    ).with_config({"recursion_limit": 100})

    supervisor_graph = build_supervisor_graph(
        supervisor_config,
        members,
        allow_agent_communication=use_swarm,
        use_open_router=use_open_router,
    ).with_config({"recursion_limit": 100})

    llm_only_graph = build_agent(llm_only_config, 
                                 use_open_router).with_config({"recursion_limit": 100})

    llm_with_tools_graph = build_agent(llm_with_tools_config, 
                                       use_open_router).with_config({"recursion_limit": 100})
