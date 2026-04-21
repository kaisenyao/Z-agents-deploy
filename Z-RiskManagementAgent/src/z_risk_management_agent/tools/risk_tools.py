import yfinance as yf
from langchain_core.tools import tool
import numpy as np
from datetime import datetime, date, timedelta
from typing import List, Dict, Any, Optional, Union

import pandas as pd

import random

_HISTORICAL_DATA_CACHE: Dict[str, Dict[str, Any]] = {}

# --- Helper: Safe numeric extraction ---
def _safe_number(value: Any) -> Optional[float]:
    try:
        if value is None or (isinstance(value, float) and np.isnan(value)):
            return None
        return float(value)
    except Exception:
        return None

def _first_non_null(values: List[Optional[float]]) -> Optional[float]:
    for v in values:
        if v is not None:
            return v
    return None

def _get_balance_sheet_value(df: pd.DataFrame, keys: List[str]) -> Optional[float]:
    if df is None or df.empty:
        return None
    for key in keys:
        if key in df.index:
            series = df.loc[key]
            if isinstance(series, pd.Series) and not series.empty:
                return _safe_number(series.iloc[0])
    return None

# --- Tool 1: Real-World Data Fetching ---
@tool
def get_historical_market_data(ticker: str, start_date: str, end_date: Optional[str] = None) -> Dict[str, Any]:
    """
    Fetches historical daily market data for a given stock ticker using the yfinance library.
    It returns a structured list of dictionaries, each containing a date and the closing price.

    Args:
        ticker (str): The stock ticker symbol (e.g., "NVDA").
        start_date (str): Start date of historical data to retrieve.
        end_date (str):  End date of historical data to retrieve.

    Returns:
        Dict[str, Any]: A dictionary containing the ticker and a list of historical data points,
                        or an error message if the data could not be fetched.
    """
    
    try:
        start_dt = datetime.strptime(start_date, '%Y-%m-%d').date()
        end_dt = datetime.strptime(end_date, '%Y-%m-%d').date() if end_date else date.today()

        if end_dt < start_dt:
            return {"error": f"Invalid date range: start_date {start_dt} is after end_date {end_dt}."}

        # yfinance end date is exclusive; add 1 day so the end date is included.
        end_exclusive = end_dt + timedelta(days=1)

        # Download data from yfinance
        stock_data = yf.download(
            ticker,
            start=start_dt.isoformat(),
            end=end_exclusive.isoformat(),
            progress=False
        )
        
        if stock_data.empty:
            return {
                "error": (
                    f"No data returned for ticker {ticker} between {start_dt} and {end_dt}. "
                    "Check the ticker symbol, date range, or network access to Yahoo Finance."
                )
            }
        
        # Create the structured response
        # Safely extract 'Close' and 'Volume' regardless of yfinance MultiIndex changes
        close_col = stock_data["Close"]
        close_series = close_col.iloc[:, 0] if isinstance(close_col, pd.DataFrame) else close_col
        
        vol_col = stock_data["Volume"]
        vol_series = vol_col.iloc[:, 0] if isinstance(vol_col, pd.DataFrame) else vol_col

        historical_data = [
            {
                "date": dt.strftime('%Y-%m-%d'),
                "close_price": round(float(c), 2) if not pd.isna(c) else 0.0,
                "volume": int(v) if not pd.isna(v) else 0
            }
            for dt, c, v in zip(stock_data.index, close_series, vol_series)
        ]
        
        return {"ticker": ticker, "historical_data": historical_data}
    except Exception as e:
        return {"error": f"An error occurred while fetching data for {ticker}: {str(e)}"}


