from langchain_core.tools import tool
from langchain_community.tools.tavily_search import TavilySearchResults
from langchain_google_genai import ChatGoogleGenerativeAI
import os
import requests
from typing import Optional, List, Tuple, Dict, Any
import re
from datetime import datetime, timedelta
import json
import time as _time
from concurrent.futures import ThreadPoolExecutor, as_completed
from ..prompts import SEC_SUMMARY_PROMPT

# ========== SIMPLE TTL CACHE ==========

_CACHE: Dict[str, Any] = {}
_CACHE_TIMESTAMPS: Dict[str, float] = {}
_CACHE_TTL_DEFAULT = 300        # 5 分钟（Finnhub 等实时数据）
_CACHE_TTL_SEC = 86400          # 24 小时（SEC filing，不频繁变化）
_CACHE_TTL_EARNING = 3600       # 1 小时（earnings transcript）

def _cache_get(key: str, ttl: int = _CACHE_TTL_DEFAULT) -> Optional[Any]:
    if key in _CACHE:
        if _time.time() - _CACHE_TIMESTAMPS.get(key, 0) < ttl:
            return _CACHE[key]
        del _CACHE[key]
        _CACHE_TIMESTAMPS.pop(key, None)
    return None

def _cache_set(key: str, value: Any) -> None:
    _CACHE[key] = value
    _CACHE_TIMESTAMPS[key] = _time.time()

# ========== TIMING UTILITY ==========

def _timed(fn):
    """装饰器：打印每次工具调用的耗时"""
    import functools
    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        t0 = _time.time()
        result = fn(*args, **kwargs)
        elapsed = _time.time() - t0
        print(f"[TIMING] {fn.__name__} 耗时 {elapsed:.2f}s")
        return result
    return wrapper

# Import defeatbeta-api for earnings call transcripts
try:
    import defeatbeta_api
    from defeatbeta_api.data.ticker import Ticker as DefeatBetaTicker
    DEFEATBETA_AVAILABLE = True
except Exception:
    DEFEATBETA_AVAILABLE = False

# ========== HELPER FUNCTIONS ==========

def format_section(title: str, data: Dict[str, Any], width: int = 80) -> str:
    """Format a section with title and key-value pairs"""
    lines = [f"\n{title}", "-" * width]
    for key, value in data.items():
        lines.append(f"{key}: {value}")
    return "\n".join(lines)

def format_header(title: str, width: int = 80) -> str:
    """Format a header with title"""
    return f"{title}\n{'=' * width}"

def safe_request(url: str, params: Dict = None, headers: Dict = None, timeout: int = 10, _label: str = "") -> Optional[Dict]:
    """Make HTTP request with error handling and caching"""
    import hashlib, json as _json
    cache_key = f"req:{url}:{hashlib.md5(_json.dumps(params or {}, sort_keys=True).encode()).hexdigest()}"
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached
    try:
        t0 = _time.time()
        response = requests.get(url, params=params, headers=headers, timeout=timeout)
        response.raise_for_status()
        result = response.json()
        label = _label or url.split("/")[4] if len(url.split("/")) > 4 else url[:40]
        print(f"[TIMING] HTTP {label} 耗时 {_time.time()-t0:.2f}s (cache miss)")
        _cache_set(cache_key, result)
        return result
    except (requests.RequestException, ValueError, KeyError):
        return None

def get_env_or_error(key: str, signup_url: str) -> str:
    """Get environment variable or raise error with signup URL"""
    value = os.getenv(key)
    if not value:
        raise ValueError(f"{key} not set. Get your API key at {signup_url}")
    return value

# Lazy initialization of Tavily search tool
_tavily_search = None

def _get_tavily_search():
    global _tavily_search
    if _tavily_search is None:
        api_key = get_env_or_error("TAVILY_API_KEY", "https://tavily.com")
        _tavily_search = TavilySearchResults(
            max_results=5, search_depth="advanced",
            include_answer=True, include_raw_content=True, api_key=api_key
        )
    return _tavily_search

# ========== TOOLS ==========

