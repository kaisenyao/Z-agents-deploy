from langchain_core.tools import tool
import pandas as pd
import numpy as np
import re
import time
from alpha_vantage.timeseries import TimeSeries
from alpha_vantage.techindicators import TechIndicators
import yfinance as yf
import os
from typing import Optional, List, Dict, Any
import base64

# Replace with your Alpha Vantage API key
ALPHA_VANTAGE_API_KEY = "RAIPR2JG878LGO1I"


@tool
def get_ohlcv_daily(
    symbol: str,
    start_date: str | None = None,
    end_date: str | None = None
) -> dict:
    """
    Fetch daily OHLCV for `symbol` from Alpha Vantage using the
    TIME_SERIES_DAILY_ADJUSTED endpoint.

    Behavior:
    - If end_date is not provided, defaults to the latest available trading date.
    - If start_date is not provided, defaults to 1 year before the resolved end_date.

    Args:
        symbol: Ticker symbol, e.g. "AAPL"
        start_date: Start date in YYYY-MM-DD format, optional
        end_date: End date in YYYY-MM-DD format, optional. Can also be "latest" or "now".

    Returns:
        dict with symbol, date range, row count, OHLCV records, and summary.
    """
    try:
        import pandas as pd
        import requests

        if not symbol or not isinstance(symbol, str):
            return {"error": "symbol must be a non-empty string."}

        url = "https://www.alphavantage.co/query"
        params = {
            "function": "TIME_SERIES_DAILY_ADJUSTED",
            "symbol": symbol.upper(),
            "outputsize": "full",
            "entitlement": "delayed",
            "apikey": ALPHA_VANTAGE_API_KEY,
            "datatype": "json",
        }

        r = requests.get(url, params=params, timeout=30)
        r.raise_for_status()
        j = r.json()

        if "Error Message" in j:
            return {"error": j["Error Message"]}
        if "Note" in j:
            return {"error": j["Note"]}
        if "Information" in j:
            return {"error": j["Information"]}
        if "Time Series (Daily)" not in j:
            return {"error": f"Unexpected Alpha Vantage response: {list(j.keys())}"}

        raw = pd.DataFrame.from_dict(j["Time Series (Daily)"], orient="index")
        raw.index = pd.to_datetime(raw.index, errors="coerce")
        raw = raw[raw.index.notna()].sort_index()

        if raw.empty:
            return {"error": f"No Alpha Vantage daily data returned for {symbol.upper()}."}

        col_map = {
            "1. open": "open",
            "2. high": "high",
            "3. low": "low",
            "4. close": "close",
            "6. volume": "volume",
        }

        missing = [c for c in col_map if c not in raw.columns]
        if missing:
            return {"error": f"Missing expected columns: {missing}"}

        for c in col_map:
            raw[c] = pd.to_numeric(raw[c], errors="coerce")

        latest_available = raw.index.max()

        # Resolve end date
        if end_date is None or str(end_date).strip() == "" or str(end_date).lower() in ["latest", "now"]:
            ed = latest_available
        else:
            ed = pd.to_datetime(end_date, errors="coerce")
            if pd.isna(ed):
                return {"error": "Invalid end_date. Use YYYY-MM-DD, 'latest', or 'now'."}
            ed = min(ed, latest_available)

        # Resolve start date
        if start_date is None or str(start_date).strip() == "":
            sd = ed - pd.Timedelta(days=365)
        else:
            sd = pd.to_datetime(start_date, errors="coerce")
            if pd.isna(sd):
                return {"error": "Invalid start_date. Use YYYY-MM-DD."}

        if sd > ed:
            return {"error": "start_date must be <= end_date."}

        df = raw.loc[(raw.index >= sd) & (raw.index <= ed)].dropna(subset=["4. close"])

        if df.empty:
            return {
                "error": f"No data for {symbol.upper()} between "
                         f"{sd.strftime('%Y-%m-%d')} and {ed.strftime('%Y-%m-%d')}."
            }

        records = [
            {
                "date": dt.strftime("%Y-%m-%d"),
                "open": float(row["1. open"]) if pd.notna(row["1. open"]) else None,
                "high": float(row["2. high"]) if pd.notna(row["2. high"]) else None,
                "low": float(row["3. low"]) if pd.notna(row["3. low"]) else None,
                "close": float(row["4. close"]) if pd.notna(row["4. close"]) else None,
                "volume": int(row["6. volume"]) if pd.notna(row["6. volume"]) else None,
            }
            for dt, row in df.iterrows()
        ]

        return {
            "symbol": symbol.upper(),
            "data_source": "Alpha Vantage",
            "start_date": sd.strftime("%Y-%m-%d"),
            "end_date": ed.strftime("%Y-%m-%d"),
            "n_rows": len(records),
            "columns": ["open", "high", "low", "close", "volume"],
            "data": records,
            "summary": {
                "first_date": df.index.min().strftime("%Y-%m-%d"),
                "last_date": df.index.max().strftime("%Y-%m-%d"),
                "last_close": float(df["4. close"].iloc[-1]),
            },
        }

    except Exception as e:
        return {"error": f"get_ohlcv_daily error: {str(e)}"}


# ------------------------------------------------------------
# Technical Indicators (SMA, RSI, Bollinger)
# ------------------------------------------------------------

from typing import Optional
import pandas as pd
import numpy as np
from langchain_core.tools import tool


