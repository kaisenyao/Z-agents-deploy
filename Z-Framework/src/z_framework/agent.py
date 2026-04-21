from __future__ import annotations

import concurrent.futures
import os
from typing import (
    Annotated,
    Any,
    Callable,
    Dict,
    List,
    NotRequired,
    Optional,
    TypedDict,
)

from deepagents import create_deep_agent  # deep agent architecture
from deepagents import CompiledSubAgent
from langchain.agents.middleware import ClearToolUsesEdit, ContextEditingMiddleware
from langchain.messages import HumanMessage, SystemMessage, ToolMessage
from langchain.tools import tool
from langchain_core.messages import BaseMessage
from langchain_core.tools import tool
from langgraph.graph import END, START, MessagesState, StateGraph
from langgraph.graph.message import add_messages
from langgraph.prebuilt.tool_node import InjectedState
from langgraph.types import Command


class WorkflowState(TypedDict):
    messages: Annotated[list[BaseMessage], add_messages]
    loop_count: NotRequired[int]
    max_loops: NotRequired[int]  # Dynamic loop count, set by run_committee tool


from typing import Callable, List

# from langgraph.prebuilt import create_react_agent
from langchain.agents import create_agent as create_react_agent
from langchain.agents.middleware import (
    AgentMiddleware,
    ModelRequest,
    ModelResponse,
    ToolCallLimitMiddleware,
    wrap_model_call,
)
from langchain_core.tools import tool
from langchain_deepseek import ChatDeepSeek
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_openai import ChatOpenAI
from langgraph_supervisor import create_supervisor
from langgraph_swarm import create_handoff_tool, create_swarm
from langchain.agents import AgentState

from .config import AgentConfig
from .prompts import (
    SUPERVISOR_PROMPT,
    SUPERVISOR_SET_WORKFLOW_PROMPT,
    SUPERVISOR_SWARM_PROMPT,
)
from .report_schema import report_schema