@tool
def web_search(query: str) -> str:
    """
    Search the web for market trends, news, and analysis.

    Use for: macro events, market trends, industry analysis, breaking news.
    Avoid for: fundamentals (use finnhub_data), SEC filings (use sec_document_retriever),
    technical indicators (use polygon_stock_data).

    Args:
        query: Search query (e.g., "NVDA AI chip demand trends Q4 2024")
    """
    try:
        results = _get_tavily_search().invoke({"query": query})
        if not results:
            return f"No results found for: {query}"

        output = [format_header(f"Web Search Results: '{query}'")]
        for idx, result in enumerate(results, 1):
            output.append(f"\n[{idx}] {result.get('title', 'N/A')}")
            output.append(f"URL: {result.get('url', 'N/A')}")
            output.append(f"Content: {result.get('content', 'N/A')[:1000]}...")
            output.append("-" * 80)
        return "\n".join(output)
    except Exception as e:
        return f"Error: {str(e)}"

def _get_cik_from_ticker(ticker: str) -> Optional[str]:
    """Get CIK number from ticker symbol"""
    data = safe_request(
        "https://www.sec.gov/files/company_tickers.json",
        headers={"User-Agent": "ResearchAgent contact@example.com"}
    )
    if not data:
        return None

    for company in data.values():
        if company.get("ticker") == ticker.upper():
            return str(company.get("cik_str")).zfill(10)
    return None

def _extract_filing_content(filing_url: str, doc_type: str) -> List[Tuple[str, str]]:
    """Extract key sections from SEC filing"""
    response = requests.get(filing_url, headers={"User-Agent": "ResearchAgent contact@example.com"}, timeout=15)
    response.raise_for_status()

    text = re.sub('<[^<]+?>', ' ', response.text)
    text = re.sub('\s+', ' ', text).strip()

    sections = []
    if doc_type.upper() in ["10-K", "10-Q"]:
        patterns = [
            ("MD&A", r'(ITEM\s*[27][\.\s]*MANAGEMENT.{0,100}?DISCUSSION.*?)(?=ITEM\s*[38]|$)'),
            ("Risk Factors", r'(ITEM\s*1A[\.\s]*RISK\s*FACTORS.*?)(?=ITEM\s*[12]B|$)'),
            ("Financials", r'(ITEM\s*8[\.\s]*FINANCIAL\s*STATEMENTS.*?)(?=ITEM\s*9|$)')
        ]
        for name, pattern in patterns:
            match = re.search(pattern, text, re.IGNORECASE | re.DOTALL)
            if match:
                sections.append((name, match.group(1)[:8000]))

    return sections if sections else [("Preview", text[:5000])]

# 模块级单例，避免每次调用重新实例化
_SEC_SUMMARY_LLM = None

def _get_sec_summary_llm():
    global _SEC_SUMMARY_LLM
    if _SEC_SUMMARY_LLM is None:
        _SEC_SUMMARY_LLM = ChatGoogleGenerativeAI(model="gemini-3-flash-preview", temperature=0.3)
    return _SEC_SUMMARY_LLM

def _summarize_sections(ticker: str, company_name: str, sections: List[Tuple[str, str]], doc_type: str) -> str:
    """Generate AI summary of SEC filing sections"""
    try:
        llm = _get_sec_summary_llm()
        content = f"Company: {company_name} ({ticker})\nDocument: {doc_type}\n\n"
        content += "\n\n".join([f"=== {name} ===\n{text[:4000]}" for name, text in sections])

        prompt = SEC_SUMMARY_PROMPT.format(doc_type=doc_type, content=content)
        t0 = _time.time()
        result = llm.invoke(prompt).content
        print(f"[TIMING] SEC LLM 摘要 ({ticker} {doc_type}) 耗时 {_time.time()-t0:.2f}s")
        return result
    except Exception as e:
        return f"Summary generation failed: {str(e)}"