@tool
def compute_indicators_from_ohlcv(
    symbol: str,
    indicators: list[str],
    ohlcv_rows: Optional[list[dict]] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    params: Optional[dict] = None,
    series_tail: int = 30
) -> dict:
    """
    Compute technical indicators locally from OHLCV rows.

    Args:
        ohlcv_rows: List of rows like:
          [{"date":"YYYY-MM-DD","open":...,"high":...,"low":...,"close":...,"volume":...}, ...]
        indicators: List of indicator names. Supported:
          SMA, EMA, RSI, MACD, BOLLINGER, ATR, OBV, RETURNS, VOLATILITY, DRAWDOWN
        params: Optional parameters for indicators.
        series_tail: Include last N values per series.

    Returns:
        dict with latest values + series tails.
    """
    try:
        params = params or {}

        if not symbol or not isinstance(symbol, str):
            return {"error": "symbol must be a non-empty string."}

        if ohlcv_rows is None:
            data_result = get_ohlcv_daily.invoke({
                "symbol": symbol,
                "start_date": start_date,
                "end_date": end_date
            })

            if not isinstance(data_result, dict):
                return {"error": "Unexpected response from get_ohlcv_daily."}
            if "error" in data_result:
                return {"error": f"Data fetch failed: {data_result['error']}"}

            ohlcv_rows = data_result.get("data", [])

        if not isinstance(ohlcv_rows, list) or len(ohlcv_rows) < 5:
            return {"error": "ohlcv_rows must be a list of rows (>=5)."}

        if not indicators or not isinstance(indicators, list):
            return {"error": "indicators must be a non-empty list."}

        series_tail = int(series_tail)
        if series_tail <= 0:
            series_tail = 30
        series_tail = min(series_tail, 252)

        supported = {
            "SMA", "EMA", "RSI", "MACD", "BOLLINGER",
            "ATR", "OBV", "RETURNS", "VOLATILITY", "DRAWDOWN"
        }
        requested = [x.upper() for x in indicators]
        invalid = [x for x in requested if x not in supported]
        if invalid:
            return {
                "error": f"Unsupported indicators: {invalid}. Supported: {sorted(supported)}"
            }

        df = pd.DataFrame(ohlcv_rows).copy()

        required = {"date", "open", "high", "low", "close", "volume"}
        if not required.issubset(df.columns):
            return {"error": f"Each row must include {sorted(required)}"}

        df["date"] = pd.to_datetime(df["date"], errors="coerce")
        df = df.dropna(subset=["date"]).sort_values("date").reset_index(drop=True)

        for c in ["open", "high", "low", "close", "volume"]:
            df[c] = pd.to_numeric(df[c], errors="coerce")

        df = df.dropna(subset=["close", "high", "low"])
        if df.empty:
            return {"error": "No valid OHLCV rows after cleaning."}

        out_latest = {}
        out_series = {}

        def tail_series(name: str, s: pd.Series):
            s2 = s.dropna()
            if s2.empty:
                return
            tail = s2.tail(series_tail)
            out_series[name] = [
                {
                    "date": df.loc[i, "date"].strftime("%Y-%m-%d"),
                    "value": float(v)
                }
                for i, v in zip(tail.index, tail.values)
            ]

        # SMA
        if "SMA" in requested:
            periods = params.get("SMA", {}).get("periods", [20, 50, 200])
            sma_latest = {}
            for p in periods:
                p = int(p)
                sma = df["close"].rolling(p).mean()
                key = f"SMA_{p}"
                sma_latest[key] = float(sma.iloc[-1]) if pd.notna(sma.iloc[-1]) else None
                tail_series(key, sma)
            out_latest["SMA"] = sma_latest

        # EMA
        if "EMA" in requested:
            periods = params.get("EMA", {}).get("periods", [20, 50])
            ema_latest = {}
            for p in periods:
                p = int(p)
                ema = df["close"].ewm(span=p, adjust=False).mean()
                key = f"EMA_{p}"
                ema_latest[key] = float(ema.iloc[-1]) if pd.notna(ema.iloc[-1]) else None
                tail_series(key, ema)
            out_latest["EMA"] = ema_latest

        # RSI
        if "RSI" in requested:
            period = int(params.get("RSI", {}).get("period", 14))
            delta = df["close"].diff()
            gain = delta.clip(lower=0)
            loss = -delta.clip(upper=0)
            alpha = 1.0 / period
            avg_gain = gain.ewm(alpha=alpha, adjust=False, min_periods=period).mean()
            avg_loss = loss.ewm(alpha=alpha, adjust=False, min_periods=period).mean()
            rs = avg_gain / (avg_loss + 1e-12)
            rsi = 100 - (100 / (1 + rs))
            out_latest["RSI"] = {
                f"RSI_{period}": float(rsi.iloc[-1]) if pd.notna(rsi.iloc[-1]) else None
            }
            tail_series(f"RSI_{period}", rsi)

        # MACD
        if "MACD" in requested:
            macd_p = params.get("MACD", {})
            fast = int(macd_p.get("fast", 12))
            slow = int(macd_p.get("slow", 26))
            signal = int(macd_p.get("signal", 9))
            ema_fast = df["close"].ewm(span=fast, adjust=False).mean()
            ema_slow = df["close"].ewm(span=slow, adjust=False).mean()
            macd_line = ema_fast - ema_slow
            signal_line = macd_line.ewm(span=signal, adjust=False).mean()
            hist = macd_line - signal_line
            out_latest["MACD"] = {
                "macd": float(macd_line.iloc[-1]) if pd.notna(macd_line.iloc[-1]) else None,
                "signal": float(signal_line.iloc[-1]) if pd.notna(signal_line.iloc[-1]) else None,
                "hist": float(hist.iloc[-1]) if pd.notna(hist.iloc[-1]) else None,
                "params": {"fast": fast, "slow": slow, "signal": signal},
            }
            tail_series("MACD_line", macd_line)
            tail_series("MACD_signal", signal_line)
            tail_series("MACD_hist", hist)

        # Bollinger
        if "BOLLINGER" in requested:
            bb_p = params.get("BOLLINGER", {})
            period = int(bb_p.get("period", 20))
            k = float(bb_p.get("std", 2.0))
            mid = df["close"].rolling(period).mean()
            sd = df["close"].rolling(period).std()
            upper = mid + k * sd
            lower = mid - k * sd
            out_latest["BOLLINGER"] = {
                "upper": float(upper.iloc[-1]) if pd.notna(upper.iloc[-1]) else None,
                "mid": float(mid.iloc[-1]) if pd.notna(mid.iloc[-1]) else None,
                "lower": float(lower.iloc[-1]) if pd.notna(lower.iloc[-1]) else None,
                "params": {"period": period, "std": k},
            }
            tail_series("BB_upper", upper)
            tail_series("BB_mid", mid)
            tail_series("BB_lower", lower)

        # ATR
        if "ATR" in requested:
            atr_p = params.get("ATR", {})
            period = int(atr_p.get("period", 14))
            prev_close = df["close"].shift(1)
            tr = pd.concat([
                (df["high"] - df["low"]),
                (df["high"] - prev_close).abs(),
                (df["low"] - prev_close).abs()
            ], axis=1).max(axis=1)
            atr = tr.ewm(alpha=1.0 / period, adjust=False, min_periods=period).mean()
            out_latest["ATR"] = {
                f"ATR_{period}": float(atr.iloc[-1]) if pd.notna(atr.iloc[-1]) else None
            }
            tail_series(f"ATR_{period}", atr)

        # OBV
        if "OBV" in requested:
            vol = df["volume"].fillna(0)
            direction = np.sign(df["close"].diff().fillna(0))
            obv = (direction * vol).cumsum()
            out_latest["OBV"] = {
                "OBV": float(obv.iloc[-1]) if pd.notna(obv.iloc[-1]) else None
            }
            tail_series("OBV", obv)

        rets = df["close"].pct_change()

        if "RETURNS" in requested:
            out_latest["RETURNS"] = {
                "last_daily_return": float(rets.iloc[-1]) if pd.notna(rets.iloc[-1]) else None
            }
            tail_series("daily_returns", rets)

        if "VOLATILITY" in requested:
            vol_ann = rets.dropna().std(ddof=1) * np.sqrt(252) if rets.dropna().shape[0] > 5 else np.nan
            out_latest["VOLATILITY"] = {
                "annualized_vol": float(vol_ann) if pd.notna(vol_ann) else None
            }

        if "DRAWDOWN" in requested:
            roll_max = df["close"].cummax()
            dd = (roll_max - df["close"]) / roll_max.replace(0, np.nan)
            out_latest["DRAWDOWN"] = {
                "max_drawdown": float(dd.max()) if pd.notna(dd.max()) else None
            }
            tail_series("drawdown", dd)

        return {
            "n_rows": int(df.shape[0]),
            "requested_indicators": requested,
            "params_used": params,
            "latest": out_latest,
            "series_tail": out_series,
        }

    except Exception as e:
        return {"error": f"compute_indicators_from_ohlcv error: {str(e)}"}
# ------------------------------------------------------------
# Backtesting (SMA_CROSS / RSI_MEANREV)
# ------------------------------------------------------------
from typing import Optional
import pandas as pd
import numpy as np
from langchain_core.tools import tool

