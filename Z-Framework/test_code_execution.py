"""Test script for code_execution tool with Gemini."""
from src.z_framework.config import AgentConfig
from src.z_framework.agent import build_agent

# Create config with code_execution enabled
config = AgentConfig(
    name="test_agent",
    description="Test agent for code execution",
    llm="gemini/gemini-2.0-flash",
    enable_code_execution=True,
    temperature=0.0
)

# Build the agent
agent = build_agent(config)

# Test with a simple computation task
result = agent.invoke({
    "messages": [{"role": "user", "content": "Calculate the sum of squares from 1 to 10 using Python code."}]
})

print("=== Response ===")
for msg in result["messages"]:
    print(f"[{msg.type}]: {msg.content}")
