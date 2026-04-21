const trimTrailingSlash = (value: string) => value.replace(/\/+$/, '');

export const LANGGRAPH_API_BASE =
  trimTrailingSlash(import.meta.env.VITE_LANGGRAPH_API_BASE_URL || '') || '/api';

export const APP_API_BASE =
  trimTrailingSlash(import.meta.env.VITE_APP_API_BASE_URL || '') || '/api';

export function langGraphApi(path: string): string {
  return `${LANGGRAPH_API_BASE}${path.startsWith('/') ? path : `/${path}`}`;
}

export function appApi(path: string): string {
  return `${APP_API_BASE}${path.startsWith('/') ? path : `/${path}`}`;
}
