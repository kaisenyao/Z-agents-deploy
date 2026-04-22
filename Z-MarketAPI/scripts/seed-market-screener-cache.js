#!/usr/bin/env node

const fs = require('node:fs/promises');
const path = require('node:path');
const { Pool } = require('pg');

const DATABASE_URL = process.env.SUPABASE_DB_URL;
if (!DATABASE_URL) {
  throw new Error('SUPABASE_DB_URL is required');
}

const CACHE_DIR = path.resolve(__dirname, '../../Z-UI/.cache/research-screeners');
const CACHE_FILES = [
  'crypto-day_gainers.json',
  'crypto-most_actives.json',
  'etfs-day_gainers.json',
  'etfs-most_actives.json',
  'options-day_gainers.json',
  'options-most_actives.json',
  'stocks-day_gainers.json',
  'stocks-most_actives.json',
];

const VALID_CATEGORIES = new Set(['stocks', 'etfs', 'crypto', 'options']);
const VALID_TABS = new Set(['most_actives', 'day_gainers']);

function parseEnvelope(filename, raw) {
  const envelope = JSON.parse(raw);
  const { category, tab, updatedAt, items } = envelope;
  const updatedDate = new Date(updatedAt);

  if (!VALID_CATEGORIES.has(category)) {
    throw new Error(`${filename}: invalid category "${category}"`);
  }

  if (!VALID_TABS.has(tab)) {
    throw new Error(`${filename}: invalid tab "${tab}"`);
  }

  if (!Number.isFinite(updatedDate.getTime())) {
    throw new Error(`${filename}: invalid updatedAt "${updatedAt}"`);
  }

  if (!Array.isArray(items)) {
    throw new Error(`${filename}: items must be an array`);
  }

  return {
    category,
    tab,
    updatedAt: updatedDate.toISOString(),
    items,
  };
}

async function upsertEnvelope(client, filename, envelope) {
  await client.query(
    `
      insert into market_screener_cache (
        category,
        tab,
        updated_at,
        items,
        provider,
        source_key,
        refresh_status,
        last_error,
        refreshed_at
      )
      values ($1, $2, $3, $4::jsonb, 'seed_local_cache', $5, 'ok', null, now())
      on conflict (category, tab) do update set
        updated_at = excluded.updated_at,
        items = excluded.items,
        provider = excluded.provider,
        source_key = excluded.source_key,
        refresh_status = excluded.refresh_status,
        last_error = excluded.last_error,
        refreshed_at = now()
    `,
    [envelope.category, envelope.tab, envelope.updatedAt, JSON.stringify(envelope.items), filename],
  );
}

async function main() {
  const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false },
  });

  const client = await pool.connect();
  try {
    await client.query('begin');

    for (const filename of CACHE_FILES) {
      const filePath = path.join(CACHE_DIR, filename);
      const raw = await fs.readFile(filePath, 'utf8');
      const envelope = parseEnvelope(filename, raw);

      await upsertEnvelope(client, filename, envelope);
      console.log(`upserted ${envelope.category}/${envelope.tab} from ${filename} (${envelope.items.length} items)`);
    }

    await client.query('commit');
    console.log(`seeded ${CACHE_FILES.length} market_screener_cache rows`);
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