# -----------------------------
# 1) Committee subgraph (NO supervisor):
#    (Research -> Quant -> Risk) xN, then END
# -----------------------------
def build_committee_subgraph(
    members: Dict[str, Any],
    *,
    loops: int = 2,
    name_prefix: str = "Committee",
):
    """
    Committee subgraph: Research -> Quant -> Risk, repeated `loops` times.
    Assumes each member is a runnable node that takes WorkflowState and returns state updates.
    """

    if (
        "ResearchAgent" not in members
        or "QuantAgent" not in members
        or "RiskManagementAgent" not in members
    ):
        raise ValueError(
            "Committee requires members: ResearchAgent, QuantAgent, RiskManagementAgent"
        )

    def normalize_to_messages(res) -> list[BaseMessage]:
        # Common patterns from agent executors
        if isinstance(res, dict):
            if "messages" in res and isinstance(res["messages"], list):
                return res["messages"]
            if "output" in res:
                return [AIMessage(content=str(res["output"]))]
        if isinstance(res, list):
            return res
        if isinstance(res, BaseMessage):
            return [res]
        return [AIMessage(content=str(res))]

    def wrap_agent_as_state_node(agent, name="Agent"):
        def node(state):
            before = len(state["messages"])
            res = agent.invoke({"messages": state["messages"]})
            msgs = normalize_to_messages(res)

            # IMPORTANT: only return *new* messages, not the whole history
            # If the agent returned the whole conversation, slice it
            if len(msgs) >= before and all(
                getattr(msgs[i], "id", None) == getattr(state["messages"][i], "id", None)
                for i in range(min(before, len(msgs)))
            ):
                msgs = msgs[before:]

            print(
                f"[{name}] before={before} returned_msgs={len(normalize_to_messages(res))} appended={len(msgs)}"
            )
            return {"messages": msgs}

        return node

    g = StateGraph(WorkflowState)

    g.add_node(f"{name_prefix}_Research", members["ResearchAgent"])
    g.add_node(f"{name_prefix}_Quant", members["QuantAgent"])
    g.add_node(f"{name_prefix}_Risk", members["RiskManagementAgent"])

    def handoff_to_quant(state: WorkflowState) -> dict:
        current_loop = state.get("loop_count", 0) + 1
        max_l = state.get("max_loops", loops)
        if current_loop == 1:
            return {
                "messages": [
                    HumanMessage(
                        content=f"System: The ResearchAgent has finished. QuantAgent, please proceed with your analysis or response based on the above. This is loop {current_loop}/{max_l}."
                    )
                ]
            }
        return {
            "messages": [
                HumanMessage(
                    content=f"System: The ResearchAgent has finished. QuantAgent, please review the previous findings and respond. This is loop {current_loop}/{max_l}."
                )
            ]
        }

    def handoff_to_risk(state: WorkflowState) -> dict:
        current_loop = state.get("loop_count", 0) + 1
        max_l = state.get("max_loops", loops)
        if current_loop == 1:
            return {
                "messages": [
                    HumanMessage(
                        content=f"System: The QuantAgent has finished. RiskManagementAgent, please proceed with your risk assessment based on the above findings. This is loop {current_loop}/{max_l}."
                    )
                ]
            }
        return {
            "messages": [
                HumanMessage(
                    content=f"System: The QuantAgent has finished. RiskManagementAgent, please review the above findings and respond. This is loop {current_loop}/{max_l}."
                )
            ]
        }

    def handoff_to_research(state: WorkflowState) -> dict:
        current_loop = state.get("loop_count", 0) + 1
        max_l = state.get("max_loops", loops)

        if current_loop == 1:
            # First pass, give full analysis instructions
            return {
                "messages": [
                    HumanMessage(
                        content=f"System: A new cycle is starting. ResearchAgent, please review the previous findings and provide a detailed analysis. This is loop {current_loop}/{max_l}."
                    )
                ]
            }

        return {
            "messages": [
                HumanMessage(
                    content=f"System: A new cycle is starting. ResearchAgent, please review the previous findings and respond. This is loop {current_loop}/{max_l}."
                )
            ]
        }

    g.add_node(f"{name_prefix}_Handoff_Quant", handoff_to_quant)
    g.add_node(f"{name_prefix}_Handoff_Risk", handoff_to_risk)
    g.add_node(f"{name_prefix}_Handoff_Research", handoff_to_research)

    def loop_manager(state: WorkflowState) -> dict:
        return {"loop_count": int(state.get("loop_count", 0)) + 1}

    def reset_loops(_: WorkflowState) -> dict:
        return {"loop_count": 0}

    g.add_node(f"{name_prefix}_Reset", reset_loops)
    g.add_node(f"{name_prefix}_LoopManager", loop_manager)

    # Start/reset -> Research
    g.add_edge(START, f"{name_prefix}_Reset")
    g.add_edge(f"{name_prefix}_Reset", f"{name_prefix}_Research")

    # Research -> Handoff_Quant -> Quant -> Handoff_Risk -> Risk -> LoopManager
    g.add_edge(f"{name_prefix}_Research", f"{name_prefix}_Handoff_Quant")
    g.add_edge(f"{name_prefix}_Handoff_Quant", f"{name_prefix}_Quant")

    g.add_edge(f"{name_prefix}_Quant", f"{name_prefix}_Handoff_Risk")
    g.add_edge(f"{name_prefix}_Handoff_Risk", f"{name_prefix}_Risk")

    g.add_edge(f"{name_prefix}_Risk", f"{name_prefix}_LoopManager")

    def route_loop(state: WorkflowState) -> str:
        # after Risk, incremented by LoopManager
        # Use dynamic max_loops from state if set, otherwise fall back to compile-time loops
        max_l = int(state.get("max_loops", loops))
        if int(state.get("loop_count", 0)) < max_l:
            return f"{name_prefix}_Handoff_Research"
        return "end"

    g.add_conditional_edges(
        f"{name_prefix}_LoopManager",
        route_loop,
        {
            f"{name_prefix}_Handoff_Research": f"{name_prefix}_Handoff_Research",
            "end": END,
        },
    )

    g.add_edge(f"{name_prefix}_Handoff_Research", f"{name_prefix}_Research")

    return g.compile(name="CommitteeSubgraph")