@tool
def run_backtest(
    strategy: str,
    symbol: str,
    ohlcv_rows: Optional[list[dict]] = None,
    start_date: str | None = None,
    end_date: str | None = None
) -> dict:
    """
        Run a simple backtest using OHLCV data from get_ohlcv_daily.

        Supported strategies:
          - SMA_CROSS
          - RSI_MEANREV

        Behavior:
          - If end_date is not provided, defaults to latest available date.
          - If start_date is not provided, defaults to 1 year before end_date.

        Returns:
          Structured backtest summary including return, drawdown, volatility,
          Sharpe ratio, and a basic trend summary.
        """
    try:
        strategy = str(strategy).upper().strip()
        supported = {"SMA_CROSS", "RSI_MEANREV"}
        if strategy not in supported:
            return {
                "error": f"Unsupported strategy '{strategy}'. Supported: {sorted(supported)}"
            }

        resolved_start = start_date
        resolved_end = end_date

        if ohlcv_rows is None:
            data_result = get_ohlcv_daily.invoke({
                "symbol": symbol,
                "start_date": start_date,
                "end_date": end_date
            })

            if not isinstance(data_result, dict):
                return {"error": "Unexpected response from get_ohlcv_daily."}
            if "error" in data_result:
                return {"error": f"Data fetch failed: {data_result['error']}"}

            ohlcv_rows = data_result.get("data", [])
            resolved_start = data_result.get("start_date")
            resolved_end = data_result.get("end_date")

        if not isinstance(ohlcv_rows, list) or len(ohlcv_rows) < 20:
            return {"error": "ohlcv_rows must be a list with at least 20 observations."}

        df = pd.DataFrame(ohlcv_rows).copy()
        df["date"] = pd.to_datetime(df["date"], errors="coerce")
        df = df.dropna(subset=["date"]).sort_values("date").reset_index(drop=True)

        for c in ["open", "high", "low", "close", "volume"]:
            if c in df.columns:
                df[c] = pd.to_numeric(df[c], errors="coerce")

        df = df.dropna(subset=["close"])
        if df.empty:
            return {"error": f"No valid close data for {symbol.upper()}."}

        if resolved_start is None:
            resolved_start = df["date"].iloc[0].strftime("%Y-%m-%d")
        if resolved_end is None:
            resolved_end = df["date"].iloc[-1].strftime("%Y-%m-%d")

        df["Close"] = df["close"]
        strategy_params = {}

        if strategy == "SMA_CROSS":
            short_window, long_window = 20, 50
            strategy_params = {"short_window": short_window, "long_window": long_window}
            df["SMA_short"] = df["Close"].rolling(short_window).mean()
            df["SMA_long"] = df["Close"].rolling(long_window).mean()
            df["Signal"] = np.where(df["SMA_short"] > df["SMA_long"], 1.0, 0.0)

        elif strategy == "RSI_MEANREV":
            period = 14
            oversold = 30
            overbought = 70
            strategy_params = {
                "period": period,
                "oversold": oversold,
                "overbought": overbought
            }

            delta = df["Close"].diff()
            gain = delta.clip(lower=0)
            loss = -delta.clip(upper=0)
            alpha = 1.0 / period
            avg_gain = gain.ewm(alpha=alpha, adjust=False, min_periods=period).mean()
            avg_loss = loss.ewm(alpha=alpha, adjust=False, min_periods=period).mean()
            rs = avg_gain / (avg_loss + 1e-12)
            df["RSI"] = 100 - (100 / (1 + rs))

            df["Signal"] = 0.0
            df.loc[df["RSI"] < oversold, "Signal"] = 1.0
            df["Signal"] = df["Signal"].replace(0, np.nan).ffill().fillna(0.0)
            df.loc[df["RSI"] > overbought, "Signal"] = 0.0

        df["Position"] = df["Signal"].shift(1).fillna(0.0)
        df["Daily Return"] = df["Close"].pct_change()
        df["Strategy Return"] = df["Position"] * df["Daily Return"]
        df["Portfolio Value"] = (1 + df["Strategy Return"].fillna(0)).cumprod() * 100000.0

        initial_capital = 100000.0
        final_value = float(df["Portfolio Value"].iloc[-1])
        total_return = final_value - initial_capital
        total_return_pct = (final_value / initial_capital - 1.0) * 100.0

        strat_returns = df["Strategy Return"].dropna()
        daily_mean = strat_returns.mean() if not strat_returns.empty else np.nan
        daily_std = strat_returns.std(ddof=1) if strat_returns.shape[0] > 1 else np.nan

        vol_annual = float(daily_std * np.sqrt(252)) if pd.notna(daily_std) else None
        sharpe = (
            float(daily_mean / daily_std * np.sqrt(252))
            if pd.notna(daily_std) and daily_std > 0
            else None
        )

        portfolio_cummax = df["Portfolio Value"].cummax()
        drawdown_series = (portfolio_cummax - df["Portfolio Value"]) / portfolio_cummax.replace(0, np.nan)
        max_drawdown = float(drawdown_series.max() * 100.0) if drawdown_series.notna().any() else None

        sma20 = df["Close"].rolling(20).mean()
        sma50 = df["Close"].rolling(50).mean()
        latest_sma20 = sma20.iloc[-1] if len(sma20) else np.nan
        latest_sma50 = sma50.iloc[-1] if len(sma50) else np.nan
        end_close = float(df["Close"].iloc[-1])

        if pd.notna(latest_sma20) and pd.notna(latest_sma50):
            if end_close > latest_sma20 > latest_sma50:
                trend_summary = "uptrend"
            elif end_close < latest_sma20 < latest_sma50:
                trend_summary = "downtrend"
            else:
                trend_summary = "mixed / sideways"
        else:
            trend_summary = "insufficient history for trend classification"

        return {
            "symbol": symbol.upper(),
            "strategy": strategy,
            "strategy_params": strategy_params,
            "start_date": resolved_start,
            "end_date": resolved_end,
            "n_rows": int(df.shape[0]),
            "initial_capital": initial_capital,
            "final_portfolio_value": final_value,
            "metrics": {
                "total_return_dollar": round(total_return, 2),
                "total_return_pct": round(total_return_pct, 4),
                "max_drawdown_pct": round(max_drawdown, 4) if max_drawdown is not None else None,
                "annualized_volatility": round(vol_annual, 6) if vol_annual is not None else None,
                "sharpe_ratio": round(sharpe, 6) if sharpe is not None else None,
            },
            "trend_summary": trend_summary,
            "summary_text": (
                f"Backtest Report ({strategy}) on {symbol.upper()} "
                f"from {resolved_start} to {resolved_end}. "
                f"Total return: {total_return_pct:.2f}%, "
                f"Max drawdown: {max_drawdown:.2f}%."
                if max_drawdown is not None
                else f"Backtest Report ({strategy}) on {symbol.upper()} from {resolved_start} to {resolved_end}."
            )
        }

    except Exception as e:
        return {"error": f"run_backtest error: {str(e)}"}


# ------------------------------------------------------------
# Correlation Analysis (returns)
# ------------------------------------------------------------
from typing import Optional
import pandas as pd
import numpy as np
from langchain_core.tools import tool


