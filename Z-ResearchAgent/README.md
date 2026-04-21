# Z-ResearchAgent

A specialized financial research agent built on the Z-Framework for comprehensive stock market analysis.

## Overview

Z-ResearchAgent is a LangGraph-based AI agent that provides:

- **📞 Earnings Intelligence** - Detailed earnings call transcripts with speaker identification
- **💰 Fundamental Analysis** - Financial ratios, company profiles, analyst coverage
- **📋 Regulatory Intelligence** - AI-summarized SEC filings (10-K, 10-Q, 8-K)
- **📈 Technical Analysis** - Technical indicators (SMA, EMA, RSI, MACD) and historical data
- **🌐 Market Intelligence** - Web search for macro trends and industry analysis

---

## Quick Start

```bash
# Install dependencies
uv sync
source .venv/bin/activate

# Set up API keys
export FINNHUB_API_KEY="your_key"
export POLYGON_API_KEY="your_key"
export TAVILY_API_KEY="your_key"
export GOOGLE_API_KEY="your_key"  # For SEC summaries

# Run the agent
langgraph dev
```

---

## Tool Selection Guide

Each tool is optimized for specific data types. Use the right tool for your research:

| Data Need | Tool to Use | Example |
|-----------|-------------|---------|
| 📞 Earnings call transcripts | `defeatbeta_earning_call()` | Get Tesla's Q4 2024 earnings call |
| 💰 Financial ratios (P/E, ROE) | `finnhub_data(data_type="financial_metrics")` | Get Apple's valuation ratios |
| 💹 Real-time stock quotes | `finnhub_data(data_type="quote")` | Get current NVDA price |
| 📱 Social/news sentiment | `finnhub_data(data_type="social_sentiment")` | Check GME Reddit sentiment |
| 📊 Analyst ratings | `finnhub_data(data_type="recommendation")` | Get analyst ratings for TSLA |
| 📋 SEC filings | `sec_document_retriever(doc_type="10-K")` | Get Apple's annual report |
| 📈 Technical indicators | `polygon_stock_data(data_type="sma")` | Calculate 50-day SMA for AAPL |
| 📉 Historical OHLC data | `polygon_stock_data(data_type="aggregates")` | Get 6 months of price data |
| 🌐 Macro trends & news | `web_search(query="...")` | Search for Fed rate decisions |

---

## Tools Documentation

### 1. Earnings Call Transcripts - `defeatbeta_earning_call()`

**Best For:** Most comprehensive earnings call transcripts with speaker identification

**Parameters:**
- `ticker` (str): Stock ticker (e.g., "AAPL")
- `fiscal_year` (int, optional): Fiscal year (e.g., 2024)
- `fiscal_quarter` (int, optional): Quarter 1-4
- `list_only` (bool): Set to True to list available transcripts

**Examples:**
```python
# List available transcripts
defeatbeta_earning_call("TSLA", list_only=True)

# Get latest earnings call
defeatbeta_earning_call("AAPL")

# Get specific quarter
defeatbeta_earning_call("NVDA", fiscal_year=2024, fiscal_quarter=4)
```

---

### 2. Fundamental Data - `finnhub_data()`

**Best For:** Company fundamentals, real-time quotes, sentiment analysis, analyst coverage

**Key Data Types:**
- `company_profile` - Company overview and market cap
- `financial_metrics` - P/E, ROE, margins, debt ratios
- `quote` - Real-time price and daily performance
- `social_sentiment` - Reddit/Twitter sentiment (requires dates)
- `news_sentiment` - News sentiment and buzz
- `recommendation` - Analyst ratings
- `price_target` - Analyst price targets
- `insider_transactions` - Insider trading activity

**Examples:**
```python
# Get financial ratios
finnhub_data("AAPL", data_type="financial_metrics")

# Get real-time quote
finnhub_data("TSLA", data_type="quote")

# Check social sentiment
finnhub_data("GME", data_type="social_sentiment",
             from_date="2024-01-01", to_date="2024-01-31")
```

**Requirements:** `FINNHUB_API_KEY` (Free tier: 60 calls/min)

---

### 3. SEC Filings - `sec_document_retriever()`

**Best For:** Official SEC filings with AI-generated summaries

**Parameters:**
- `ticker` (str): Stock ticker
- `doc_type` (str): Filing type
  - `"10-K"` - Annual report (comprehensive)
  - `"10-Q"` - Quarterly report
  - `"8-K"` - Material events
  - `"DEF 14A"` - Proxy statement

**Examples:**
```python
# Get annual report
sec_document_retriever("AAPL", doc_type="10-K")

# Get quarterly report
sec_document_retriever("TSLA", doc_type="10-Q")
```

**Output:** AI summary + MD&A section + Risk factors + Filing link

---

### 4. Technical Analysis - `polygon_stock_data()`

**Best For:** Technical indicators and historical price data

**Key Data Types:**
- `aggregates` - Historical OHLC bars (most common)
- `previous_close` - Previous day's performance
- `sma` / `ema` / `rsi` / `macd` - Technical indicators