# -----------------------------
# 2) Expose committee + individuals as tools for the deep agent
#    Uses InjectedState("messages") so tools operate on current convo.
# -----------------------------
def build_committee_and_member_tools(
    *,
    committee_graph,
    members: Dict[str, Any],
):
    @tool(
        "run_committee",
        description="Run the committee workflow: (Research -> Quant -> Risk) x2 on the current conversation.",
    )
    def run_committee(
        _: str = "",
        messages: Annotated[list[BaseMessage], InjectedState("messages")] = None,
    ) -> str:
        out = committee_graph.invoke({"messages": messages})
        return out["messages"]

    tools: list[Callable] = [run_committee]

    if "ResearchAgent" in members:
        research_graph = members["ResearchAgent"]

        @tool(
            "run_research_agent",
            description="Run the ResearchAgent alone on the current conversation.",
        )
        def run_research_agent(
            _: str = "",
            messages: Annotated[list[BaseMessage], InjectedState("messages")] = None,
        ) -> str:
            out = research_graph.invoke({"messages": messages})
            return out["messages"]

        tools.append(run_research_agent)

    if "QuantAgent" in members:
        quant_graph = members["QuantAgent"]

        @tool(
            "run_quant_agent", description="Run the QuantAgent alone on the current conversation."
        )
        def run_quant_agent(
            _: str = "",
            messages: Annotated[list[BaseMessage], InjectedState("messages")] = None,
        ) -> str:
            out = quant_graph.invoke({"messages": messages})
            return out["messages"]

        tools.append(run_quant_agent)

    if "RiskManagementAgent" in members:
        risk_graph = members["RiskManagementAgent"]

        @tool(
            "run_risk_agent",
            description="Run the RiskManagementAgent alone on the current conversation.",
        )
        def run_risk_agent(
            _: str = "",
            messages: Annotated[list[BaseMessage], InjectedState("messages")] = None,
        ) -> str:
            out = risk_graph.invoke({"messages": messages})
            return out["messages"]

        tools.append(run_risk_agent)

    return tools


MAX_TOOL_CHARS = 300  # adjust


def trim_tool_outputs(messages, max_chars=MAX_TOOL_CHARS):
    trimmed = []
    for m in messages:
        # Tool result messages are what blow up context
        if getattr(m, "type", None) == "tool":
            name = getattr(m, "name", None) or getattr(m, "tool", None) or "tool"
            content = getattr(m, "content", "") or ""

            # keep *that* a tool returned something, but not the full payload
            short = content
            if len(short) > max_chars:
                short = short[:max_chars] + "…"

            # you can also replace entirely with a fixed marker:
            # short = f"[{name} output omitted; {len(content)} chars]"

            # Create a lightweight ToolMessage-like object by copying & editing
            # (LangChain messages are usually pydantic models; `.copy(update=...)` works)
            try:
                m2 = m.copy(update={"content": short})
            except Exception:
                # fallback if copy isn't available
                m.content = short
                m2 = m

            trimmed.append(m2)
            continue

        # Keep everything else, including AI tool-call messages
        trimmed.append(m)

    return trimmed


class KeepToolCallsTrimReturns(AgentMiddleware):
    def wrap_model_call(self, request, handler):
        request = request.override(messages=trim_tool_outputs(request.messages))
        return handler(request)

    async def awrap_model_call(self, request, handler):
        request = request.override(messages=trim_tool_outputs(request.messages))
        return await handler(request)


gemini_search_llm = ChatGoogleGenerativeAI(model="gemini-2.5-flash").bind_tools(
    [{"google_search": {}}]
)

from langchain_core.messages import AIMessage


@tool
def google_search(query: str) -> str:
    """Search the web using Gemini's built-in google_search grounding."""
    resp = gemini_search_llm.invoke(query)
    # return "Not implemented"
    # You can also inspect resp.content_blocks if you want citations/grounding info
    return resp.content


gemini_code_llm = ChatGoogleGenerativeAI(model="gemini-2.5-flash").bind_tools(
    [{"code_execution": {}}]
)


@tool
def code_execution(code: str) -> str:
    """Execute code using Gemini's built-in code_execution tool."""
    resp = gemini_code_llm.invoke(f"Run this code and return the output:\n\n{code}")
    return resp.content

    # return "Not Implemented"