# --- Tool 2: Advanced Risk Metrics (Sharpe, Sortino, Volatility) ---
@tool
def calculate_comprehensive_risk_metrics(historical_data: List[Dict[str, Any]], risk_free_rate: float = 0.04) -> Dict[str, Any]:
    """
    Calculates annualized volatility, max drawdown, Sharpe Ratio, and Sortino Ratio.

    Args:
        historical_data (List[Dict[str, Any]]): List containing 'date' and 'close_price'.
        risk_free_rate (float): Annual risk-free rate (default 0.04 for 4%).

    Returns:
        Dict[str, Any]: Risk metrics including Volatility, Max Drawdown, Sharpe, and Sortino.
    """
    if len(historical_data) < 2:
        return {"error": "Not enough data."}
    
    prices = np.array([item['close_price'] for item in historical_data])
    returns = np.diff(np.log(prices)) # Log returns
    
    # 1. Annualized Volatility
    ann_volatility = np.std(returns) * np.sqrt(252)
    
    # 2. Max Drawdown
    cumulative_returns = np.exp(np.cumsum(returns))
    peak = np.maximum.accumulate(cumulative_returns)
    drawdown = (cumulative_returns - peak) / peak
    max_drawdown = np.min(drawdown)
    
    # 3. Sharpe Ratio (Returns / Total Risk)
    # Approx daily risk free return
    daily_rf = risk_free_rate / 252
    excess_returns = returns - daily_rf
    sharpe_ratio = (np.mean(excess_returns) / np.std(returns)) * np.sqrt(252) if np.std(returns) > 0 else 0
    
    # 4. Sortino Ratio (Returns / Downside Risk only)
    downside_returns = returns[returns < 0]
    downside_deviation = np.std(downside_returns) * np.sqrt(252)
    sortino_ratio = (np.mean(excess_returns) * 252) / downside_deviation if downside_deviation > 0 else 0

    return {
        "annualized_volatility_pct": round(ann_volatility * 100, 2),
        "max_drawdown_pct": round(max_drawdown * 100, 2),
        "sharpe_ratio": round(sharpe_ratio, 2),
        "sortino_ratio": round(sortino_ratio, 2)
    }

# --- Tool 3: Value at Risk (VaR) & CVaR ---
@tool
def calculate_var_cvar(historical_data: List[Dict[str, Any]], confidence_level: float = 0.95) -> Dict[str, Any]:
    """
    Calculates Value at Risk (VaR) and Conditional VaR (CVaR/Expected Shortfall).
    
    Args:
        historical_data (List[Dict[str, Any]]): Stock history.
        confidence_level (float): Confidence level (e.g., 0.95 for 95%).
    
    Returns:
        Dict: VaR and CVaR metrics.
    """
    if len(historical_data) < 2:
        return {"error": "Insufficient data."}

    try:
        confidence = float(confidence_level)
    except (TypeError, ValueError):
        confidence = 0.95
    # Keep confidence strictly inside (0, 1) to avoid edge-case indexing.
    confidence = min(max(confidence, 0.01), 0.9999)

    # Keep only finite, positive prices to avoid invalid returns.
    cleaned_prices = [
        _safe_number(item.get("close_price"))
        for item in historical_data
        if isinstance(item, dict)
    ]
    prices = np.array(
        [p for p in cleaned_prices if p is not None and np.isfinite(p) and p > 0],
        dtype=float
    )

    if len(prices) < 2:
        return {"error": "Insufficient valid price points to compute VaR/CVaR."}
    
    returns = prices[1:] / prices[:-1] - 1
    
    returns = returns[np.isfinite(returns)]
    if len(returns) == 0:
        return {"error": "No valid returns could be computed from price history."}

    # Use at least one tail sample so CVaR never computes mean([]) -> NaN.
    
    sorted_returns = np.sort(returns)
    tail_count = max(1, int(np.ceil((1 - confidence) * len(sorted_returns))))
    tail_losses = sorted_returns[:tail_count]

    var_percent = abs(sorted_returns[tail_count - 1])
    cvar_percent = abs(np.mean(tail_losses))

    # Safety backup for unexpected numeric instability.
    if not np.isfinite(var_percent):
        var_percent = 0.0
    if not np.isfinite(cvar_percent):
        cvar_percent = var_percent

    current_price = prices[-1] if np.isfinite(prices[-1]) else 0.0
    
    return {
        "confidence_level": confidence,
        "VaR_percentage": round(var_percent * 100, 2),
        "CVaR_percentage": round(cvar_percent * 100, 2),
        "VaR_absolute_amount": round(current_price * var_percent, 2),
        "CVaR_absolute_amount": round(current_price * cvar_percent, 2)
    }

