create table if not exists market_screener_cache (
  category text not null,
  tab text not null,
  updated_at timestamptz not null,
  items jsonb not null default '[]'::jsonb,
  provider text not null default 'yahoo',
  source_key text,
  refresh_status text not null default 'ok',
  last_error text,
  created_at timestamptz not null default now(),
  refreshed_at timestamptz not null default now(),
  primary key (category, tab),
  constraint market_screener_cache_category_check
    check (category in ('stocks', 'etfs', 'crypto', 'options')),
  constraint market_screener_cache_tab_check
    check (tab in ('most_actives', 'day_gainers')),
  constraint market_screener_cache_items_array_check
    check (jsonb_typeof(items) = 'array')
);

create index if not exists market_screener_cache_refreshed_at_idx
  on market_screener_cache (refreshed_at);