@tool
def correlation_analysis(
    base_symbol: str,
    compare_symbols: list[str],
    base_ohlcv_rows: Optional[list[dict]] = None,
    compare_ohlcv_map: Optional[dict[str, list[dict]]] = None,
    start_date: str | None = None,
    end_date: str | None = None,
    top_pos_pairs: int = 5,
    top_neg_pairs: int = 5,
    use_adjusted_close: bool = False,
    include_base_in_pairs: bool = False,
    diversifier_threshold: float = 0.2,
) -> dict:
    """
    Structured correlation analysis using already-fetched OHLCV data.

    Args:
        base_symbol: Base ticker symbol, e.g. "AAPL".
        base_ohlcv_rows: OHLCV rows for the base symbol.
        compare_ohlcv_map: Dict mapping ticker -> OHLCV rows, e.g.
            {
              "MSFT": [...],
              "GLD": [...],
              "TLT": [...]
            }
        top_pos_pairs: Number of strongest positive-correlation pairs to return.
        top_neg_pairs: Number of strongest negative-correlation pairs to return.
        use_adjusted_close: Reserved for future use. Current OHLCV rows are assumed
            to contain only "close", so this is ignored unless your upstream tool
            later includes adjusted-close fields.
        include_base_in_pairs: Whether to include base-involving pairs in pair rankings.
        diversifier_threshold: Symbols with corr_vs_base below this are flagged as diversifiers.

    Returns:
        dict containing:
          - base_corr
          - top_positive_pairs
          - top_negative_pairs
          - diversifiers_vs_base
          - meta
    """
    try:
        base = str(base_symbol).upper().strip()
        if not base:
            return {"error": "base_symbol must be a non-empty string."}

        compare_symbols = [str(s).upper().strip() for s in compare_symbols if str(s).strip()]
        compare_symbols = [s for s in compare_symbols if s != base]

        if base_ohlcv_rows is None:
            base_result = get_ohlcv_daily.invoke({
                "symbol": base,
                "start_date": start_date,
                "end_date": end_date
            })
            if not isinstance(base_result, dict):
                return {"error": "Unexpected response from get_ohlcv_daily for base symbol."}
            if "error" in base_result:
                return {"error": f"Base data fetch failed: {base_result['error']}"}
            base_ohlcv_rows = base_result.get("data", [])

        if compare_ohlcv_map is None:
            compare_ohlcv_map = {}

        for sym in compare_symbols:
            if sym not in compare_ohlcv_map or compare_ohlcv_map[sym] is None:
                cmp_result = get_ohlcv_daily.invoke({
                    "symbol": sym,
                    "start_date": start_date,
                    "end_date": end_date
                })
                if isinstance(cmp_result, dict) and "error" not in cmp_result:
                    compare_ohlcv_map[sym] = cmp_result.get("data", [])

        if not isinstance(base_ohlcv_rows, list) or len(base_ohlcv_rows) < 2:
            return {"error": "base_ohlcv_rows must be a non-empty list with at least 2 rows."}
        if not isinstance(compare_ohlcv_map, dict) or not compare_ohlcv_map:
            return {"error": "compare_ohlcv_map must be a non-empty dict of symbol -> OHLCV rows."}

        top_pos_pairs = max(0, int(top_pos_pairs))
        top_neg_pairs = max(0, int(top_neg_pairs))
        diversifier_threshold = float(diversifier_threshold)

        def rows_to_close_series(rows: list[dict], symbol: str) -> Optional[pd.Series]:
            if not isinstance(rows, list) or len(rows) == 0:
                return None

            df = pd.DataFrame(rows).copy()
            required = {"date", "close"}
            if not required.issubset(df.columns):
                return None

            df["date"] = pd.to_datetime(df["date"], errors="coerce")
            df["close"] = pd.to_numeric(df["close"], errors="coerce")
            df = df.dropna(subset=["date", "close"]).sort_values("date")

            if df.empty:
                return None

            s = pd.Series(df["close"].values, index=df["date"], name=symbol)
            s = s[~s.index.duplicated(keep="last")]
            return s

        prices = {}

        base_series = rows_to_close_series(base_ohlcv_rows, base)
        if base_series is None or base_series.empty:
            return {"error": f"No valid close data for base symbol {base}."}
        prices[base] = base_series

        valid_compare_symbols = []
        for sym, rows in compare_ohlcv_map.items():
            sym_u = str(sym).upper().strip()
            if not sym_u or sym_u == base:
                continue
            s = rows_to_close_series(rows, sym_u)
            if s is not None and not s.empty:
                prices[sym_u] = s
                valid_compare_symbols.append(sym_u)

        if len(prices) < 2:
            return {"error": "Need at least one valid comparison symbol with usable price history."}

        data = pd.DataFrame(prices).sort_index()
        if base not in data.columns:
            return {"error": f"No aligned data for base symbol {base}."}

        # Daily returns; no implicit fill
        rets = data.pct_change(fill_method=None)

        # Each symbol vs base
        rets_base_ok = rets.dropna(subset=[base])
        if rets_base_ok.empty:
            return {"error": f"Insufficient return history for base symbol {base}."}

        corr_full = rets_base_ok.corr()
        if base not in corr_full.columns:
            return {"error": f"Could not compute correlations for base symbol {base}."}

        base_corr_ser = (
            corr_full[base]
            .drop(labels=[base], errors="ignore")
            .dropna()
            .sort_values(ascending=False)
        )
        base_corr = {k: float(v) for k, v in base_corr_ser.items()}

        diversifiers_vs_base = [
            {"symbol": sym, "corr_vs_base": float(val)}
            for sym, val in base_corr.items()
            if float(val) < diversifier_threshold
        ]

        # Pairwise correlations
        corr_mat = rets.corr()
        cols = list(corr_mat.columns)

        pairs = []
        for i in range(len(cols)):
            for j in range(i + 1, len(cols)):
                a, b = cols[i], cols[j]

                if not include_base_in_pairs and (a == base or b == base):
                    continue

                val = corr_mat.loc[a, b]
                if pd.notna(val):
                    n = int(rets[[a, b]].dropna().shape[0])
                    pairs.append({
                        "a": a,
                        "b": b,
                        "corr": float(val),
                        "n": n
                    })

        top_positive_pairs = sorted(pairs, key=lambda x: x["corr"], reverse=True)[:top_pos_pairs]
        top_negative_pairs = sorted(pairs, key=lambda x: x["corr"])[:top_neg_pairs]

        return {
            "base": base,
            "symbols": list(data.columns),
            "base_corr": base_corr,
            "diversifiers_vs_base": diversifiers_vs_base,
            "top_positive_pairs": top_positive_pairs,
            "top_negative_pairs": top_negative_pairs,
            "meta": {
                "include_base_in_pairs": bool(include_base_in_pairs),
                "diversifier_threshold": diversifier_threshold,
                "top_pos_pairs": top_pos_pairs,
                "top_neg_pairs": top_neg_pairs,
                "n_price_rows": int(data.shape[0]),
                "start_date": data.index.min().strftime("%Y-%m-%d"),
                "end_date": data.index.max().strftime("%Y-%m-%d"),
                "price_field": "close",
                "use_adjusted_close": bool(use_adjusted_close),
            },
        }

    except Exception as e:
        return {"error": f"correlation_analysis error: {str(e)}"}


from langchain_core.tools import tool
import pandas as pd
import numpy as np


@tool
def support_resistance_levels(
    symbol: str,
    ohlcv_rows: Optional[list[dict]] = None,
    lookback: int = 90,
    start_date: str | None = None,
    end_date: str | None = None) -> dict:
    """
    Identify approximate support and resistance levels from already-fetched OHLCV data.

    Args:
        symbol: Ticker symbol.
        ohlcv_rows: List of rows like
          [{"date":"YYYY-MM-DD","open":...,"high":...,"low":...,"close":...,"volume":...}, ...]
        lookback: Number of most recent rows to use.

    Returns:
        Structured support/resistance levels and commentary.
    """
    try:
        sym = str(symbol).upper().strip()
        if not sym:
            return {"error": "symbol must be a non-empty string."}

        if ohlcv_rows is None:
            data_result = get_ohlcv_daily.invoke({
                "symbol": sym,
                "start_date": start_date,
                "end_date": end_date
            })

            if not isinstance(data_result, dict):
                return {"error": "Unexpected response from get_ohlcv_daily."}
            if "error" in data_result:
                return {"error": f"Data fetch failed: {data_result['error']}"}

            ohlcv_rows = data_result.get("data", [])

        if not isinstance(ohlcv_rows, list) or len(ohlcv_rows) < 5:
            return {"error": "ohlcv_rows must be a list with at least 5 rows."}

        lookback = int(lookback)
        if lookback <= 0:
            lookback = 90

        df = pd.DataFrame(ohlcv_rows).copy()

        required = {"date", "high", "low"}
        if not required.issubset(df.columns):
            return {"error": f"Each row must include {sorted(required)}"}

        df["date"] = pd.to_datetime(df["date"], errors="coerce")
        df["high"] = pd.to_numeric(df["high"], errors="coerce")
        df["low"] = pd.to_numeric(df["low"], errors="coerce")

        df = (
            df.dropna(subset=["date", "high", "low"])
                .sort_values("date")
                .tail(lookback)
                .reset_index(drop=True)
        )

        if df.empty:
            return {"error": f"No valid OHLCV data for {sym}."}
        if df.shape[0] < 5:
            return {"error": f"Need at least 5 valid rows in the lookback window for {sym}."}

        df["High_5"] = df["high"].rolling(5).max()
        df["Low_5"] = df["low"].rolling(5).min()

        resistances = sorted(df["High_5"].dropna().nlargest(3).unique(), reverse=True)
        supports = sorted(df["Low_5"].dropna().nsmallest(3).unique())

        latest_close = None
        if "close" in df.columns:
            close_ser = pd.to_numeric(df["close"], errors="coerce").dropna()
            if not close_ser.empty:
                latest_close = float(close_ser.iloc[-1])

        return {
            "symbol": sym,
            "support_levels": [float(s) for s in supports],
            "resistance_levels": [float(r) for r in resistances],
            "lookback_days": int(min(lookback, df.shape[0])),
            "start_date": df["date"].iloc[0].strftime("%Y-%m-%d"),
            "end_date": df["date"].iloc[-1].strftime("%Y-%m-%d"),
            "latest_close": round(latest_close, 6) if latest_close is not None else None,
        }

    except Exception as e:
        return {"error": f"support_resistance_levels error: {str(e)}"}

from langchain_core.tools import tool
import pandas as pd
import numpy as np