def build_agent(agent_config: AgentConfig, use_open_router: bool = True):
    """
    Builds a langgraph agent based on the provided configuration.
    """
    llm_provider, model_name = agent_config.llm.split("/")

    if llm_provider == "openai":
        llm = ChatOpenAI(
            model=model_name,
            temperature=agent_config.temperature,
            max_tokens=agent_config.max_tokens,
        )
    elif llm_provider == "gemini":
        llm = ChatGoogleGenerativeAI(model=model_name, 
                                     temperature=agent_config.temperature)
    elif llm_provider == "deepseek":
        llm = ChatDeepSeek(
            model=model_name,
            # temperature=agent_config.temperature,
            max_tokens=agent_config.max_tokens,
            temperature=0.7,
            frequency_penalty=0.8,
            presence_penalty=0.2,
        )
    # else:
    #     raise ValueError(f"Unsupported LLM provider: {llm_provider}")

    if use_open_router:
        # For OpenRouter, we want to use the base model without tool calls in the system prompt, and handle tools separately.
        # This is because OpenRouter can route to tools without needing them in the system prompt, and including them can cause issues.
        # model_name = model_name.split("-with-tools")[0]  # e.g. "gemini-3-flash-preview-with-tools" -> "gemini-3-flash-preview"
        llm = ChatOpenAI(
            model=agent_config.llm,
            base_url="https://openrouter.ai/api/v1",
            api_key=os.environ["OPENROUTER_API_KEY"],
            temperature=agent_config.temperature,
            max_tokens=getattr(agent_config, "max_tokens", 4096),
        )

    system_prompt = agent_config.system_prompt or "You are a helpful assistant."

    base_tools = agent_config.tools or []
    # Only add google_search / code_execution if explicitly enabled in config
    optional_tools: list = []
    if getattr(agent_config, "enable_google_search", False):
        optional_tools.append(google_search)
    if getattr(agent_config, "enable_code_execution", False):
        optional_tools.append(code_execution)
    tools = base_tools + optional_tools

    agent_executor = create_react_agent(
        llm,
        tools=tools,
        name=agent_config.name,
        system_prompt=system_prompt,
        middleware=[
            ContextEditingMiddleware(
                edits=[
                    ClearToolUsesEdit(
                        trigger=2000,  # token threshold
                        keep=2,  # keep most recent tool results
                        clear_tool_inputs=True,  # also wipe tool call args if you want
                        placeholder="[cleared]",
                    )
                ]
            ),
            ToolCallLimitMiddleware(
                run_limit=8,  # enough for multi-step tool use while capping runaway loops
            ),
        ],
    )
    return agent_executor


def build_supervisor_graph(
    supervisor_config: AgentConfig,
    members: dict,
    allow_agent_communication: bool = False,
    use_open_router: bool = False,
):
    """
    Build a swarm graph that orchestrates member agents using langgraph-swarm.
    - supervisor_config: configuration for the supervisor LLM
    - members: dict mapping member names to their agent executors
    - allow_agent_communication: if False, disables agent-to-agent communication (swarm contains only supervisor)
    """
    llm_provider, model_name = supervisor_config.llm.split("/")

    if llm_provider == "openai":
        llm = ChatOpenAI(
            model=model_name,
            temperature=supervisor_config.temperature,
            max_tokens=getattr(supervisor_config, "max_tokens", 4096),
        )
    elif llm_provider == "gemini":
        llm = ChatGoogleGenerativeAI(model=model_name, temperature=supervisor_config.temperature)
    elif llm_provider == "deepseek":
        llm = ChatDeepSeek(
            model=model_name,
            temperature=supervisor_config.temperature,
            max_tokens=getattr(supervisor_config, "max_tokens", 4096),
        )
    elif use_open_router:
        llm = ChatOpenAI(
            model=supervisor_config.llm,
            base_url="https://openrouter.ai/api/v1",
            api_key=os.environ["OPENROUTER_API_KEY"],
            temperature=0.7,
            frequency_penalty=0.8,
            presence_penalty=0.2,
        )
    else:
        raise ValueError(f"Unsupported LLM provider: {llm_provider}")

    system_prompt = supervisor_config.system_prompt or SUPERVISOR_PROMPT

    agent_as_tools = []
    # Create Agents as tools:
    if "ResearchAgent" in members:

        @tool
        def call_research_agent(request: str) -> str:
            """
            Calls research agent to perform research tasks
            such as generating a thesis, identifying catalysts,
            analyzing fundamentals, and gathering evidence.
            The request parameter should contain the specific research task or question that needs to be addressed.
            The function invokes the ResearchAgent with the provided request and returns the result as a string.
            """
            result = members["ResearchAgent"].invoke(
                {"messages": [{"role": "user", "content": request}]}
            )
            return result

        agent_as_tools.append(call_research_agent)
    if "QuantAgent" in members:

        @tool
        def call_quant_agent(request: str) -> str:
            """
            Calls quant agent to perform quantitative analysis tasks such as conducting data checks, building factor/alpha models, running backtests, and performing statistical analysis
            The request parameter should contain the specific quantitative analysis task or question that needs to be addressed.
            The function invokes the QuantAgent with the provided request and returns the result as a string.
            """
            result = members["QuantAgent"].invoke(
                {"messages": [{"role": "user", "content": request}]}
            )
            return result

        agent_as_tools.append(call_quant_agent)
    if "RiskManagementAgent" in members:

        @tool
        def call_risk_agent(request: str) -> str:
            """
            Calls risk management agent to perform risk analysis tasks such as evaluating drawdowns, running scenario analyses, determining position sizing, assessing constraints, and suggesting hedging strategies.
            The request parameter should contain the specific risk management task or question that needs to be addressed.
            The function invokes the RiskManagementAgent with the provided request and returns the result as a string.
            """
            result = members["RiskManagementAgent"].invoke(
                {"messages": [{"role": "user", "content": request}]}
            )
            return result

        agent_as_tools.append(call_risk_agent)

    if not allow_agent_communication:
        # system_prompt += "\n\nNOTICE: Communication with other agents is currently disabled by configuration. You cannot call or route tasks to other agents."
        # agent_graph = create_react_agent(
        #     model=llm,
        #     tools=agent_as_tools,
        #     system_prompt=system_prompt
        # )
        agent_graph = create_supervisor(
            agents=members.values(),
            model=llm,
            tools=supervisor_config.tools,
            name=supervisor_config.name,
            prompt=system_prompt,
            output_mode="full_history",  # supervisor gets full convo history including tool calls/results for better context
            parallel_tool_calls=True,  # allow supervisor to call multiple agents in parallel if needed
        ).compile()

    else:
        # Use Swarm Prompt for dynamic communication
        system_prompt = SUPERVISOR_SWARM_PROMPT

        # Create Supervisor Agent
        supervisor_agent = create_react_agent(
            llm,
            tools=supervisor_config.tools,
            name=supervisor_config.name,
            system_prompt=system_prompt,
            middleware=[
                ContextEditingMiddleware(
                    edits=[
                        ClearToolUsesEdit(
                            trigger=2000,  # token threshold
                            keep=2,  # keep most recent tool results
                            clear_tool_inputs=True,  # also wipe tool call args if you want
                            placeholder="[cleared]",
                        )
                    ]
                )
            ],
        )

        agents = [supervisor_agent]
        if allow_agent_communication:
            # Add all member agents to the swarm
            agents.extend(members.values())
        agent_graph = create_swarm(agents, default_active_agent=supervisor_config.name)

    return agent_graph