@tool
def sec_document_retriever(ticker: str, doc_type: str = "10-K") -> str:
    """
    Retrieve and analyze SEC filings with AI summary.

    Use for: official filings, MD&A, risk factors, financial statements.
    Document types: 10-K (annual), 10-Q (quarterly), 8-K (events), DEF 14A (proxy).

    Args:
        ticker: Stock ticker (e.g., "AAPL")
        doc_type: Filing type (default: "10-K")
    """
    try:
        sec_cache_key = f"sec:{ticker.upper()}:{doc_type}"
        cached = _cache_get(sec_cache_key, ttl=_CACHE_TTL_SEC)
        if cached is not None:
            return cached

        cik = _get_cik_from_ticker(ticker)
        if not cik:
            return f"Error: Could not find CIK for '{ticker}'"

        data = safe_request(
            f"https://data.sec.gov/submissions/CIK{cik}.json",
            headers={"User-Agent": "ResearchAgent contact@example.com"}
        )
        if not data:
            return "Error fetching SEC data"

        company_name = data.get("name", "Unknown")
        filings = data.get("filings", {}).get("recent", {})

        # Find matching filing
        filing = None
        for i, form in enumerate(filings.get("form", [])):
            if form == doc_type:
                filing = {
                    "date": filings["filingDate"][i],
                    "accession": filings["accessionNumber"][i].replace("-", ""),
                    "document": filings["primaryDocument"][i]
                }
                break

        if not filing:
            return f"No {doc_type} found for {ticker}"

        filing_url = f"https://www.sec.gov/Archives/edgar/data/{cik.lstrip('0')}/{filing['accession']}/{filing['document']}"
        sections = _extract_filing_content(filing_url, doc_type)
        summary = _summarize_sections(ticker.upper(), company_name, sections, doc_type)

        output = [
            format_header(f"SEC {doc_type} Filing: {ticker.upper()} ({company_name})"),
            f"Filing Date: {filing['date']}",
            f"URL: {filing_url}\n",
            format_section("📊 AI SUMMARY", {"": summary}),
            "\n📄 DETAILED SECTIONS\n" + "=" * 80
        ]

        for name, content in sections:
            output.append(f"\n[{name}]\n{'-' * 80}\n{content[:8000]}")

        output.append(f"\n📎 Full document: {filing_url}")
        result = "\n".join(output)
        _cache_set(sec_cache_key, result)
        return result

    except Exception as e:
        return f"Error: {str(e)}"

