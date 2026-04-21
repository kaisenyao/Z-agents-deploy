const trimTrailingSlash = (value: string) => value.replace(/\/+$/, '');

function requireViteEnv(name: 'VITE_LANGGRAPH_API_BASE_URL'): string {
  const value = trimTrailingSlash(String(import.meta.env[name] || '').trim());
  if (!value) {
    throw new Error(`${name} is required. Set it in Z-UI/.env and restart the Vite dev server.`);
  }
  return value;
}

export const LANGGRAPH_API_BASE =
  requireViteEnv('VITE_LANGGRAPH_API_BASE_URL');

export const APP_API_BASE =
  trimTrailingSlash(String(import.meta.env.VITE_APP_API_BASE_URL || '').trim()) || LANGGRAPH_API_BASE;

if (import.meta.env.DEV) {
  console.info('[apiBase]', {
    LANGGRAPH_API_BASE,
    APP_API_BASE,
  });
}

export function langGraphApi(path: string): string {
  return `${LANGGRAPH_API_BASE}${path.startsWith('/') ? path : `/${path}`}`;
}

export function appApi(path: string): string {
  return `${APP_API_BASE}${path.startsWith('/') ? path : `/${path}`}`;
}
