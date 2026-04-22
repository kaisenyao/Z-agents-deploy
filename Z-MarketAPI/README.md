# Z-MarketAPI

Standalone market data API for Z-UI.

## Endpoints

- `GET /ok`
- `GET /health`
- `GET /market/quote?symbols=NVDA,AAPL`
- `GET /market/chart?symbol=NVDA&range=1mo&interval=1d`
- `GET /market/search?query=NVDA&category=stocks`
- `GET /market/metadata?symbol=NVDA`
- `GET /market/options?symbol=NVDA`
- `GET /market/options?symbol=NVDA&date=2026-05-15`
- `GET /market/screener?category=stocks&tab=most_actives`

The service uses direct Yahoo Finance HTTP endpoints, short-lived in-memory TTL
caches, and a Supabase/Postgres-backed persistent cache for `/market/screener`.

## Environment

```env
PORT=8787
CORS_ORIGIN=*
MARKET_CACHE_TTL_MS=30000
MARKET_QUOTE_TTL_MS=15000
MARKET_CHART_TTL_MS=60000
MARKET_METADATA_TTL_MS=1800000
MARKET_SCREENER_TTL_MS=300000
MARKET_SCREENER_STALE_MS=1800000
MARKET_SCREENER_REFRESH_INTERVAL_MS=1800000
MARKET_OPTIONS_TTL_MS=60000
YAHOO_TIMEOUT_MS=15000
DATABASE_URL=postgresql://postgres:<password>@<host>:5432/postgres
# or:
SUPABASE_DB_URL=postgresql://postgres:<password>@<host>:5432/postgres
```

Run `db/migrations/001_market_screener_cache.sql` in the Supabase SQL editor
before enabling the database URL.

## Local Run

```bash
npm install
npm start
```

## Smoke Tests

```bash
curl -s "http://127.0.0.1:8787/market/options?symbol=NVDA"
curl -s "http://127.0.0.1:8787/market/options?symbol=NVDA&date=2026-05-15"
curl -s "http://127.0.0.1:8787/market/screener?category=stocks&tab=most_actives"
curl -s "http://127.0.0.1:8787/market/screener?category=options&tab=most_actives"
```

The options endpoint is display-only. It returns the available expirations, the
selected expiration, and normalized call/put rows for UI display.

## Railway

Create a new Railway service with root directory `Z-MarketAPI`.

```text
Build command: npm install
Start command: npm start
Healthcheck path: /ok
```

Set `DATABASE_URL` or `SUPABASE_DB_URL` to the Supabase pooled Postgres
connection string. Keep `PGSSLMODE` unset unless you explicitly need to disable
SSL for local development.

After deploy, set the frontend environment:

```env
VITE_ENABLE_MARKET_API=true
VITE_APP_API_BASE_URL=https://<market-api-service>.up.railway.app
```

Keep `VITE_LANGGRAPH_API_BASE_URL` pointed at the existing LangGraph backend.