@tool
def polygon_stock_data(
    ticker: str,
    data_type: str = "aggregates",
    timespan: str = "day",
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    limit: int = 120
) -> str:
    """
    🎯 Technical analysis and historical price data from Polygon.io

    🔍 BEST FOR:
    ✅ Technical indicators (SMA, EMA, RSI, MACD)
    ✅ Historical OHLC data for charting
    ✅ Volume and price pattern analysis
    ✅ Quantitative backtesting

    🚫 AVOID FOR (use other tools):
    ❌ Real-time quotes → use finnhub_data(data_type="quote")
    ❌ Company information → use finnhub_data(data_type="company_profile")
    ❌ Financial ratios → use finnhub_data(data_type="financial_metrics")

    📊 Available data_type:
    - "aggregates": Historical OHLC bars (most common)
    - "previous_close": Previous trading day performance
    - "sma"/"ema"/"rsi"/"macd": Technical indicators

    ⏱ Timespan (for aggregates): minute, hour, day, week, month
    📅 Date format: YYYY-MM-DD (defaults to last 120 periods if not specified)

    Args:
        ticker: Stock ticker (e.g., "AAPL")
        data_type: Type of data (default: "aggregates")
        timespan: Time period (default: "day")
        from_date: Start date YYYY-MM-DD (optional)
        to_date: End date YYYY-MM-DD (optional)
        limit: Max results (default: 120)
    """
    try:
        api_key = get_env_or_error("POLYGON_API_KEY", "https://polygon.io/dashboard/signup")
        ticker = ticker.upper()
        base_url = "https://api.polygon.io"

        # Set date defaults
        to_date = to_date or datetime.now().strftime("%Y-%m-%d")
        if not from_date:
            to_date_obj = datetime.strptime(to_date, "%Y-%m-%d")
            days_map = {"minute": 7, "hour": 30, "day": int(limit * 1.5), "week": limit * 7, "month": limit * 30}
            from_date_obj = to_date_obj - timedelta(days=days_map.get(timespan, 365))
            from_date_obj = max(from_date_obj, datetime(2024, 1, 1))  # Free tier limit
            from_date = from_date_obj.strftime("%Y-%m-%d")

        # Route to endpoint
        if data_type == "aggregates":
            url = f"{base_url}/v2/aggs/ticker/{ticker}/range/1/{timespan}/{from_date}/{to_date}"
            data = safe_request(url, params={"adjusted": "true", "sort": "asc", "limit": limit, "apiKey": api_key})

            if not data or data.get("status") != "OK" or not data.get("results"):
                return f"No aggregate data found for {ticker}"

            results = data["results"]
            closes = [r["c"] for r in results]
            volumes = [r["v"] for r in results]

            output = [
                format_header(f"📊 {ticker} Price Data"),
                f"Timespan: {timespan} | Period: {from_date} to {to_date} | Points: {len(results)}",
                format_section("📈 SUMMARY", {
                    "Period High": f"${max([r['h'] for r in results]):.2f}",
                    "Period Low": f"${min([r['l'] for r in results]):.2f}",
                    "Latest Close": f"${closes[-1]:.2f}",
                    "Period Return": f"{((closes[-1] - closes[0]) / closes[0] * 100):.2f}%",
                    "Avg Volume": f"{sum(volumes) / len(volumes):,.0f}"
                }),
                f"\n📅 RECENT DATA (Last 10)\n{'-' * 80}",
                f"{'Date':<12} {'Open':>10} {'High':>10} {'Low':>10} {'Close':>10} {'Volume':>15}",
                "-" * 80
            ]

            for r in results[-10:]:
                date = datetime.fromtimestamp(r["t"] / 1000).strftime("%Y-%m-%d")
                output.append(f"{date:<12} ${r['o']:>9.2f} ${r['h']:>9.2f} ${r['l']:>9.2f} ${r['c']:>9.2f} {r['v']:>15,}")

            return "\n".join(output)

        elif data_type == "previous_close":
            data = safe_request(f"{base_url}/v2/aggs/ticker/{ticker}/prev", params={"apiKey": api_key})
            if not data or not data.get("results"):
                return f"No previous close data for {ticker}"

            prev = data["results"][0]
            return "\n".join([
                format_header(f"📅 {ticker} Previous Day"),
                format_section("DATA", {
                    "Date": datetime.fromtimestamp(prev['t'] / 1000).strftime('%Y-%m-%d'),
                    "Open": f"${prev['o']:.2f}",
                    "High": f"${prev['h']:.2f}",
                    "Low": f"${prev['l']:.2f}",
                    "Close": f"${prev['c']:.2f}",
                    "Volume": f"{prev['v']:,}",
                    "VWAP": f"${prev['vw']:.2f}"
                })
            ])

        elif data_type in ["sma", "ema", "rsi", "macd"]:
            params = {
                "timespan": timespan, "adjusted": "true",
                "window": limit if data_type in ["sma", "ema", "rsi"] else 12,
                "series_type": "close", "order": "desc", "limit": 10, "apiKey": api_key
            }
            data = safe_request(f"{base_url}/v1/indicators/{data_type}/{ticker}", params=params)

            if not data or not data.get("results", {}).get("values"):
                return f"No {data_type.upper()} data for {ticker}"

            values = data["results"]["values"][:10]
            output = [
                format_header(f"📈 {ticker} {data_type.upper()}"),
                f"Timespan: {timespan} | Window: {params['window']}\n",
                f"{'Timestamp':<20} {'Value':>15}",
                "-" * 40
            ]

            for v in values:
                ts = datetime.fromtimestamp(v["timestamp"] / 1000).strftime("%Y-%m-%d %H:%M:%S")
                output.append(f"{ts:<20} {v['value']:>15.2f}")

            return "\n".join(output)

        else:
            return f"Unsupported data_type: {data_type}"

    except Exception as e:
        return f"Error: {str(e)}"