# @tool
# def search_market_news(ticker: str, limit: int = 5) -> Dict[str, Any]:
#     """
#     Fetches the latest news headlines and summaries for a stock ticker.
#     This allows the Agent to infer qualitative risks (regulatory, geopolitical, etc.)
#     based on real-time events rather than hardcoded lists.

#     Args:
#         ticker (str): The stock ticker (e.g., "TSLA").
#         limit (int): Number of news items to return.

#     Returns:
#         Dict[str, Any]: A list of news items with title, publisher, and link.
#     """
#     try:
#         # yfinance has a .news attribute that fetches recent stories
#         stock = yf.Ticker(ticker)
#         news_items = stock.news
        
#         if not news_items:
#             return {"message": f"No recent news found for {ticker}."}
        
#         formatted_news = []
#         for item in news_items[:limit]:
#             # Published timestamp conversion
#             pub_time = datetime.fromtimestamp(item.get('providerPublishTime', 0)).strftime('%Y-%m-%d')
#             formatted_news.append({
#                 "title": item.get('title'),
#                 "publisher": item.get('publisher'),
#                 "date": pub_time,
#                 "link": item.get('link')
#             })
            
#         return {
#             "ticker": ticker,
#             "latest_news": formatted_news,
#             "instruction": "Use these headlines to infer qualitative risks (e.g. 'Lawsuit', 'Recall', 'Rates')."
#         }
#     except Exception as e:
#         return {"error": f"Failed to fetch news: {str(e)}"}

@tool
def calculate_correlation_matrix(tickers: List[str], period: str = "1y") -> Dict[str, Any]:
    """
    Calculates the correlation matrix for a list of tickers given the portfolio. 
    High correlation (>0.8) implies lower diversification benefits.

    Args:
        tickers (List[str]): List of ticker symbols (e.g., ["AAPL", "MSFT", "GOOG"]).
        period (str): Historical period.

    Returns:
        Dict[str, Any]: A text representation or dict of the correlation matrix.
    """
    if len(tickers) < 2:
        return {"error": "Need at least two tickers to calculate correlation."}
    
    try:
        data = yf.download(tickers, period=period)['Close']
        
        if data.empty:
            return {"error": "Could not fetch data for tickers."}
            
        # Calculate log returns
        returns = np.log(data / data.shift(1)).dropna()
        
        # Correlation matrix
        corr_matrix = returns.corr()
        
        # Convert to dictionary for JSON serialization
        corr_dict = corr_matrix.round(2).to_dict()
        
        return {
            "tickers": tickers,
            "correlation_matrix": corr_dict,
            "interpretation": "Values close to 1.0 mean assets move together. Values close to 0 or negative imply diversification."
        }
    except Exception as e:
        return {"error": f"Correlation calculation failed: {str(e)}"}

@tool
def calculate_rsi(historical_data: List[Dict[str, Any]], window: int = 14) -> Dict[str, Any]:
    """
    Calculates the Relative Strength Index (RSI).
    RSI > 70 indicates 'Overbought' (Risk of pullback).
    RSI < 30 indicates 'Oversold'.

    Args:
        historical_data (List[Dict[str, Any]]): Historical price data.
        window (int): Period for RSI (default 14).

    Returns:
        Dict[str, Any]: Current RSI value and interpretation.
    """
    if len(historical_data) < window + 1:
        return {"error": "Not enough data for RSI."}

    prices = pd.Series([item['close_price'] for item in historical_data])
    delta = prices.diff()
    
    gain = (delta.where(delta > 0, 0)).rolling(window=window).mean()
    loss = (-delta.where(delta < 0, 0)).rolling(window=window).mean()
    
    rs = gain / loss
    rsi = 100 - (100 / (1 + rs))
    
    current_rsi = round(rsi.iloc[-1], 2)
    
    state = "Neutral"
    if current_rsi > 70:
        state = "Overbought (High Risk of Reversal)"
    elif current_rsi < 30:
        state = "Oversold"

    return {"current_rsi": current_rsi, "technical_risk_state": state}