def build_set_workflow_graph(
    supervisor_config: AgentConfig,
    members: dict,
    allow_single_calls: bool = True,
    use_open_router: bool = False,
    report_generation: bool = False,
):
    """
    Build a set workflow graph with a specific cyclic flow:
    Supervisor -> (Research -> Quant -> Risk) x2 -> Supervisor.
    """
    llm_provider, model_name = supervisor_config.llm.split("/")

    if use_open_router:
        llm = ChatOpenAI(
            model=supervisor_config.llm,
            base_url="https://openrouter.ai/api/v1",
            api_key=os.environ["OPENROUTER_API_KEY"],
            max_tokens=getattr(supervisor_config, "max_tokens", 4096),
            temperature=0.7,
            frequency_penalty=0.8,
            presence_penalty=0.2,
        )
    elif llm_provider == "openai":
        llm = ChatOpenAI(
            model=model_name,
            temperature=0.7,
            frequency_penalty=0.8,
            presence_penalty=0.2,
            max_tokens=getattr(supervisor_config, "max_tokens", 4096),
        )
    elif llm_provider == "gemini":
        llm = ChatGoogleGenerativeAI(
            model=model_name,
            # temperature=supervisor_config.temperature,
            temperature=0.7,
            frequency_penalty=0.8,
            presence_penalty=0.2,
        )
    elif llm_provider == "deepseek":
        llm = ChatDeepSeek(
            model=model_name,
            # temperature=supervisor_config.temperature,
            max_tokens=getattr(supervisor_config, "max_tokens", 4096),
            temperature=0.7,
            frequency_penalty=0.8,
            presence_penalty=0.2,
        )
    else:
        raise ValueError(f"Unsupported LLM provider: {llm_provider} (and use_open_router is False)")

    system_prompt = SUPERVISOR_SET_WORKFLOW_PROMPT

    # # Create Supervisor Agent with specific handoff capability to Research Agent
    # com_handoff = create_handoff_tool(agent_name="Committee", description="Hand off to Committee for further analysis.")
    # research_handoff = create_handoff_tool(agent_name="ResearchAgent", description="Hand off to Research Agent")
    # quant_handoff = create_handoff_tool(agent_name="QuantAgent", description="Hand off to Quant Agent")
    # risk_handoff = create_handoff_tool(agent_name="RiskManagementAgent", description="Hand off to Risk Management Agent")

    # # Ensure handoff tool is available
    tools = supervisor_config.tools or []
    # tools += [com_handoff, research_handoff, quant_handoff, risk_handoff]

    # agent_as_tools = build_committee_and_member_tools(
    #     committee_graph=build_committee_subgraph(members),
    #     members=members,
    # )
    committee_graph = build_committee_subgraph(members)

    def _extract_new_messages(result: Any, input_count: int) -> list[BaseMessage]:
        """Extract only new messages produced by an agent (not the echoed input)."""
        if isinstance(result, dict) and "messages" in result:
            all_msgs = result["messages"]
        elif isinstance(result, list):
            all_msgs = result
        else:
            return [AIMessage(content=str(result))]

        if not isinstance(all_msgs, list):
            return [AIMessage(content=str(all_msgs))]

        # If agent returned the full history (input + new), slice off the input portion
        if len(all_msgs) > input_count:
            # Verify the prefix matches the input (by id if available)
            return all_msgs[input_count:]
        return all_msgs

    def _extract_committee_text(all_messages: list[BaseMessage]) -> str:
        """Walk messages and extract text output from committee agents."""
        committee_agent_names = {"ResearchAgent", "QuantAgent", "RiskManagementAgent"}

        texts = []
        current_agent = None
        agent_had_text = set()

        for m in all_messages:
            c = getattr(m, "content", "")
            n = getattr(m, "name", "") or ""

            # Track which agent we're currently in
            if n in committee_agent_names:
                current_agent = n

            if not c:
                continue

            # Direct match on agent name — include regardless of tool_calls
            if n in committee_agent_names:
                texts.append(f"{n}: {c}")
                agent_had_text.add(n)
            # Fallback: AIMessage with unrecognized but non-empty name
            elif isinstance(m, AIMessage) and n not in ("", "SupervisorAgent"):
                texts.append(f"{n}: {c}")
                if current_agent:
                    agent_had_text.add(current_agent)
            # Fallback: unnamed AIMessage without tool_calls (final synthesis)
            elif isinstance(m, AIMessage) and not n and not getattr(m, "tool_calls", None):
                label = current_agent or "Agent"
                texts.append(f"{label}: {c}")
                if current_agent:
                    agent_had_text.add(current_agent)
            # Fallback: unnamed AIMessage WITH tool_calls but also has text content
            elif isinstance(m, AIMessage) and not n and getattr(m, "tool_calls", None) and c.strip():
                label = current_agent or "Agent"
                texts.append(f"{label}: {c}")
                if current_agent:
                    agent_had_text.add(current_agent)

        # If any agent called tools but produced NO text, include a fallback
        for agent_name in committee_agent_names:
            if agent_name not in agent_had_text:
                agent_had_tools = any(
                    isinstance(m, AIMessage) and getattr(m, "name", "") == agent_name and getattr(m, "tool_calls", None)
                    for m in all_messages
                )
                if agent_had_tools:
                    last_tool_result = None
                    for m in reversed(all_messages):
                        if isinstance(m, ToolMessage) and getattr(m, "content", ""):
                            last_tool_result = getattr(m, "content", "")[:500]
                            break
                    if last_tool_result:
                        texts.append(f"{agent_name} (tool output summary): {last_tool_result}")
                    else:
                        texts.append(f"{agent_name}: (ran tools but produced no text summary)")

        return "\n\n".join(texts) if texts else "(committee returned no text)"

    @tool(
        "run_committee",
        description=(
            "Run the investment committee workflow: (Research -> Quant -> Risk) for a specified number of deliberation loops. "
            "Loop 1 runs all agents IN PARALLEL for speed (~3x faster). Subsequent loops run sequentially for DoC deliberation. "
            "Use loops=1 for simple/focused questions, loops=2 for complex multi-domain analysis (default). "
            "The instructions parameter should describe the analysis task."
        ),
    )
    def run_committee(
        instructions: str = "",
        loops: int = 2,
        messages: Annotated[list[BaseMessage], InjectedState("messages")] = None,
    ) -> str:
        msgs = list(messages or [])

        if instructions.strip():
            msgs.append(HumanMessage(content=instructions))

        input_count = len(msgs)

        # ── LOOP 1: PARALLEL independent analysis ──────────────────────
        # On the first pass, no agent has seen the others' output, so all
        # three can analyse the query simultaneously.
        print("[Committee] Starting parallel first loop (Research ║ Quant ║ Risk)")

        agent_order = ["ResearchAgent", "QuantAgent", "RiskManagementAgent"]

        with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
            future_to_name = {
                executor.submit(
                    members[name].invoke,
                    {"messages": msgs},
                ): name
                for name in agent_order
            }
            parallel_results: Dict[str, Any] = {}
            for future in concurrent.futures.as_completed(future_to_name):
                agent_name = future_to_name[future]
                try:
                    parallel_results[agent_name] = future.result()
                    print(f"[Committee] {agent_name} parallel loop completed")
                except Exception as e:
                    print(f"[Committee] {agent_name} parallel loop FAILED: {e}")
                    parallel_results[agent_name] = {"messages": [
                        AIMessage(content=f"(Error during {agent_name} analysis: {e})", name=agent_name)
                    ]}

        # Merge results in deterministic order: Research → Quant → Risk
        merged_msgs = list(msgs)
        for name in agent_order:
            new_msgs = _extract_new_messages(parallel_results[name], input_count)
            merged_msgs.extend(new_msgs)

        print(f"[Committee] Parallel loop done. Merged {len(merged_msgs) - input_count} new messages from 3 agents.")

        # ── LOOPS 2+: SEQUENTIAL DoC deliberation ─────────────────────
        if loops > 1:
            # Add a handoff message so agents know they're in DoC mode
            merged_msgs.append(HumanMessage(
                content=(
                    "System: All three agents have completed their independent analysis above. "
                    "Now entering sequential Disagree-or-Commit deliberation. "
                    f"Remaining DoC rounds: {loops - 1}. "
                    "Each agent should review the others' findings and respond."
                )
            ))

            # Feed the merged first-loop output into the sequential subgraph
            # for the remaining DoC loops
            out = committee_graph.invoke({
                "messages": merged_msgs,
                "max_loops": loops - 1,  # remaining loops after the parallel one
            })
            return _extract_committee_text(out["messages"])
        else:
            # Single loop — just return the parallel results
            return _extract_committee_text(merged_msgs)

    tools += [run_committee]
    agents = [*members.values(), committee_graph]

    if allow_single_calls:
        # If single calls are allowed, we can just create a supervisor without the complex graph
        supervisor_agent = create_supervisor(
            agents=agents,
            model=llm,
            tools=supervisor_config.tools,
            name=supervisor_config.name,
            prompt=system_prompt,
            output_mode="full_history",
            response_format= report_schema if report_generation else None,
        ).compile()
    else:
        supervisor_agent = create_react_agent(
            llm,
            tools=tools,
            name=supervisor_config.name,
            system_prompt=system_prompt,
            middleware=[
                ContextEditingMiddleware(
                    edits=[
                        ClearToolUsesEdit(
                            trigger=2000,  # token threshold
                            keep=2,  # keep most recent tool results
                            clear_tool_inputs=True,  # also wipe tool call args if you want
                            placeholder="[cleared]",
                        )
                    ]
                )
            ],
        )

    # builder = StateGraph(WorkflowState)
    # builder.add_node("SupervisorAgent", supervisor_agent)

    # # Loop Manager Node
    # def loop_manager(state: WorkflowState) -> dict:
    #     current_count = state.get("loop_count", 0)
    #     return {"loop_count": current_count + 1}

    # builder.add_node("LoopManager", loop_manager)

    # # Add member agents
    # # Assuming members dict contains "ResearchAgent", "QuantAgent", "RiskManagementAgent"
    # if "ResearchAgent" in members:
    #     builder.add_node("ResearchAgent_Comm", members["ResearchAgent"])
    # if "QuantAgent" in members:
    #     builder.add_node("QuantAgent_Comm", members["QuantAgent"])
    # if "RiskManagementAgent" in members:
    #     builder.add_node("RiskManagementAgent_Comm", members["RiskManagementAgent"])
    # builder.add_edge(START, "SupervisorAgent")

    # def route_supervisor(state: WorkflowState) -> str:
    #     messages = state["messages"]
    #     # Iterate backwards to find the most recent tool call from Supervisor
    #     for i in range(len(messages) - 1, -1, -1):
    #         msg = messages[i]

    #         # If we encounter a message from another agent, stop searching
    #         if isinstance(msg, AIMessage) and getattr(msg, "name", "") in ["ResearchAgent", "QuantAgent", "RiskManagementAgent"]:
    #             break

    #         if hasattr(msg, "tool_calls") and msg.tool_calls:
    #             for tool_call in msg.tool_calls:
    #                 if tool_call["name"] == "transfer_to_committee":
    #                     return "committee"
    #     return "end"

    # # Reset loop count when starting fresh from Supervisor
    # def reset_loop_count(state: WorkflowState) -> dict:
    #     return {"loop_count": 0}

    # # We need a small node to reset the counter if we want to support multiple big iterations
    # # But for now, let's just let the route_supervisor go to ResearchAgent directly.
    # # To properly reset, we can modify the graph to go Supervisor -> ResetNode -> ResearchAgent.
    # # Let's add a ResetNode.

    # def reset_node(state: WorkflowState) -> dict:
    #     return {"loop_count": 0}

    # builder.add_node("ResetNode", reset_node)

    # # Update supervisor routing
    # builder.add_conditional_edges(
    #     "SupervisorAgent", route_supervisor, {"end": END, "committee": "ResetNode"}
    # )
    # builder.add_edge("ResetNode", "ResearchAgent_Comm")

    # # Fixed loop edges
    # if "ResearchAgent" in members and "QuantAgent" in members:
    #     builder.add_edge("ResearchAgent_Comm", "QuantAgent_Comm")
    # if "QuantAgent" in members and "RiskManagementAgent" in members:
    #     builder.add_edge("QuantAgent_Comm", "RiskManagementAgent_Comm")
    # if "RiskManagementAgent" in members:
    #     builder.add_edge("RiskManagementAgent_Comm", "LoopManager")

    # def route_loop(state: WorkflowState) -> str:
    #     # Check if we have done 2 loops
    #     # Since we increment in LoopManager, if it was 0, it becomes 1.
    #     # If it was 1, it becomes 2.
    #     # If count < 2, go back to ResearchAgent.
    #     # If count >= 2, go to SupervisorAgent.
    #     if state["loop_count"] < 2:
    #         return "ResearchAgent_Comm"
    #     return "SupervisorAgent"

    # builder.add_conditional_edges(
    #     "LoopManager", route_loop, {"ResearchAgent_Comm": "ResearchAgent_Comm", "SupervisorAgent": "SupervisorAgent"}
    # )

    return supervisor_agent