@tool
def finnhub_data(
    ticker: str,
    data_type: str = "quote",
    from_date: Optional[str] = None,
    to_date: Optional[str] = None
) -> str:
    """
    🎯 Fundamental data, real-time quotes, and alternative data from Finnhub

    🔍 BEST FOR:
    ✅ Real-time stock quotes and current prices
    ✅ Company fundamentals (P/E, ROE, margins, debt ratios)
    ✅ Alternative data (social sentiment, news sentiment)
    ✅ Analyst coverage (recommendations, price targets)
    ✅ Insider transactions and ownership data

    🚫 AVOID FOR (use other tools):
    ❌ Technical indicators → use polygon_stock_data(data_type="sma/ema/rsi")
    ❌ Historical OHLC for charting → use polygon_stock_data(data_type="aggregates")
    ❌ Earnings call transcripts → use defeatbeta_earning_call()
    ❌ Official SEC filings → use sec_document_retriever()

    📊 Available data_type:

    FUNDAMENTALS:
    - "company_profile": Company overview, industry, market cap
    - "financial_metrics": Financial ratios (P/E, ROE, margins, etc.)
    - "basic_financials": Revenue and EPS history
    - "quote": Real-time price and daily performance

    ALTERNATIVE DATA:
    - "social_sentiment": Reddit/Twitter mentions and sentiment (requires dates)
    - "news_sentiment": News sentiment and buzz metrics
    - "news": Recent company news articles

    ANALYST DATA:
    - "recommendation": Buy/hold/sell recommendations
    - "price_target": Analyst price targets
    - "insider_transactions": Insider buying/selling activity

    📅 Date format: YYYY-MM-DD (required for social_sentiment)

    Args:
        ticker: Stock ticker (e.g., "AAPL")
        data_type: Type of data (default: "quote")
        from_date: Start date YYYY-MM-DD (optional, required for social_sentiment)
        to_date: End date YYYY-MM-DD (optional, required for social_sentiment)
    """
    try:
        api_key = get_env_or_error("FINNHUB_API_KEY", "https://finnhub.io/register")
        ticker = ticker.upper()
        base_url = "https://finnhub.io/api/v1"
        params = {"token": api_key, "symbol": ticker}

        # Route to endpoint
        if data_type == "company_profile":
            data = safe_request(f"{base_url}/stock/profile2", params=params)
            if not data:
                return f"No profile data for {ticker}"

            return "\n".join([
                format_header(f"🏢 {ticker} Profile"),
                format_section("INFO", {
                    "Name": data.get('name', 'N/A'),
                    "Country": data.get('country', 'N/A'),
                    "Industry": data.get('finnhubIndustry', 'N/A'),
                    "Market Cap": f"${data.get('marketCapitalization', 0):,.2f}M",
                    "Shares Outstanding": f"{data.get('shareOutstanding', 0):,.2f}M",
                    "IPO Date": data.get('ipo', 'N/A'),
                    "Website": data.get('weburl', 'N/A')
                })
            ])

        elif data_type == "financial_metrics":
            params["metric"] = "all"
            data = safe_request(f"{base_url}/stock/metric", params=params)
            if not data or not data.get("metric"):
                return f"No metrics for {ticker}"

            m = data["metric"]
            return "\n".join([
                format_header(f"📊 {ticker} Financial Metrics"),
                format_section("💰 VALUATION", {
                    "P/E Ratio": m.get('peBasicExclExtraTTM', 'N/A'),
                    "P/B Ratio": m.get('pbQuarterly', 'N/A'),
                    "P/S Ratio": m.get('psTTM', 'N/A'),
                    "PEG Ratio": m.get('peg', 'N/A')
                }),
                format_section("📈 PROFITABILITY", {
                    "ROE": m.get('roeTTM', 'N/A'),
                    "ROA": m.get('roaTTM', 'N/A'),
                    "Net Margin": m.get('netProfitMarginTTM', 'N/A'),
                    "Operating Margin": m.get('operatingMarginTTM', 'N/A'),
                    "Gross Margin": m.get('grossMarginTTM', 'N/A')
                }),
                format_section("💵 HEALTH", {
                    "Current Ratio": m.get('currentRatioQuarterly', 'N/A'),
                    "Quick Ratio": m.get('quickRatioQuarterly', 'N/A'),
                    "Debt/Equity": m.get('totalDebt/totalEquityQuarterly', 'N/A'),
                    "52W High": f"${m.get('52WeekHigh', 'N/A')}",
                    "52W Low": f"${m.get('52WeekLow', 'N/A')}",
                    "Beta": m.get('beta', 'N/A')
                })
            ])

        elif data_type == "quote":
            data = safe_request(f"{base_url}/quote", params=params)
            if not data or data.get("c") is None:
                return f"No quote data for {ticker}"

            return "\n".join([
                format_header(f"💹 {ticker} Quote"),
                format_section("PRICE", {
                    "Current": f"${data.get('c', 0):.2f}",
                    "Change": f"${data.get('d', 0):.2f} ({data.get('dp', 0):.2f}%)",
                    "High": f"${data.get('h', 0):.2f}",
                    "Low": f"${data.get('l', 0):.2f}",
                    "Open": f"${data.get('o', 0):.2f}",
                    "Prev Close": f"${data.get('pc', 0):.2f}",
                    "Time": datetime.fromtimestamp(data.get('t', 0)).strftime('%Y-%m-%d %H:%M:%S')
                })
            ])

        elif data_type == "social_sentiment":
            if not from_date or not to_date:
                return "Error: social_sentiment requires from_date and to_date"

            params.update({"from": from_date, "to": to_date})
            data = safe_request(f"{base_url}/stock/social-sentiment", params=params)
            if not data or (not data.get("reddit") and not data.get("twitter")):
                return f"No social sentiment for {ticker}"

            output = [format_header(f"📱 {ticker} Social Sentiment"), f"Period: {from_date} to {to_date}\n"]

            for platform, emoji in [("reddit", "🔴"), ("twitter", "🐦")]:
                if data.get(platform):
                    output.append(f"{emoji} {platform.upper()}\n{'-' * 80}")
                    for entry in data[platform][:5]:
                        output.append(f"Date: {entry.get('atTime', 'N/A')}")
                        output.append(f"  Mentions: {entry.get('mention', 0)} | Score: {entry.get('score', 0):.2f} "
                                    f"(+{entry.get('positiveScore', 0):.2f} / -{entry.get('negativeScore', 0):.2f})\n")

            return "\n".join(output)

        elif data_type == "news_sentiment":
            data = safe_request(f"{base_url}/news-sentiment", params=params)
            if not data or not data.get("sentiment"):
                return f"No news sentiment for {ticker}"

            s = data["sentiment"]
            b = data.get("buzz", {})
            return "\n".join([
                format_header(f"📰 {ticker} News Sentiment"),
                format_section("SENTIMENT", {
                    "Bullish": f"{s.get('bullishPercent', 0):.2f}%",
                    "Bearish": f"{s.get('bearishPercent', 0):.2f}%"
                }),
                format_section("BUZZ", {
                    "Articles (Last Week)": b.get('articlesInLastWeek', 0),
                    "Weekly Average": f"{b.get('weeklyAverage', 0):.2f}",
                    "Buzz Score": f"{b.get('buzz', 0):.2f}"
                })
            ])

        elif data_type == "news":
            params["from"] = from_date or (datetime.now() - timedelta(days=30)).strftime("%Y-%m-%d")
            params["to"] = to_date or datetime.now().strftime("%Y-%m-%d")
            data = safe_request(f"{base_url}/company-news", params=params)
            if not data:
                return f"No news for {ticker}"

            output = [format_header(f"📰 {ticker} News"), f"Found: {len(data)} articles\n"]
            for idx, a in enumerate(data[:10], 1):
                output.append(f"[{idx}] {a.get('headline', 'N/A')}")
                output.append(f"    {datetime.fromtimestamp(a.get('datetime', 0)).strftime('%Y-%m-%d %H:%M')} | {a.get('source', 'N/A')}")
                output.append(f"    {a.get('summary', 'N/A')[:200]}...")
                output.append(f"    {a.get('url', 'N/A')}\n")

            return "\n".join(output)

        elif data_type == "recommendation":
            data = safe_request(f"{base_url}/stock/recommendation", params=params)
            if not data:
                return f"No recommendations for {ticker}"

            output = [
                format_header(f"👔 {ticker} Analyst Recommendations"),
                f"{'Period':<12} {'Strong Buy':>12} {'Buy':>8} {'Hold':>8} {'Sell':>8} {'Strong Sell':>12}",
                "-" * 80
            ]
            for r in data[:6]:
                output.append(f"{r.get('period', 'N/A'):<12} {r.get('strongBuy', 0):>12} {r.get('buy', 0):>8} "
                            f"{r.get('hold', 0):>8} {r.get('sell', 0):>8} {r.get('strongSell', 0):>12}")

            return "\n".join(output)

        elif data_type == "price_target":
            data = safe_request(f"{base_url}/stock/price-target", params=params)
            if not data:
                return f"No price targets for {ticker}"

            return "\n".join([
                format_header(f"🎯 {ticker} Price Targets"),
                format_section("TARGETS", {
                    "Updated": data.get('lastUpdated', 'N/A'),
                    "High": f"${data.get('targetHigh', 0):.2f}",
                    "Low": f"${data.get('targetLow', 0):.2f}",
                    "Mean": f"${data.get('targetMean', 0):.2f}",
                    "Median": f"${data.get('targetMedian', 0):.2f}"
                })
            ])

        elif data_type == "insider_transactions":
            data = safe_request(f"{base_url}/stock/insider-transactions", params=params)
            if not data or not data.get("data"):
                return f"No insider transactions for {ticker}"

            output = [
                format_header(f"🔒 {ticker} Insider Transactions"),
                f"Recent: {len(data['data'])}\n",
                f"{'Date':<12} {'Name':<25} {'Type':<15} {'Shares':>12}",
                "-" * 80
            ]
            for t in data["data"][:15]:
                output.append(f"{t.get('transactionDate', 'N/A'):<12} {t.get('name', 'N/A')[:24]:<25} "
                            f"{t.get('transactionCode', 'N/A'):<15} {t.get('share', 0):>12,}")

            return "\n".join(output)

        else:
            return f"Unsupported data_type: {data_type}"

    except Exception as e:
        return f"Error: {str(e)}"