@tool
def calculate_liquidity_risk(historical_data: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Analyzes liquidity risk by calculating Average Daily Volume (ADV) and Dollar Volume.
    Low liquidity implies higher slippage risk and difficulty exiting positions.

    Args:
        historical_data (List[Dict[str, Any]]): Historical data containing 'close_price' and 'volume'.

    Returns:
        Dict[str, Any]: Liquidity metrics including ADV and Avg Dollar Volume.
    """
    if not historical_data:
        return {"error": "No data provided."}

    volumes = [d.get('volume', 0) for d in historical_data]
    prices = [d.get('close_price', 0) for d in historical_data]

    if not volumes or sum(volumes) == 0:
        return {"warning": "No volume data available for liquidity analysis."}

    # Calculate Average Daily Volume (ADV) - typically 20-30 days is standard, using full provided range here
    avg_volume = np.mean(volumes)
    
    # Calculate Average Dollar Volume (Price * Volume)
    dollar_volumes = [p * v for p, v in zip(prices, volumes)]
    avg_dollar_volume = np.mean(dollar_volumes)

    liquidity_rating = "High"
    if avg_dollar_volume < 1_000_000:
        liquidity_rating = "Low (High Slippage Risk)"
    elif avg_dollar_volume < 10_000_000:
        liquidity_rating = "Medium"

    return {
        "average_daily_volume": round(avg_volume, 0),
        "average_daily_dollar_volume": round(avg_dollar_volume, 2),
        "liquidity_rating": liquidity_rating,
        "interpretation": "Low liquidity increases the cost of entering/exiting positions and risk of slippage."
    }

@tool
def perform_monte_carlo_simulation(historical_data: List[Dict[str, Any]], n_simulations: int = 1000, time_horizon: int = 30) -> Dict[str, Any]:
    """
    Performs a Monte Carlo simulation to forecast potential future price paths and estimate VaR.
    
    Args:
        historical_data (List[Dict[str, Any]]): Historical price data.
        n_simulations (int): Number of simulation runs (default 1000).
        time_horizon (int): Days to simulate into the future (default 30).

    Returns:
        Dict[str, Any]: Simulation results including 5th percentile worst case (VaR).
    """
    if len(historical_data) < 30:
        return {"error": "Insufficient data for simulation."}

    prices = np.array([d['close_price'] for d in historical_data])
    log_returns = np.diff(np.log(prices))
    
    # Calculate drift and volatility
    mean_daily_return = np.mean(log_returns)
    daily_volatility = np.std(log_returns)
    
    last_price = prices[-1]
    
    # Simulation: Price_t = Price_{t-1} * exp(drift + vol * Z)
    # drift = mean - 0.5 * vol^2
    drift = mean_daily_return - 0.5 * daily_volatility**2
    
    # Generate random Z scores for all simulations and days at once
    z_scores = np.random.normal(0, 1, (time_horizon, n_simulations))
    
    # Calculate daily returns for all paths
    daily_returns = np.exp(drift + daily_volatility * z_scores)
    
    # Accumulate returns to get price paths
    price_paths = np.zeros((time_horizon, n_simulations))
    price_paths[0] = last_price * daily_returns[0]
    
    for t in range(1, time_horizon):
        price_paths[t] = price_paths[t-1] * daily_returns[t]
        
    # Analyze terminal prices (prices at the end of the horizon)
    terminal_prices = price_paths[-1]
    
    expected_price = np.mean(terminal_prices)
    worst_case_5pct = np.percentile(terminal_prices, 5) # 95% Confidence VaR equivalent
    best_case_95pct = np.percentile(terminal_prices, 95)
    
    downside_risk_pct = (worst_case_5pct - last_price) / last_price
    
    return {
        "simulation_parameters": {
            "n_simulations": n_simulations,
            "time_horizon_days": time_horizon,
            "current_price": last_price
        },
        "results": {
            "expected_price_mean": round(expected_price, 2),
            "worst_case_price_5th_percentile": round(worst_case_5pct, 2),
            "best_case_price_95th_percentile": round(best_case_95pct, 2),
            "projected_downside_risk_pct": round(downside_risk_pct * 100, 2)
        },
        "interpretation": f"Based on {n_simulations} simulations, there is a 5% chance the price will fall below {round(worst_case_5pct, 2)} in {time_horizon} days."
    }


# --- Tool 6: Beta Calculation ---
@tool
def calculate_beta(historical_data: List[Dict[str, Any]], start_date: str, end_date: Optional[str] = None, benchmark_ticker: str = "^GSPC") -> Dict[str, Union[float, str]]:
    """
    Calculates the beta of a stock against a market benchmark (default: S&P 500).
    Beta measures the volatility of a stock in relation to the overall market.

    Args:
        historical_data (List[Dict[str, Any]]): A list of dictionaries with 'date' and 'close_price' for the stock.
        start_date (str): The start date for the analysis period (YYYY-MM-DD).
        end_date (Optional[str]): The end date for the analysis period (YYYY-MM-DD). Defaults to today.
        benchmark_ticker (str): The ticker for the market benchmark. Defaults to '^GSPC' for S&P 500.

    Returns:
        Dict[str, Union[float, str]]: A dictionary containing the calculated beta or an error message.
    """
    if len(historical_data) < 30: # Need at least ~30 data points for a meaningful beta
        return {"error": "Not enough historical data to calculate beta. At least 30 data points are recommended."}

    try:
        # 1. Prepare stock data
        stock_df = pd.DataFrame(historical_data)
        stock_df['date'] = pd.to_datetime(stock_df['date'])
        stock_df = stock_df.set_index('date')
        stock_df.rename(columns={'close_price': 'stock'}, inplace=True)

        # 2. Fetch benchmark data
        parsed_end_date = datetime.strptime(end_date, '%Y-%m-%d').date() if end_date else date.today()
        benchmark_data = yf.download(benchmark_ticker, start=start_date, end=parsed_end_date, progress=False)

        if benchmark_data.empty:
            return {"error": f"Could not fetch benchmark data for '{benchmark_ticker}'."}

        benchmark_df = benchmark_data[['Close']].rename(columns={'Close': 'benchmark'})

        # 3. Combine and calculate returns
        combined_df = stock_df.join(benchmark_df, how='inner')

        if len(combined_df) < 2:
            return {"error": "Date range mismatch or insufficient overlapping data between stock and benchmark."}

        returns = combined_df.pct_change().dropna()

        # 4. Calculate Beta
        covariance_matrix = returns.cov()
        covariance = covariance_matrix.loc['stock', 'benchmark']
        variance = returns['benchmark'].var()

        beta = covariance / variance

        return {"beta": round(beta, 2)}
    except Exception as e:
        return {"error": f"An error occurred during beta calculation: {str(e)}"}

# --- Tool 7: Fundamentals & Valuation Metrics ---
@tool
def get_fundamental_valuation_metrics(ticker: str) -> Dict[str, Any]:
    """
    Fetches key valuation and balance sheet metrics for a given stock ticker.
    Includes Market Cap, Net Debt, EV, P/E (trailing/forward), P/S, EV/EBITDA,
    P/Book, and P/Tangible Book Value, plus short interest fields when available.

    Args:
        ticker (str): Stock ticker symbol (e.g., "AAPL")

    Returns:
        Dict[str, Any]: Valuation and short interest metrics, with None for missing data.
    """
    try:
        stock = yf.Ticker(ticker)
        info = stock.info or {}

        market_cap = _safe_number(info.get("marketCap"))
        total_debt = _safe_number(info.get("totalDebt"))
        total_cash = _safe_number(info.get("totalCash"))
        net_debt = None
        if total_debt is not None and total_cash is not None:
            net_debt = total_debt - total_cash

        enterprise_value = _safe_number(info.get("enterpriseValue"))
        ev_source = "yfinance"
        if enterprise_value is None and market_cap is not None and total_debt is not None and total_cash is not None:
            enterprise_value = market_cap + total_debt - total_cash
            ev_source = "derived_market_cap_plus_net_debt"

        trailing_pe = _safe_number(info.get("trailingPE"))
        forward_pe = _safe_number(info.get("forwardPE"))
        price_to_sales = _safe_number(info.get("priceToSalesTrailing12Months"))
        if price_to_sales is None:
            price_to_sales = _safe_number(info.get("priceToSales"))

        ev_to_ebitda = _safe_number(info.get("enterpriseToEbitda"))
        if ev_to_ebitda is None:
            ebitda = _safe_number(info.get("ebitda"))
            if enterprise_value is not None and ebitda:
                ev_to_ebitda = enterprise_value / ebitda

        price_to_book = _safe_number(info.get("priceToBook"))

        shares_outstanding = _safe_number(info.get("sharesOutstanding"))
        current_price = _safe_number(info.get("currentPrice")) or _safe_number(info.get("regularMarketPrice"))

        # Tangible Book Value per Share (TBVPS)
        balance_sheet = stock.balance_sheet
        equity = _get_balance_sheet_value(balance_sheet, [
            "Total Stockholder Equity",
            "Total Equity Gross Minority Interest",
            "Stockholders Equity",
            "Total Equity"
        ])
        goodwill = _get_balance_sheet_value(balance_sheet, ["Goodwill", "Good Will"])
        intangibles = _get_balance_sheet_value(balance_sheet, ["Intangible Assets", "Intangible Assets Excluding Goodwill"])

        if goodwill is None:
            goodwill = 0.0
        if intangibles is None:
            intangibles = 0.0

        tangible_equity = None
        if equity is not None:
            tangible_equity = equity - goodwill - intangibles

        tangible_book_value_per_share = None
        if tangible_equity is not None and shares_outstanding:
            tangible_book_value_per_share = tangible_equity / shares_outstanding

        price_to_tangible_book = None
        if current_price is not None and tangible_book_value_per_share and tangible_book_value_per_share != 0:
            price_to_tangible_book = current_price / tangible_book_value_per_share

        # Short interest fields (availability varies by ticker)
        short_interest = {
            "shares_short": _safe_number(info.get("sharesShort")),
            "shares_short_prior_month": _safe_number(info.get("sharesShortPriorMonth")),
            "short_ratio_days_to_cover": _safe_number(info.get("shortRatio")),
            "short_percent_of_float": _safe_number(info.get("shortPercentOfFloat"))
        }

        return {
            "ticker": ticker.upper(),
            "market_cap": market_cap,
            "total_debt": total_debt,
            "total_cash": total_cash,
            "net_debt": net_debt,
            "enterprise_value": enterprise_value,
            "enterprise_value_source": ev_source,
            "trailing_pe": trailing_pe,
            "forward_pe": forward_pe,
            "price_to_sales": price_to_sales,
            "ev_to_ebitda": ev_to_ebitda,
            "price_to_book": price_to_book,
            "tangible_book_value_per_share": tangible_book_value_per_share,
            "price_to_tangible_book": price_to_tangible_book,
            "short_interest": short_interest
        }
    except Exception as e:
        return {"error": f"Failed to fetch valuation metrics for {ticker}: {str(e)}"}

# --- Tool 8: Realized Volatility Windows ---
@tool
def calculate_realized_volatility_windows(
    historical_data: List[Dict[str, Any]],
    windows: List[int] = [30, 90, 252]
) -> Dict[str, Any]:
    """
    Calculates annualized realized volatility for multiple rolling windows.

    Args:
        historical_data (List[Dict[str, Any]]): List containing 'date' and 'close_price'.
        windows (List[int]): Window sizes in trading days (default 30, 90, 252).

    Returns:
        Dict[str, Any]: Annualized volatility percentages for each window.
    """
    if len(historical_data) < 2:
        return {"error": "Not enough data."}

    prices = np.array([item['close_price'] for item in historical_data])
    returns = np.diff(np.log(prices))

    vol_by_window: Dict[str, Optional[float]] = {}
    for window in windows:
        if len(returns) < window:
            vol_by_window[f"{window}d"] = None
            continue
        window_returns = returns[-window:]
        ann_vol = np.std(window_returns) * np.sqrt(252)
        vol_by_window[f"{window}d"] = round(ann_vol * 100, 2)

    return {
        "annualized_volatility_pct": vol_by_window,
        "method": "Annualized std dev of daily log returns"
    }