**Parameters:**
- `ticker` (str): Stock ticker
- `data_type` (str): Type of data
- `timespan` (str): minute, hour, day, week, month
- `from_date` / `to_date` (str): Date range YYYY-MM-DD
- `limit` (int): Max results (default: 120)

**Examples:**
```python
# Get 6 months of daily prices
polygon_stock_data("AAPL", data_type="aggregates", timespan="day")

# Calculate 50-day SMA
polygon_stock_data("NVDA", data_type="sma", timespan="day", limit=50)

# Get RSI indicator
polygon_stock_data("TSLA", data_type="rsi", timespan="day")
```

**Requirements:** `POLYGON_API_KEY` (Free tier supports data from 2024+)

---

### 5. Web Search - `web_search()`

**Best For:** Macro trends, industry analysis, breaking news

**Parameters:**
- `query` (str): Search query

**Examples:**
```python
web_search("Federal Reserve interest rate decision December 2024")
web_search("NVDA AI chip demand trends 2024")
web_search("semiconductor industry outlook 2025")
```

**Requirements:** `TAVILY_API_KEY`

---

## Project Structure

```
Z-ResearchAgent/
├── src/z_research_agent/
│   ├── agent.py              # Main agent configuration
│   ├── prompts.py            # System prompts (optimized)
│   └── tools/
│       └── research_tools.py # 5 research tools (652 lines, optimized)
├── langgraph.json            # LangGraph configuration
├── pyproject.toml            # Dependencies
└── README.md
```

---

## Configuration

**Agent Settings** (`src/z_research_agent/agent.py`):
- **Model:** Google Gemini 2.5 Flash
- **Temperature:** 0.3
- **Tools:** 5 specialized research tools

---

## Environment Variables

```bash
# Required
export FINNHUB_API_KEY="your_key"      # Get at https://finnhub.io/register
export POLYGON_API_KEY="your_key"      # Get at https://polygon.io/dashboard/signup
export TAVILY_API_KEY="your_key"       # Get at https://tavily.com
export GOOGLE_API_KEY="your_key"       # Get at https://ai.google.dev

# Optional (if using OpenAI for summarization)
export OPENAI_API_KEY="your_key"
```

---

## Example Questions

**Earnings Calls:**
- "What did Tesla discuss in their Q4 2024 earnings call?"
- "Show me Apple's latest earnings call transcript"

**Fundamentals:**
- "What is NVDA's P/E ratio and profit margins?"
- "Get me Tesla's current stock price"
- "What's the social media sentiment around GME?"

**SEC Filings:**
- "Get Apple's latest 10-K annual report"
- "What are the risk factors in Tesla's SEC filings?"

**Technical Analysis:**
- "Calculate the 50-day moving average for AAPL"
- "Show me the RSI indicator for NVDA"
- "Get 6 months of historical price data for TSLA"

**Market Trends:**
- "What's the latest on Federal Reserve interest rates?"
- "Search for NVDA AI chip demand trends"

---

## Code Optimization

This project has been heavily optimized for clarity and efficiency:

| Component | Before | After | Reduction |
|-----------|--------|-------|-----------|
| **research_tools.py** | 1,522 lines | 652 lines | ↓ 57% |
| **prompts.py** | 137 lines | 65 lines | ↓ 52% |
| **README.md** | 494 lines | ~180 lines | ↓ 64% |
| **Prompt tokens** | ~4,200 chars | ~1,600 chars | ↓ 62% |

**Key Improvements:**
- ✅ Eliminated duplicate tool functionality
- ✅ Enhanced docstrings with "BEST FOR" and "AVOID FOR" sections
- ✅ Standardized Markdown format for better LLM understanding
- ✅ Reduced token consumption by 60%+

See optimization reports:
- `OPTIMIZATION_COMPLETE.md` - Tools optimization
- `PROMPTS_OPTIMIZATION_COMPLETE.md` - Prompts optimization
- `MARKDOWN_FORMAT_IMPROVEMENT.md` - Format standardization

---

## Development

**Requirements:**
- Python >= 3.10
- Z-Framework >= 0.1.0
- uv for dependency management

**Key Dependencies:**
- langchain_google_genai
- langchain_community
- defeatbeta-api (for earnings calls)
- requests

**Version:** 0.1.0 (Active Development)

---

## License

See LICENSE file for details.

---

## Documentation

For detailed optimization reports and technical documentation, see:
- `TOOLS_ANALYSIS.md` - Complete tool functionality analysis
- `OPTIMIZATION_COMPLETE.md` - Code optimization report
- `PROMPTS_OPTIMIZATION_COMPLETE.md` - Prompt engineering improvements
- `MARKDOWN_FORMAT_IMPROVEMENT.md` - Format standardization guide

**Note:** All tools include detailed docstrings with usage examples. Check the "BEST FOR" and "AVOID FOR" sections in each tool's documentation.
