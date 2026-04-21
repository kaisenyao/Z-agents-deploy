
  import { defineConfig } from 'vite';
  import react from '@vitejs/plugin-react-swc';
  import path from 'path';
  import { MarketDataGateway } from './server/marketDataGateway';
  import { searchYahooMarket } from './server/marketSearch';
  import { ResearchScreenerCache } from './server/researchScreenerCache';
  import { authDevPlugin } from './server/authPlugin';

  const marketDataGateway = new MarketDataGateway();
  const researchScreenerCache = new ResearchScreenerCache();

  function optionsChainDevPlugin() {
    return {
      name: 'options-chain-dev-api',
      configureServer(server: any) {
        server.middlewares.use('/api/quote-metadata', async (req: any, res: any, next: any) => {
          if (req.method !== 'GET') {
            return next();
          }

          try {
            const url = new URL(req.url, 'http://127.0.0.1:3000');
            const symbol = String(url.searchParams.get('symbol') || '').trim().toUpperCase();

            if (!symbol) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'Missing required query parameter: symbol' }));
              return;
            }

            const metadata = await marketDataGateway.getMetadata(symbol);
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({
              symbol,
              shortName: metadata?.shortName,
              longName: metadata?.longName,
              marketCap: metadata?.marketCap,
              trailingPE: metadata?.trailingPE,
              epsTrailingTwelveMonths: metadata?.epsTrailingTwelveMonths,
            }));
          } catch (error: any) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({
              error: 'Failed to fetch quote metadata',
              details: error?.message || 'Unknown error',
            }));
          }
        });

        server.middlewares.use('/api/options-chain', async (req: any, res: any, next: any) => {
          if (req.method !== 'GET') {
            return next();
          }

          try {
            const url = new URL(req.url, 'http://127.0.0.1:3000');
            const symbol = String(url.searchParams.get('symbol') || '').trim().toUpperCase();
            const date = String(url.searchParams.get('date') || '').trim();

            if (!symbol) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'Missing required query parameter: symbol' }));
              return;
            }

            const data = await marketDataGateway.getOptions(symbol, date);

            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(data));
          } catch (error: any) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({
              error: 'Failed to fetch options chain',
              details: error?.message || 'Unknown error',
            }));
          }
        });
      },
    };
  }

  function researchScreenerDevPlugin() {
    return {
      name: 'research-screener-dev-api',
      configureServer(server: any) {
        void researchScreenerCache.start();

        const handleScreenerRequest = async (req: any, res: any, next: any) => {
          if (req.method !== 'GET') {
            return next();
          }

          try {
            const url = new URL(req.url, 'http://127.0.0.1:3000');
            const category = String(url.searchParams.get('category') || '').trim().toLowerCase();
            const tab = String(url.searchParams.get('tab') || '').trim().toLowerCase();
            const validCategories = new Set(['stocks', 'etfs', 'crypto', 'options']);
            const validTabs = new Set(['most_actives', 'day_gainers']);

            if (!validCategories.has(category) || !validTabs.has(tab)) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'Invalid category or tab' }));
              return;
            }

            const payload = await researchScreenerCache.get(
              category as 'stocks' | 'etfs' | 'crypto' | 'options',
              tab as 'most_actives' | 'day_gainers',
            );

            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(payload));
          } catch (error: any) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({
              error: 'Failed to fetch cached research screener data',
              details: error?.message || 'Unknown error',
            }));
          }
        };

        server.middlewares.use('/api/research/screener', handleScreenerRequest);
        server.middlewares.use('/api/market/screener', handleScreenerRequest);

        server.middlewares.use('/api/market/search', async (req: any, res: any, next: any) => {
          if (req.method !== 'GET') {
            return next();
          }

          try {
            const url = new URL(req.url, 'http://127.0.0.1:3000');
            const query = String(url.searchParams.get('query') || '').trim();
            const category = String(url.searchParams.get('category') || '').trim().toLowerCase();

            if (!query) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'Missing required query parameter: query' }));
              return;
            }

            if (!category) {
              const items = await marketDataGateway.searchRaw(query);
              res.statusCode = 200;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ items }));
              return;
            }

            const validCategories = new Set(['stocks', 'etfs', 'crypto', 'options']);
            if (!validCategories.has(category)) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'Invalid category' }));
              return;
            }

            const items = await searchYahooMarket(query, category as 'stocks' | 'etfs' | 'crypto' | 'options');

            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ items }));
          } catch (error: any) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({
              error: 'Failed to search market data',
              details: error?.message || 'Unknown error',
            }));
          }
        });
      },
    };
  }

  function marketGatewayDevPlugin() {
    return {
      name: 'market-gateway-dev-api',
      configureServer(server: any) {
        server.middlewares.use('/api/market/quote', async (req: any, res: any, next: any) => {
          if (req.method !== 'GET') {
            return next();
          }

          let symbols: string[] = [];
          try {
            const url = new URL(req.url, 'http://127.0.0.1:3000');
            symbols = String(url.searchParams.get('symbols') || '')
              .split(',')
              .map((symbol) => symbol.trim().toUpperCase())
              .filter(Boolean);

            if (!symbols.length) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'Missing required query parameter: symbols' }));
              return;
            }

            const items = await marketDataGateway.getQuotes(symbols);
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ items }));
          } catch (error: any) {
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({
              items: [],
              diagnostics: {
                routeFallback: true,
                symbolCount: symbols.length,
                error: error?.message || 'Unknown error',
              },
            }));
          }
        });

        server.middlewares.use('/api/market/chart', async (req: any, res: any, next: any) => {
          if (req.method !== 'GET') {
            return next();
          }

          try {
            const url = new URL(req.url, 'http://127.0.0.1:3000');
            const symbol = String(url.searchParams.get('symbol') || '').trim().toUpperCase();
            const range = String(url.searchParams.get('range') || '1mo').trim();
            const interval = String(url.searchParams.get('interval') || '1d').trim();
            const startDate = String(url.searchParams.get('startDate') || '').trim();
            const endDate = String(url.searchParams.get('endDate') || '').trim();
            const rawPeriod1 = String(url.searchParams.get('period1') || '').trim();
            const rawPeriod2 = String(url.searchParams.get('period2') || '').trim();
            const parsedPeriod1 = rawPeriod1 ? Number(rawPeriod1) : Number.NaN;
            const parsedPeriod2 = rawPeriod2 ? Number(rawPeriod2) : Number.NaN;
            const period1 = Number.isFinite(parsedPeriod1) ? parsedPeriod1 : undefined;
            const period2 = Number.isFinite(parsedPeriod2) ? parsedPeriod2 : undefined;

            if (!symbol) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'Missing required query parameter: symbol' }));
              return;
            }

            const chart = await marketDataGateway.getChart(symbol, {
              range,
              interval,
              startDate: startDate || undefined,
              endDate: endDate || undefined,
              period1,
              period2,
            });
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ chart }));
          } catch (error: any) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({
              error: 'Failed to fetch market chart',
              details: error?.message || 'Unknown error',
            }));
          }
        });

        server.middlewares.use('/api/market/metadata', async (req: any, res: any, next: any) => {
          if (req.method !== 'GET') {
            return next();
          }

          let symbol = '';
          try {
            const url = new URL(req.url, 'http://127.0.0.1:3000');
            symbol = String(url.searchParams.get('symbol') || '').trim().toUpperCase();

            if (!symbol) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'Missing required query parameter: symbol' }));
              return;
            }

            const metadata = await marketDataGateway.getMetadata(symbol);
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(metadata || {
              symbol,
              shortName: symbol,
              pageMetrics: {},
            }));
          } catch (error: any) {
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({
              symbol,
              shortName: symbol,
              pageMetrics: {},
              diagnostics: {
                routeFallback: true,
                error: error?.message || 'Unknown error',
              },
            }));
          }
        });

        server.middlewares.use('/api/market/options', async (req: any, res: any, next: any) => {
          if (req.method !== 'GET') {
            return next();
          }

          try {
            const url = new URL(req.url, 'http://127.0.0.1:3000');
            const symbol = String(url.searchParams.get('symbol') || '').trim().toUpperCase();
            const date = String(url.searchParams.get('date') || '').trim();

            if (!symbol) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'Missing required query parameter: symbol' }));
              return;
            }

            const data = await marketDataGateway.getOptions(symbol, date);
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(data));
          } catch (error: any) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({
              error: 'Failed to fetch market options',
              details: error?.message || 'Unknown error',
            }));
          }
        });
      },
    };
  }

  export default defineConfig({
    plugins: [authDevPlugin(), researchScreenerDevPlugin(), marketGatewayDevPlugin(), optionsChainDevPlugin(), react()],
    resolve: {
      extensions: ['.js', '.jsx', '.ts', '.tsx', '.json'],
      alias: {
        'vaul@1.1.2': 'vaul',
        'sonner@2.0.3': 'sonner',
        'recharts@2.15.2': 'recharts',
        'react-resizable-panels@2.1.7': 'react-resizable-panels',
        'react-hook-form@7.55.0': 'react-hook-form',
        'react-day-picker@8.10.1': 'react-day-picker',
        'next-themes@0.4.6': 'next-themes',
        'lucide-react@0.487.0': 'lucide-react',
        'input-otp@1.4.2': 'input-otp',
        'embla-carousel-react@8.6.0': 'embla-carousel-react',
        'cmdk@1.1.1': 'cmdk',
        'class-variance-authority@0.7.1': 'class-variance-authority',
        '@radix-ui/react-tooltip@1.1.8': '@radix-ui/react-tooltip',
        '@radix-ui/react-toggle@1.1.2': '@radix-ui/react-toggle',
        '@radix-ui/react-toggle-group@1.1.2': '@radix-ui/react-toggle-group',
        '@radix-ui/react-tabs@1.1.3': '@radix-ui/react-tabs',
        '@radix-ui/react-switch@1.1.3': '@radix-ui/react-switch',
        '@radix-ui/react-slot@1.1.2': '@radix-ui/react-slot',
        '@radix-ui/react-slider@1.2.3': '@radix-ui/react-slider',
        '@radix-ui/react-separator@1.1.2': '@radix-ui/react-separator',
        '@radix-ui/react-select@2.1.6': '@radix-ui/react-select',
        '@radix-ui/react-scroll-area@1.2.3': '@radix-ui/react-scroll-area',
        '@radix-ui/react-radio-group@1.2.3': '@radix-ui/react-radio-group',
        '@radix-ui/react-progress@1.1.2': '@radix-ui/react-progress',
        '@radix-ui/react-popover@1.1.6': '@radix-ui/react-popover',
        '@radix-ui/react-navigation-menu@1.2.5': '@radix-ui/react-navigation-menu',
        '@radix-ui/react-menubar@1.1.6': '@radix-ui/react-menubar',
        '@radix-ui/react-label@2.1.2': '@radix-ui/react-label',
        '@radix-ui/react-hover-card@1.1.6': '@radix-ui/react-hover-card',
        '@radix-ui/react-dropdown-menu@2.1.6': '@radix-ui/react-dropdown-menu',
        '@radix-ui/react-dialog@1.1.6': '@radix-ui/react-dialog',
        '@radix-ui/react-context-menu@2.2.6': '@radix-ui/react-context-menu',
        '@radix-ui/react-collapsible@1.1.3': '@radix-ui/react-collapsible',
        '@radix-ui/react-checkbox@1.1.4': '@radix-ui/react-checkbox',
        '@radix-ui/react-avatar@1.1.3': '@radix-ui/react-avatar',
        '@radix-ui/react-aspect-ratio@1.1.2': '@radix-ui/react-aspect-ratio',
        '@radix-ui/react-alert-dialog@1.1.6': '@radix-ui/react-alert-dialog',
        '@radix-ui/react-accordion@1.2.3': '@radix-ui/react-accordion',
        '@': path.resolve(__dirname, './src'),
      },
    },
    build: {
      target: 'esnext',
      outDir: 'build',
    },
    server: {
      host: '0.0.0.0',
      port: 3000,
      open: true,
      allowedHosts: true,
      proxy: {
        '/api': {
          target: 'http://127.0.0.1:2024',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, ''),
          timeout: 0,
          proxyTimeout: 600000,
        },
      },
    },
  });