@tool
def fetch_comprehensive_finnhub_data(ticker: str) -> str:
    """
    Fetch all core Finnhub data for a ticker in parallel: quote, company_profile,
    financial_metrics, recommendation, price_target, and news_sentiment.

    Use this INSTEAD of calling finnhub_data() 6 times sequentially.
    Returns a combined report for all six data types at once.

    Args:
        ticker: Stock ticker (e.g., "AAPL")
    """
    DATA_TYPES = ["quote", "company_profile", "financial_metrics", "recommendation", "price_target", "news_sentiment"]

    def fetch_one(data_type: str) -> tuple[str, str]:
        return data_type, finnhub_data.invoke({"ticker": ticker, "data_type": data_type})

    results = {}
    t0 = _time.time()
    with ThreadPoolExecutor(max_workers=6) as executor:
        futures = {executor.submit(fetch_one, dt): dt for dt in DATA_TYPES}
        for future in as_completed(futures):
            dt, result = future.result()
            results[dt] = result
    print(f"[TIMING] fetch_comprehensive_finnhub_data({ticker}) 并行6个接口 耗时 {_time.time()-t0:.2f}s")

    output = [f"=== Comprehensive Finnhub Data: {ticker.upper()} ===\n"]
    for dt in DATA_TYPES:
        output.append(f"\n--- {dt.upper().replace('_', ' ')} ---")
        output.append(results.get(dt, f"No data for {dt}"))
    return "\n".join(output)


