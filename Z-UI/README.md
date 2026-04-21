# Z-UI

Frontend for the AgentZ multi-agent financial analysis system.

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                        User Browser                              │
│                                                                  │
│   React App (port 3000)                                          │
│   ┌─────────────┐    ┌──────────────┐    ┌──────────────────┐   │
│   │  Chat.tsx   │    │   api.ts     │    │  userStorage.ts  │   │
│   │  (UI layer) │───▶│ (API client) │    │  (localStorage)  │   │
│   └─────────────┘    └──────┬───────┘    └──────────────────┘   │
│                             │ /api/* (Vite proxy)                │
└─────────────────────────────┼────────────────────────────────────┘
                              │ HTTP / SSE stream
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│               Z-App  ·  LangGraph Server (port 2024)            │
│                                                                 │
│   ┌─────────────────┐  ┌─────────────────┐  ┌───────────────┐  │
│   │ research_agent  │  │  quant_agent    │  │  risk_mgmt_   │  │
│   │                 │  │                 │  │    agent      │  │
│   │ Google Search   │  │ Quant Models    │  │ Risk Models   │  │
│   │ Polygon / FH    │  │ Polygon / FH    │  │ Polygon / FH  │  │
│   └─────────────────┘  └─────────────────┘  └───────────────┘  │
│                                                                 │
│   External APIs: OpenRouter · Tavily · Polygon.io · Finnhub     │
└─────────────────────────────────────────────────────────────────┘
```

## Prerequisites

- Node.js v18+
- Python 3.11+
- [uv](https://github.com/astral-sh/uv) (Python package manager)

## Quick Start

### 1. Start the Backend (Z-App)

```bash
cd ../Z-App
uv sync                  # first time only
uv run langgraph dev
```

Backend starts on:
- **API**: http://127.0.0.1:2024
- **Docs**: http://127.0.0.1:2024/docs
- **LangGraph Studio**: https://smith.langchain.com/studio/?baseUrl=http://127.0.0.1:2024

### 2. Start the Frontend (Z-UI)

```bash
npm install              # first time only
npm run dev
```

Frontend: http://localhost:3000

## Updating All Repos

```bash
for dir in Z-UI Z-App Z-Framework Z-QuantAgent Z-ResearchAgent Z-RiskManagementAgent; do
  echo "Updating $dir..." && cd $dir && git pull origin main && cd ..
done
```

After pulling, reinstall if dependencies changed:

```bash
cd Z-UI && npm install
cd Z-App && uv sync
```

## Project Structure

```
Z-UI/
├── src/
│   ├── components/          # Reusable UI components
│   │   └── LightweightChartCard.tsx   # Chart rendering
│   ├── pages/               # Page components
│   │   └── Chat.tsx         # Multi-agent chat interface
│   ├── services/
│   │   ├── api.ts           # LangGraph API client
│   │   ├── userStorage.ts   # localStorage persistence
│   │   └── tradingEngine.ts # Paper trading engine
│   ├── context/
│   │   └── TradeContext.tsx
│   └── App.tsx
├── vite.config.ts           # Dev server & proxy config
└── package.json
```

---

## Chat Tab — How It Works

The Chat page (`src/pages/Chat.tsx`) lets users talk to three specialized financial agents simultaneously. Here is how the full flow works end-to-end.

### Processes

Two independent OS processes run at the same time:

| Process | Runtime | Port | Role |
|---------|---------|------|------|
| Vite dev server | Node.js | 3000 | Serve the React app; proxy `/api/*` to backend |
| LangGraph dev server | Python (uvicorn) | 2024 | Execute agent graphs; expose REST + SSE endpoints |

`vite.config.ts` configures the proxy:

```ts
proxy: {
  '/api': {
    target: 'http://127.0.0.1:2024',
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/api/, '')
  }
}
```

All `fetch('/api/...')` calls in the browser are transparently forwarded to the LangGraph server, avoiding CORS issues in development.

### LangGraph Threads (Conversation State)

A LangGraph **Thread** is a persistent conversation context stored on the backend — think of it as a database row that holds message history and agent state for one conversation.

Each `ChatSession` holds **three independent threads**, one per agent:

```ts
interface ChatSession {
  id: string;
  researchThreadId:  string | null;  // context for research_agent
  quantThreadId:     string | null;  // context for quant_agent
  riskThreadId:      string | null;  // context for risk_management_agent
  messages:          Message[];
}
```

Threads are created lazily on the user's first message:

```
POST /api/threads
body: { metadata: { user_id: "..." } }
→ { thread_id: "uuid" }
```

### Message Flow

```
User submits a message
        │
        ▼
Chat.tsx  handleSendMessage()
        │
        ├─ first message? → createThreadWithUser() × 3 (one per agent)
        │
        ▼
  Promise.all([...])          ← 3 HTTP requests fired concurrently
        │
        ├──▶ POST /api/threads/{researchThreadId}/runs/stream
        │         { assistant_id: "research_agent", input: { messages } }
        │
        ├──▶ POST /api/threads/{quantThreadId}/runs/stream
        │         { assistant_id: "quant_agent",    input: { messages } }
        │
        └──▶ POST /api/threads/{riskThreadId}/runs/stream
                  { assistant_id: "risk_management_agent", input: { messages } }
                          │
                          ▼
               LangGraph server (Python)
               Each agent runs independently
               Tools: Google Search · Polygon.io · Finnhub
               Returns SSE event stream
                          │
                          ▼
        api.ts  parseAgentResponse()
        Extracts: text · images · lightweightCharts
        mapNodeToAgent() tags each message with its source agent
                          │
                          ▼
        Chat.tsx updates React state → re-render
        Displays answers + charts from all three agents
```

> **Concurrency note:** JavaScript is single-threaded. `Promise.all` sends three HTTP requests in parallel without blocking the UI — this is cooperative multitasking via the event loop, not OS-level threads.

### Agent Definitions (`langgraph.json`)

```json
{
  "graphs": {
    "research_agent":         "./src/z_app/app.py:research_agent",
    "quant_agent":            "./src/z_app/app.py:quant_agent",
    "risk_management_agent":  "./src/z_app/app.py:risk_management_agent"
  }
}
```

LangGraph reads this file at startup and creates a REST route for every entry. The `assistant_id` field in each request body selects which graph handles the run.

### Session Persistence

Chat sessions are saved to `localStorage` via `src/services/userStorage.ts` so they survive page reloads. An anonymous UUID is generated once per browser and attached to every thread as metadata, so the backend can associate threads with a user without requiring login.

```
localStorage keys
  clearpath_user_id            ← anonymous UUID (generated once)
  clearpath_chat_sessions      ← full ChatSession[] array
  clearpath_thread_titles      ← thread_id → display title map
  clearpath_selected_chat_id   ← last-viewed chat
```

### Key Concepts Summary

| Concept | Mechanism | Notes |
|---------|-----------|-------|
| Inter-process communication | HTTP + Vite proxy | Frontend never sees cross-origin requests |
| Conversation state | LangGraph Thread | One thread per agent, stored on the backend |
| Parallel agent calls | `Promise.all` | JS event loop, not OS threads |
| Streaming responses | Server-Sent Events (SSE) | Responses appear incrementally |
| Local persistence | `localStorage` | Via `userStorage.ts` |

---

## Troubleshooting

**`ECONNREFUSED 127.0.0.1:2024`** — Z-App is not running. Start it with `uv run langgraph dev` in the Z-App directory.

**`ModuleNotFoundError` (backend)** — Run `uv sync` in Z-App, then use `uv run langgraph dev` (not `langgraph dev` directly).