@tool
def return_stats(
    symbol: str,
    ohlcv_rows: Optional[list[dict]] = None,
    start_date: str | None = None,
    end_date: str | None = None
) -> dict:
    """
    Compute descriptive statistics of daily returns using already-fetched OHLCV rows.

    Args:
        ohlcv_rows: List of rows like
          [{"date":"YYYY-MM-DD","open":...,"high":...,"low":...,"close":...,"volume":...}, ...]
        symbol: Optional ticker symbol for labeling output.

    Returns:
        Structured return statistics including annualized return, volatility,
        skewness, kurtosis, and max drawdown.
    """
    try:
        if not symbol or not isinstance(symbol, str):
            return {"error": "symbol must be a non-empty string."}

        if ohlcv_rows is None:
            data_result = get_ohlcv_daily.invoke({
                "symbol": symbol,
                "start_date": start_date,
                "end_date": end_date
            })

            if not isinstance(data_result, dict):
                return {"error": "Unexpected response from get_ohlcv_daily."}
            if "error" in data_result:
                return {"error": f"Data fetch failed: {data_result['error']}"}

            ohlcv_rows = data_result.get("data", [])

        if not isinstance(ohlcv_rows, list) or len(ohlcv_rows) < 2:
            return {"error": "ohlcv_rows must be a list with at least 2 rows."}

        df = pd.DataFrame(ohlcv_rows).copy()

        required = {"date", "close"}
        if not required.issubset(df.columns):
            return {"error": f"Each row must include {sorted(required)}"}

        df["date"] = pd.to_datetime(df["date"], errors="coerce")
        df["close"] = pd.to_numeric(df["close"], errors="coerce")
        df = df.dropna(subset=["date", "close"]).sort_values("date").reset_index(drop=True)

        if df.shape[0] < 2:
            return {"error": "Not enough valid rows after cleaning to compute returns."}

        df["Return"] = df["close"].pct_change()
        rets = df["Return"].dropna()

        if rets.empty:
            return {"error": "Could not compute returns from the provided OHLCV rows."}

        annual_return = float(rets.mean() * 252) if pd.notna(rets.mean()) else None
        annual_volatility = float(rets.std(ddof=1) * np.sqrt(252)) if rets.shape[0] > 1 else None
        skewness = float(rets.skew()) if pd.notna(rets.skew()) else None
        kurtosis = float(rets.kurt()) if pd.notna(rets.kurt()) else None

        cumulative_max = df["close"].cummax()
        drawdown = (cumulative_max - df["close"]) / cumulative_max.replace(0, np.nan)
        max_drawdown = float(drawdown.max()) if drawdown.notna().any() else None

        total_return = float(df["close"].iloc[-1] / df["close"].iloc[0] - 1.0)

        sym = symbol.upper() if isinstance(symbol, str) and symbol.strip() else "UNKNOWN"

        return {
            "symbol": sym,
            "start_date": df["date"].iloc[0].strftime("%Y-%m-%d"),
            "end_date": df["date"].iloc[-1].strftime("%Y-%m-%d"),
            "n_rows": int(df.shape[0]),
            "n_return_obs": int(rets.shape[0]),
            "metrics": {
                "total_return": round(total_return, 6),
                "annualized_return": round(annual_return, 6) if annual_return is not None else None,
                "annualized_volatility": round(annual_volatility, 6) if annual_volatility is not None else None,
                "skewness": round(skewness, 6) if skewness is not None else None,
                "kurtosis": round(kurtosis, 6) if kurtosis is not None else None,
                "max_drawdown": round(max_drawdown, 6) if max_drawdown is not None else None,
            },
            "summary_text": (
                f"Return Statistics — {sym} "
                f"({df['date'].iloc[0].strftime('%Y-%m-%d')} → {df['date'].iloc[-1].strftime('%Y-%m-%d')})\n"
                f"Annual Return ≈ {annual_return:.2%}\n"
                f"Annual Volatility ≈ {annual_volatility:.2%}\n"
                f"Skew = {skewness:.2f}, Kurtosis = {kurtosis:.2f}\n"
                f"Max Drawdown = {max_drawdown:.2%}"
                if all(x is not None for x in [annual_return, annual_volatility, skewness, kurtosis, max_drawdown])
                else f"Return statistics computed for {sym}."
            ),
        }

    except Exception as e:
        return {"error": f"return_stats error: {str(e)}"}

from langchain_core.tools import tool
import pandas as pd
import numpy as np


@tool
def similarity_search_by_technical_profile(
    target_symbol: str,
    compare_symbols: list[str],
    target_ohlcv_rows: Optional[list[dict]] = None,
    compare_ohlcv_map: Optional[dict[str, list[dict]]] = None,
    start_date: str | None = None,
    end_date: str | None = None,
    top_k: int = 5
) -> dict:
    """
    Find which symbols share a similar recent technical setup with the target symbol,
    using already-fetched OHLCV data.

    Compares:
      - RSI(14)
      - SMA20 / SMA50 ratio

    Args:
        target_symbol: The base ticker symbol.
        target_ohlcv_rows: OHLCV rows for the target symbol.
        compare_ohlcv_map: Dict mapping symbol -> OHLCV rows.
        top_k: Number of closest matches to return.

    Returns:
        Structured similarity results with features and scores.
    """
    try:
        target = str(target_symbol).upper().strip()
        if not target:
            return {"error": "target_symbol must be a non-empty string."}

        compare_symbols = [str(s).upper().strip() for s in compare_symbols if str(s).strip()]
        compare_symbols = [s for s in compare_symbols if s != target]

        if target_ohlcv_rows is None:
            target_result = get_ohlcv_daily.invoke({
                "symbol": target,
                "start_date": start_date,
                "end_date": end_date
            })
            if not isinstance(target_result, dict):
                return {"error": "Unexpected response from get_ohlcv_daily for target symbol."}
            if "error" in target_result:
                return {"error": f"Target data fetch failed: {target_result['error']}"}
            target_ohlcv_rows = target_result.get("data", [])

        if compare_ohlcv_map is None:
            compare_ohlcv_map = {}

        for sym in compare_symbols:
            if sym not in compare_ohlcv_map or compare_ohlcv_map[sym] is None:
                cmp_result = get_ohlcv_daily.invoke({
                    "symbol": sym,
                    "start_date": start_date,
                    "end_date": end_date
                })
                if isinstance(cmp_result, dict) and "error" not in cmp_result:
                    compare_ohlcv_map[sym] = cmp_result.get("data", [])

        if not isinstance(target_ohlcv_rows, list) or len(target_ohlcv_rows) < 50:
            return {"error": "target_ohlcv_rows must contain at least 50 rows."}
        if not isinstance(compare_ohlcv_map, dict) or not compare_ohlcv_map:
            return {"error": "compare_ohlcv_map must be a non-empty dict of symbol -> OHLCV rows."}

        top_k = max(1, int(top_k))

        def extract_features(rows: list[dict]) -> dict | None:
            if not isinstance(rows, list) or len(rows) < 50:
                return None

            df = pd.DataFrame(rows).copy()
            required = {"date", "close"}
            if not required.issubset(df.columns):
                return None

            df["date"] = pd.to_datetime(df["date"], errors="coerce")
            df["close"] = pd.to_numeric(df["close"], errors="coerce")
            df = df.dropna(subset=["date", "close"]).sort_values("date").tail(90).reset_index(drop=True)

            if df.shape[0] < 50:
                return None

            close = df["close"]

            sma20 = close.rolling(20).mean().iloc[-1]
            sma50 = close.rolling(50).mean().iloc[-1]
            sma_ratio = float(sma20 / sma50) if pd.notna(sma20) and pd.notna(sma50) and sma50 != 0 else np.nan

            # RSI(14), same local formula as your other tools
            period = 14
            delta = close.diff()
            gain = delta.clip(lower=0)
            loss = -delta.clip(upper=0)
            alpha = 1.0 / period
            avg_gain = gain.ewm(alpha=alpha, adjust=False, min_periods=period).mean()
            avg_loss = loss.ewm(alpha=alpha, adjust=False, min_periods=period).mean()
            rs = avg_gain / (avg_loss + 1e-12)
            rsi = 100 - (100 / (1 + rs))
            rsi_val = float(rsi.iloc[-1]) if pd.notna(rsi.iloc[-1]) else np.nan

            if np.isnan(sma_ratio) or np.isnan(rsi_val):
                return None

            return {
                "sma_ratio": sma_ratio,
                "rsi": rsi_val,
                "last_date": df["date"].iloc[-1].strftime("%Y-%m-%d"),
                "n_rows_used": int(df.shape[0]),
            }

        target_feat = extract_features(target_ohlcv_rows)
        if target_feat is None:
            return {"error": f"No valid technical profile could be computed for {target}."}

        features = {}
        for sym, rows in compare_ohlcv_map.items():
            sym_u = str(sym).upper().strip()
            if not sym_u or sym_u == target:
                continue
            feat = extract_features(rows)
            if feat is not None:
                features[sym_u] = feat

        if not features:
            return {"error": "No comparison symbols have enough valid OHLCV data to compute technical similarity."}

        results = []
        for sym, feat in features.items():
            dist = np.sqrt(
                (target_feat["sma_ratio"] - feat["sma_ratio"]) ** 2 +
                ((target_feat["rsi"] - feat["rsi"]) / 100.0) ** 2
            )
            similarity_score = 1.0 / (1.0 + dist)

            results.append({
                "symbol": sym,
                "distance": float(dist),
                "similarity_score": float(similarity_score),
                "features": {
                    "sma_ratio": round(feat["sma_ratio"], 6),
                    "rsi": round(feat["rsi"], 6),
                }
            })

        results = sorted(results, key=lambda x: x["distance"])[:top_k]

        return {
            "target_symbol": target,
            "target_features": {
                "sma_ratio": round(target_feat["sma_ratio"], 6),
                "rsi": round(target_feat["rsi"], 6),
                "last_date": target_feat["last_date"],
                "n_rows_used": target_feat["n_rows_used"],
            },
            "top_matches": results,
            "summary_text": (
                f"Technical similarity to {target}: " +
                ", ".join(
                    [f"{r['symbol']} ({r['similarity_score']:.2f})" for r in results]
                )
            )
        }

    except Exception as e:
        return {"error": f"similarity_search_by_technical_profile error: {str(e)}"}