@tool
def defeatbeta_earning_call(
    ticker: str,
    fiscal_year: Optional[int] = None,
    fiscal_quarter: Optional[int] = None,
    list_only: bool = False
) -> str:
    """
    Get comprehensive earnings call transcripts with speaker identification.

    Use for: detailed earnings transcripts, management remarks, Q&A sessions, historical calls.
    Modes: list_only=True (show available), or specify year/quarter for specific transcript.

    Args:
        ticker: Stock ticker (e.g., "AAPL")
        fiscal_year: Fiscal year (e.g., 2024) - optional
        fiscal_quarter: Fiscal quarter (1-4) - optional
        list_only: If True, list available transcripts (default: False)
    """
    try:
        if not DEFEATBETA_AVAILABLE:
            return "Error: Install defeatbeta-api with: pip install defeatbeta-api"

        ticker = ticker.upper()
        db_cache_key = f"defeatbeta:{ticker}:{fiscal_year}:{fiscal_quarter}:{list_only}"
        cached = _cache_get(db_cache_key, ttl=_CACHE_TTL_EARNING)
        if cached is not None:
            return cached

        import concurrent.futures as _cf
        t0_db = _time.time()
        try:
            with _cf.ThreadPoolExecutor(max_workers=1) as ex:
                future = ex.submit(lambda: DefeatBetaTicker(ticker).earning_call_transcripts())
                transcripts = future.result(timeout=30)  # 最多等 30 秒
        except _cf.TimeoutError:
            print(f"[TIMING] defeatbeta_earning_call({ticker}) 超时 (>30s)，跳过")
            return f"Earnings call transcript unavailable for {ticker} (timeout)."
        print(f"[TIMING] defeatbeta_earning_call({ticker}) 耗时 {_time.time()-t0_db:.2f}s")

        if list_only:
            t_list = transcripts.get_transcripts_list()
            if t_list is None or t_list.empty:
                return f"No transcripts for {ticker}"

            output = [
                format_header(f"📞 {ticker} Available Transcripts"),
                f"Total: {len(t_list)}\n",
                f"{'Year':>6} {'Quarter':>8} {'Report Date':<15}",
                "-" * 80
            ]
            for _, row in t_list.iterrows():
                output.append(f"{row['fiscal_year']:>6} {row['fiscal_quarter']:>8} {row['report_date']:<15}")

            output.append("\n💡 Example: defeatbeta_earning_call('TSLA', fiscal_year=2024, fiscal_quarter=4)")
            result = "\n".join(output)
            _cache_set(db_cache_key, result)
            return result

        # Get transcript
        if fiscal_year and fiscal_quarter:
            transcript_df = transcripts.get_transcript(fiscal_year, fiscal_quarter)
            title = f"FY{fiscal_year} Q{fiscal_quarter}"
        else:
            t_list = transcripts.get_transcripts_list()
            if t_list is None or t_list.empty:
                return f"No transcripts for {ticker}"

            latest = t_list.iloc[-1]
            fiscal_year, fiscal_quarter = latest['fiscal_year'], latest['fiscal_quarter']
            transcript_df = transcripts.get_transcript(fiscal_year, fiscal_quarter)
            title = f"Latest (FY{fiscal_year} Q{fiscal_quarter})"

        if transcript_df is None or transcript_df.empty:
            return f"No transcript for {ticker} FY{fiscal_year} Q{fiscal_quarter}"

        output = [
            format_header(f"📞 {ticker} Earnings Call"),
            f"Fiscal Period: {title}",
            f"Paragraphs: {len(transcript_df)}\n{'=' * 100}\n",
            "📄 TRANSCRIPT CONTENT\n" + "-" * 100
        ]

        current_speaker = None
        for _, row in transcript_df.iterrows():
            if row['speaker'] != current_speaker:
                output.append(f"\n🎤 {row['speaker']}\n{'-' * 100}")
                current_speaker = row['speaker']
            output.append(f"[{row['paragraph_number']}] {row['content']}\n")

        output.append(f"\n{'=' * 100}\nEnd of {ticker} FY{fiscal_year} Q{fiscal_quarter} Transcript")
        result = "\n".join(output)
        _cache_set(db_cache_key, result)
        return result

    except Exception as e:
        return f"Error: {str(e)}"