# -----------------------------
# 3) Build the Deep Agent and attach committee-as-tool (and individuals-as-tools)
# -----------------------------


def _as_subagent(name: str, description: str, runnable: Any) -> CompiledSubAgent:
    # DeepAgents expects a runnable graph / callable
    return CompiledSubAgent(name=name, description=description, runnable=runnable)


def build_deep_agent_with_committee_subagent(
    *,
    deep_model_config,  # e.g. "openai:gpt-5" OR ChatOpenAI(...)
    deep_system_prompt: str,
    base_tools: Optional[list] = None,
    members: Dict[str, Any],
    committee_loops: int = 2,
    attach_individuals_as_subagents: bool = True,
):
    """
    Deep agent (chair) with a committee workflow as a SUBAGENT.
    Committee contains no supervisor; it is the workflow (R->Q->Risk)xN.

    Optionally attach the individual analysts as subagents too.
    """

    llm_provider, model_name = deep_model_config.llm.split("/")

    if llm_provider == "openai":
        llm = ChatOpenAI(
            model=model_name,
            temperature=deep_model_config.temperature,
            max_tokens=deep_model_config.max_tokens,
        )
    elif llm_provider == "gemini":
        llm = ChatGoogleGenerativeAI(model=model_name, temperature=deep_model_config.temperature)
    elif llm_provider == "deepseek":
        llm = ChatDeepSeek(
            model=model_name,
            temperature=deep_model_config.temperature,
            max_tokens=deep_model_config.max_tokens,
        )
    else:
        raise ValueError(f"Unsupported LLM provider: {llm_provider}")
    # committee subgraph: no supervisor inside
    committee_graph = build_committee_subgraph(members, loops=committee_loops)

    # subagents available via DeepAgents `task(...)`
    subagents: List[CompiledSubAgent] = [
        _as_subagent(
            name="committee",
            description="Run the full committee workflow: (Research -> Quant -> Risk) repeated.",
            runnable=committee_graph,
        )
    ]

    if attach_individuals_as_subagents:
        if "ResearchAgent" in members:
            subagents.append(
                _as_subagent(
                    "research",
                    "Research analyst: thesis, catalysts, fundamentals, evidence.",
                    members["ResearchAgent"],
                )
            )
        if "QuantAgent" in members:
            subagents.append(
                _as_subagent(
                    "quant",
                    "Quant analyst: data checks, factor/alpha modeling, backtests, stats.",
                    members["QuantAgent"],
                )
            )
        if "RiskManagementAgent" in members:
            subagents.append(
                _as_subagent(
                    "risk",
                    "Risk analyst: drawdowns, scenarios, sizing, constraints, hedges.",
                    members["RiskManagementAgent"],
                )
            )

    # You can still keep explicit tools if you want (optional).
    # If you *also* want tool-form access, add build_committee_and_member_tools(...) here.
    tools = list(base_tools or [])

    deep_agent = create_deep_agent(
        model=llm,
        tools=tools,
        system_prompt=deep_system_prompt,
        subagents=subagents,
        context_schema=WorkflowState,
    )

    return deep_agent


class Agent:
    """Base Agent placeholder for z_framework."""

    def run(self, *args, **kwargs):
        """Run the agent."""
        raise NotImplementedError("Implement in concrete subclasses")