from langchain_core.tools import tool
import pandas as pd
import numpy as np


@tool
def beta_vs_market(
    symbol: str,
    market_symbol: str = "SPY",
    ohlcv_rows: Optional[list[dict]] = None,
    market_ohlcv_rows: Optional[list[dict]] = None,
    start_date: str | None = None,
    end_date: str | None = None
) -> dict:
    """
    Compute the stock's beta versus a market proxy using already-fetched OHLCV rows.

    Beta = Cov(r_stock, r_market) / Var(r_market)

    Args:
        symbol: Stock ticker symbol.
        ohlcv_rows: OHLCV rows for the stock.
        market_symbol: Market proxy ticker symbol, e.g. "SPY".
        market_ohlcv_rows: OHLCV rows for the market proxy.

    Returns:
        Structured beta, correlation, volatility, and overlap statistics.
    """
    try:
        sym = str(symbol).upper().strip()
        mkt = str(market_symbol).upper().strip()

        if not sym:
            return {"error": "symbol must be a non-empty string."}
        if not mkt:
            return {"error": "market_symbol must be a non-empty string."}

        if ohlcv_rows is None:
            stock_result = get_ohlcv_daily.invoke({
                "symbol": sym,
                "start_date": start_date,
                "end_date": end_date
            })
            if not isinstance(stock_result, dict):
                return {"error": "Unexpected response from get_ohlcv_daily for stock."}
            if "error" in stock_result:
                return {"error": f"Stock data fetch failed: {stock_result['error']}"}
            ohlcv_rows = stock_result.get("data", [])

        if market_ohlcv_rows is None:
            market_result = get_ohlcv_daily.invoke({
                "symbol": mkt,
                "start_date": start_date,
                "end_date": end_date
            })
            if not isinstance(market_result, dict):
                return {"error": "Unexpected response from get_ohlcv_daily for market."}
            if "error" in market_result:
                return {"error": f"Market data fetch failed: {market_result['error']}"}
            market_ohlcv_rows = market_result.get("data", [])

        if not isinstance(ohlcv_rows, list) or len(ohlcv_rows) < 2:
            return {"error": "ohlcv_rows must be a list with at least 2 rows."}
        if not isinstance(market_ohlcv_rows, list) or len(market_ohlcv_rows) < 2:
            return {"error": "market_ohlcv_rows must be a list with at least 2 rows."}

        def rows_to_close_df(rows: list[dict], col_name: str) -> pd.DataFrame:
            df = pd.DataFrame(rows).copy()
            required = {"date", "close"}
            if not required.issubset(df.columns):
                raise ValueError(f"Each row must include {sorted(required)}")

            df["date"] = pd.to_datetime(df["date"], errors="coerce")
            df["close"] = pd.to_numeric(df["close"], errors="coerce")
            df = df.dropna(subset=["date", "close"]).sort_values("date")
            return df[["date", "close"]].rename(columns={"close": col_name})

        df_s = rows_to_close_df(ohlcv_rows, "stock")
        df_m = rows_to_close_df(market_ohlcv_rows, "market")

        data = pd.merge(df_s, df_m, on="date", how="inner").dropna()

        if len(data) < 30:
            return {
                "error": (
                    f"Not enough overlapping trading days to estimate beta "
                    f"({len(data)} days) for {sym} vs {mkt}."
                )
            }

        data["r_stock"] = data["stock"].pct_change()
        data["r_mkt"] = data["market"].pct_change()
        data = data.dropna(subset=["r_stock", "r_mkt"])

        if len(data) < 2:
            return {"error": f"Not enough overlapping return observations for {sym} vs {mkt}."}

        var_mkt = np.var(data["r_mkt"], ddof=1)
        if not np.isfinite(var_mkt) or var_mkt <= 0:
            return {"error": "Market variance is zero or invalid over this window; cannot compute beta."}

        cov = np.cov(data["r_stock"], data["r_mkt"], ddof=1)[0, 1]
        beta = float(cov / var_mkt)

        corr = np.corrcoef(data["r_stock"], data["r_mkt"])[0, 1]
        corr = float(corr) if np.isfinite(corr) else None

        vol_stock = data["r_stock"].std(ddof=1) * np.sqrt(252)
        vol_mkt = data["r_mkt"].std(ddof=1) * np.sqrt(252)

        vol_stock = float(vol_stock) if np.isfinite(vol_stock) else None
        vol_mkt = float(vol_mkt) if np.isfinite(vol_mkt) else None

        return {
            "symbol": sym,
            "market_symbol": mkt,
            "start_date": data["date"].iloc[0].strftime("%Y-%m-%d"),
            "end_date": data["date"].iloc[-1].strftime("%Y-%m-%d"),
            "overlapping_trading_days": int(len(data)),
            "metrics": {
                "beta": round(beta, 6),
                "correlation": round(corr, 6) if corr is not None else None,
                "annualized_volatility_symbol": round(vol_stock, 6) if vol_stock is not None else None,
                "annualized_volatility_market": round(vol_mkt, 6) if vol_mkt is not None else None,
            },
            "summary_text": (
                f"Beta Estimate — {sym} vs {mkt} "
                f"({data['date'].iloc[0].strftime('%Y-%m-%d')} → {data['date'].iloc[-1].strftime('%Y-%m-%d')})\n"
                f"Beta: {beta:.2f}\n"
                f"Correlation: {corr:.2f}\n"
                f"Annualized Volatility: {sym} {vol_stock:.2%} | {mkt} {vol_mkt:.2%}\n"
                f"Overlapping trading days used: {len(data)}"
            ),
        }

    except Exception as e:
        return {"error": f"beta_vs_market error: {str(e)}"}





@tool(response_format="content_and_artifact")
def build_professional_chart_suite(
    ohlcv_rows: list[dict],
    symbol: str = "",
    chart_types: Optional[list[str]] = None,
    max_points: int = 400
) -> tuple[str, dict]:
    """
    Build professional TradingView Lightweight Charts specs from OHLCV data.
    Supports core series types:
      - candlestick
      - bar
      - line
      - area
      - baseline
      - histogram

    Args:
      ohlcv_rows: list of OHLCV rows.
      symbol: optional ticker label.
      chart_types: optional list of chart types to generate.
        - If omitted or contains "all", all supported types are generated.
        - Otherwise only requested types are generated.
      max_points: cap on sampled rows for payload size/performance.
    """
    try:
        if not isinstance(ohlcv_rows, list) or len(ohlcv_rows) < 10:
            return ("build_professional_chart_suite error: ohlcv_rows must be a list with >= 10 rows.", {})

        df = pd.DataFrame(ohlcv_rows).copy()
        required = {"date", "open", "high", "low", "close", "volume"}
        if not required.issubset(df.columns):
            return (f"build_professional_chart_suite error: each row must include {sorted(required)}.", {})

        df["date"] = pd.to_datetime(df["date"], errors="coerce")
        for col in ["open", "high", "low", "close", "volume"]:
            df[col] = pd.to_numeric(df[col], errors="coerce")

        df = (
            df.dropna(subset=["date", "open", "high", "low", "close", "volume"])
            .sort_values("date")
            .reset_index(drop=True)
        )
        if df.empty:
            return ("build_professional_chart_suite error: no valid rows after cleaning.", {})

        # Keep artifact size stable for streaming/UI render performance.
        if max_points < 60:
            max_points = 60
        if len(df) > max_points:
            indices = np.linspace(0, len(df) - 1, num=max_points, dtype=int)
            df = df.iloc[np.unique(indices)].reset_index(drop=True)

        tag = symbol.upper().strip() if symbol else "ASSET"
        up_color = "#22C55E"
        down_color = "#EF4444"
        neutral_color = "#94A3B8"

        supported_types = ["candlestick", "bar", "line", "area", "baseline", "histogram"]
        alias_map = {
            "candlestick": "candlestick",
            "candlesticks": "candlestick",
            "candle": "candlestick",
            "candles": "candlestick",
            "bar": "bar",
            "bars": "bar",
            "line": "line",
            "area": "area",
            "baseline": "baseline",
            "histogram": "histogram",
            "hist": "histogram",
            "returns": "histogram",
            "return_histogram": "histogram",
            "all": "all",
        }

        requested_types: list[str] = []
        if not chart_types:
            requested_types = supported_types.copy()
        else:
            for raw in chart_types:
                if not isinstance(raw, str):
                    continue
                norm = alias_map.get(raw.strip().lower())
                if not norm:
                    continue
                if norm == "all":
                    requested_types = supported_types.copy()
                    break
                requested_types.append(norm)

            if not requested_types:
                return (
                    "build_professional_chart_suite error: no valid chart_types provided. "
                    f"Supported: {supported_types}.",
                    {},
                )
            # Preserve order while de-duplicating.
            requested_types = list(dict.fromkeys(requested_types))

        df["time"] = df["date"].dt.strftime("%Y-%m-%d")
        prev_close = df["close"].shift(1).fillna(df["close"])
        is_up = df["close"] >= prev_close

        close_line = (
            [{"time": t, "value": float(v)} for t, v in zip(df["time"], df["close"])]
            if any(t in requested_types for t in ["line", "area", "baseline"])
            else []
        )

        candle_data = (
            [
                {
                    "time": t,
                    "open": float(o),
                    "high": float(h),
                    "low": float(l),
                    "close": float(c),
                }
                for t, o, h, l, c in zip(df["time"], df["open"], df["high"], df["low"], df["close"])
            ]
            if "candlestick" in requested_types
            else []
        )

        bar_data = (
            [
                {
                    "time": t,
                    "open": float(o),
                    "high": float(h),
                    "low": float(l),
                    "close": float(c),
                    "color": up_color if up else down_color,
                }
                for t, o, h, l, c, up in zip(
                    df["time"], df["open"], df["high"], df["low"], df["close"], is_up
                )
            ]
            if "bar" in requested_types
            else []
        )

        returns_hist = []
        if "histogram" in requested_types:
            df["ret_pct"] = df["close"].pct_change().fillna(0.0) * 100.0
            returns_hist = [
                {
                    "time": t,
                    "value": float(v),
                    "color": up_color if v >= 0 else down_color,
                }
                for t, v in zip(df["time"], df["ret_pct"])
            ]

        baseline_base = float(df["close"].iloc[0]) if "baseline" in requested_types else None

        chart_options = {
            "layout": {
                "background": {"type": "solid", "color": "#0B1220"},
                "textColor": "#C7D2FE",
            },
            "grid": {
                "vertLines": {"color": "rgba(148, 163, 184, 0.10)"},
                "horzLines": {"color": "rgba(148, 163, 184, 0.10)"},
            },
            "timeScale": {"borderColor": "rgba(148, 163, 184, 0.25)"},
            "rightPriceScale": {"borderColor": "rgba(148, 163, 184, 0.25)"},
            "crosshair": {"mode": 1},
        }

        charts = []
        for chart_type in requested_types:
            if chart_type == "candlestick":
                charts.append(
                    {
                        "id": "candlestick",
                        "title": f"{tag} Candlestick",
                        "chart_type": "candlestick",
                        "options": chart_options,
                        "series": [
                            {
                                "type": "candlestick",
                                "data": candle_data,
                                "options": {
                                    "upColor": up_color,
                                    "downColor": down_color,
                                    "borderVisible": False,
                                    "wickUpColor": up_color,
                                    "wickDownColor": down_color,
                                },
                            }
                        ],
                    }
                )
            elif chart_type == "bar":
                charts.append(
                    {
                        "id": "bar",
                        "title": f"{tag} OHLC Bars",
                        "chart_type": "bar",
                        "options": chart_options,
                        "series": [{"type": "bar", "data": bar_data, "options": {"thinBars": False}}],
                    }
                )
            elif chart_type == "line":
                charts.append(
                    {
                        "id": "line",
                        "title": f"{tag} Line (Close)",
                        "chart_type": "line",
                        "options": chart_options,
                        "series": [{"type": "line", "data": close_line, "options": {"color": "#22D3EE", "lineWidth": 2}}],
                    }
                )
            elif chart_type == "area":
                charts.append(
                    {
                        "id": "area",
                        "title": f"{tag} Area (Close)",
                        "chart_type": "area",
                        "options": chart_options,
                        "series": [
                            {
                                "type": "area",
                                "data": close_line,
                                "options": {
                                    "lineColor": "#34D399",
                                    "topColor": "rgba(52, 211, 153, 0.35)",
                                    "bottomColor": "rgba(52, 211, 153, 0.02)",
                                },
                            }
                        ],
                    }
                )
            elif chart_type == "baseline":
                charts.append(
                    {
                        "id": "baseline",
                        "title": f"{tag} Baseline (Close vs Start)",
                        "chart_type": "baseline",
                        "options": chart_options,
                        "series": [
                            {
                                "type": "baseline",
                                "data": close_line,
                                "options": {
                                    "baseValue": {"type": "price", "price": baseline_base},
                                    "topLineColor": up_color,
                                    "topFillColor1": "rgba(34, 197, 94, 0.35)",
                                    "topFillColor2": "rgba(34, 197, 94, 0.03)",
                                    "bottomLineColor": down_color,
                                    "bottomFillColor1": "rgba(239, 68, 68, 0.25)",
                                    "bottomFillColor2": "rgba(239, 68, 68, 0.02)",
                                },
                            }
                        ],
                    }
                )
            elif chart_type == "histogram":
                charts.append(
                    {
                        "id": "histogram",
                        "title": f"{tag} Daily Returns Histogram (%)",
                        "chart_type": "histogram",
                        "options": chart_options,
                        "series": [
                            {
                                "type": "histogram",
                                "data": returns_hist,
                                "options": {
                                    "color": neutral_color,
                                    "priceFormat": {"type": "price", "precision": 2, "minMove": 0.01},
                                },
                            }
                        ],
                    }
                )

        content = (
            f"Generated professional chart suite for {tag} using TradingView Lightweight Charts schema. "
            f"Chart types included: {', '.join(requested_types)}."
        )
        artifact = {
            "type": "lightweight_charts",
            "theme": "robinhood_dark",
            "charts": charts,
            "metadata": {
                "symbol": tag,
                "chart_types": requested_types,
                "rows_used": int(len(df)),
                "start_date": str(df["time"].iloc[0]),
                "end_date": str(df["time"].iloc[-1]),
                "library": "tradingview-lightweight-charts",
            },
        }
        return (content, artifact)

    except Exception as e:
        return (f"build_professional_chart_suite error: {str(e)}", {})




import os
import numpy as np
import pandas as pd

@tool
def plot_ta_report_charts(
    ohlcv_rows: list[dict],
    indicators_result: dict,
    symbol: str = "",
    out_dir: str = "ta_charts",
    dpi: int = 200,
) -> dict:
    """
    Create one tutorial-style mplfinance chart:
    candlestick + SMA(5,20) + volume + MACD + stochastic
    """
    try:
        import matplotlib
        matplotlib.use("Agg")
        import mplfinance as mpf

        # ---------- validate input ----------
        if not isinstance(ohlcv_rows, list) or len(ohlcv_rows) < 10:
            return {"error": "ohlcv_rows must be a list with >= 10 rows."}

        df = pd.DataFrame(ohlcv_rows).copy()
        needed = {"date", "open", "high", "low", "close", "volume"}
        if not needed.issubset(df.columns):
            return {"error": f"Each row must include {sorted(needed)}"}

        # ---------- clean OHLCV ----------
        df["date"] = pd.to_datetime(df["date"], errors="coerce")
        df = df.dropna(subset=["date"]).sort_values("date").reset_index(drop=True)

        for c in ["open", "high", "low", "close", "volume"]:
            df[c] = pd.to_numeric(df[c], errors="coerce")

        df = df.dropna(subset=["open", "high", "low", "close"]).reset_index(drop=True)
        if len(df) < 10:
            return {"error": "No valid OHLC rows after cleaning."}

        df = df.rename(columns={
            "open": "Open",
            "high": "High",
            "low": "Low",
            "close": "Close",
            "volume": "Volume",
        })
        df = df.set_index("date")
        df.index.name = "Date"

        # ---------- parameters ----------
        params = indicators_result.get("params", {}) if isinstance(indicators_result, dict) else {}

        sma_periods = params.get("SMA", {}).get("periods", [5, 20])
        sma_periods = tuple(sorted({int(p) for p in sma_periods if int(p) > 0}))
        if len(sma_periods) == 0:
            sma_periods = (5, 20)

        macd_p = params.get("MACD", {}) or {}
        macd_fast = int(macd_p.get("fast", 12))
        macd_slow = int(macd_p.get("slow", 26))
        macd_signal = int(macd_p.get("signal", 9))

        stoch_p = params.get("STOCHASTIC", {}) or {}
        stoch_window = int(stoch_p.get("window", 14))
        stoch_smooth = int(stoch_p.get("smooth_window", 3))

        close = df["Close"]
        high = df["High"]
        low = df["Low"]

        # ---------- MACD ----------
        ema_fast = close.ewm(span=macd_fast, adjust=False).mean()
        ema_slow = close.ewm(span=macd_slow, adjust=False).mean()
        macd_line = ema_fast - ema_slow
        signal_line = macd_line.ewm(span=macd_signal, adjust=False).mean()
        macd_hist = macd_line - signal_line

        macd = pd.DataFrame(index=df.index)
        macd["macd"] = macd_line
        macd["signal"] = signal_line
        macd["bar_positive"] = macd_hist.where(macd_hist > 0, 0.0)
        macd["bar_negative"] = macd_hist.where(macd_hist < 0, 0.0)

        # ---------- Stochastic ----------
        lowest_low = low.rolling(stoch_window).min()
        highest_high = high.rolling(stoch_window).max()
        denom = (highest_high - lowest_low).replace(0, np.nan)

        stoch = pd.DataFrame(index=df.index)
        stoch["%K"] = ((close - lowest_low) / denom) * 100.0
        stoch["%D"] = stoch["%K"].rolling(stoch_smooth).mean()

        # standard fixed reference levels
        stoch["Overbought"] = 80.0
        stoch["Oversold"] = 20.0

        # ---------- Bollinger Bands ----------
        bb_p = params.get("BOLLINGER", {}) or {}
        bb_period = int(bb_p.get("period", 20))
        bb_std = float(bb_p.get("std", 2.0))

        bb_mid = close.rolling(bb_period).mean()
        bb_sigma = close.rolling(bb_period).std()
        bb_upper = bb_mid + bb_std * bb_sigma
        bb_lower = bb_mid - bb_std * bb_sigma

        # ---------- mplfinance addplots ----------
        # ---------- SMA ----------
        sma_short = close.rolling(5).mean()
        sma_long = close.rolling(20).mean()

        plots = [
            mpf.make_addplot(
                sma_short,
                panel=0,
                color="blue",
                label="SMA 5"
            ),

            mpf.make_addplot(
                sma_long,
                panel=0,
                color="orange",
                label="SMA 20"
            ),
            mpf.make_addplot(
                macd["macd"],
                color="#606060",
                panel=2,
                ylabel=f"MACD ({macd_fast},{macd_slow},{macd_signal})",
                secondary_y=False,
                label="MACD"
            ),
            mpf.make_addplot(
                macd["signal"],
                color="#1f77b4",
                panel=2,
                secondary_y=False,
                label="Signal"
            ),
            mpf.make_addplot(
                macd["bar_positive"],
                type="bar",
                color="#4dc790",
                panel=2
            ),
            mpf.make_addplot(
                macd["bar_negative"],
                type="bar",
                color="#fd6b6c",
                panel=2
            ),
            mpf.make_addplot(
                stoch[["%K", "%D", "Overbought", "Oversold"]],
                panel=3,
                ylabel=f"Stoch ({stoch_window},{stoch_smooth})",
                ylim=(0, 100),
                secondary_y=False,
                label=["%K", "%D", "Overbought", "Oversold"]
            )
        ]

        # ---------- output ----------
        os.makedirs(out_dir, exist_ok=True)
        tag = symbol.upper().strip() if symbol else "ASSET"
        path = os.path.join(out_dir, f"{tag}_ta_panel.png")
        bb_path = os.path.join(out_dir, f"{tag}_bollinger.png")

        fig, axes = mpf.plot(
            df,
            type="candle",
            style="yahoo",
            volume=True,
            addplot=plots,
            panel_ratios=(3, 1, 3, 3),
            figscale=1.5,
            figsize=(16, 14),
            xrotation=20,
            tight_layout=True,
            returnfig=True
        )
        for ax in axes:
            ax.tick_params(axis='both', labelsize=16)

        # mplfinance often returns paired axes; the visible right-side panel axes are commonly 1,3,5,7
        if len(axes) >= 8:
            axes[1].yaxis.label.set_size(16)  # Price
            axes[3].yaxis.label.set_size(16)  # Volume
            axes[5].yaxis.label.set_size(16)  # MACD
            axes[7].yaxis.label.set_size(16)  # Stochastic
        else:
            for ax in axes:
                ax.yaxis.label.set_size(16)

        # legends
        axes[0].legend(loc="upper left", fontsize=16)
        axes[4].legend(loc="upper left", fontsize=16)
        axes[6].legend(loc="upper left", fontsize=16)

        fig.suptitle(
            f"{tag} Technical Analysis",
            fontsize=16,
            y=0.98
        )

        fig.savefig(path, dpi=dpi, bbox_inches="tight")

        bb_plots = [
            mpf.make_addplot(
                bb_upper,
                color="purple",
                width=1.0,
                label="Upper Band"
            ),
            mpf.make_addplot(
                bb_mid,
                color="orange",
                width=1.0,
                label=f"Middle SMA {bb_period}"
            ),
            mpf.make_addplot(
                bb_lower,
                color="purple",
                width=1.0,
                label="Lower Band"
            ),
        ]

        fig_bb, axes_bb = mpf.plot(
            df,
            type="candle",
            style="yahoo",
            volume=False,
            addplot=bb_plots,

            # shading between bands
            fill_between=dict(
                y1=bb_lower.values,
                y2=bb_upper.values,
                alpha=0.12,
                color="#7B68EE"
            ),

            figscale=1.3,
            figsize=(22, 16),
            xrotation=20,
            tight_layout=True,
            returnfig=True
        )
        for ax in axes_bb:
            ax.tick_params(axis='both', labelsize=16)

        # make the visible y-axis label larger too
        if len(axes_bb) >= 2:
            axes_bb[1].yaxis.label.set_size(16)
        else:
            axes_bb[0].yaxis.label.set_size(16)

        fig_bb.suptitle(
            f"{tag} Bollinger Bands ({bb_period}, {bb_std}σ)",
            fontsize=18,
            y=0.98
        )

        ax_bb = axes_bb[0] if isinstance(axes_bb, (list, tuple, np.ndarray)) else axes_bb
        ax_bb.legend(loc="upper left", fontsize=16)

        fig_bb.savefig(bb_path, dpi=dpi, bbox_inches="tight")

        import matplotlib.pyplot as plt
        plt.close(fig)
        plt.close(fig_bb)

        return {
            "symbol": tag,
            "out_dir": out_dir,
            "files": [
                {"name": "ta_panel", "path": path},
                {"name": "bollinger", "path": bb_path},
            ],
            "notes": "Generated TA multi-panel chart and separate Bollinger Bands chart.",
        }

    except Exception as e:
        return {"error": f"plot_ta_report_charts error: {str(e)}"}