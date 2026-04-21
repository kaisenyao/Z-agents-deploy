import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { appApi } from '../lib/apiBase';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AuthUser {
  id?: string;
  email: string;
  first_name?: string;
  last_name?: string;
  role: string;
  status: string;
}

interface AuthContextValue {
  token: string | null;
  user: AuthUser | null;
  /** Derived from user.email — kept for backward compat (ProtectedRoute, AccountSettings, Navigation). */
  email: string | null;
  login: (token: string, user: AuthUser) => void;
  logout: () => void;
  updateUser: (fields: Partial<AuthUser>) => void;
}

// ─── Storage keys ─────────────────────────────────────────────────────────────

const TOKEN_KEY = 'clearpath_auth_token';
const USER_KEY  = 'clearpath_auth_user';

function loadStoredUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as AuthUser) : null;
  } catch {
    return null;
  }
}

// ─── Context ──────────────────────────────────────────────────────────────────

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(
    () => localStorage.getItem(TOKEN_KEY),
  );
  const [user, setUser] = useState<AuthUser | null>(loadStoredUser);

  // On mount: verify the stored token is still valid server-side.
  // If not (e.g. after a server restart that wiped the session cache before
  // persistent tokens were introduced), clear the orphaned token so the user
  // is prompted to log in again — which will write a fresh session_token to
  // users.json and allow subsequent account updates to persist.
  useEffect(() => {
    const storedToken = localStorage.getItem(TOKEN_KEY);
    if (!storedToken) return;
    fetch(appApi('/auth/verify'), {
      headers: { Authorization: `Bearer ${storedToken}` },
    })
      .then(r => {
        if (!r.ok) {
          localStorage.removeItem(TOKEN_KEY);
          localStorage.removeItem(USER_KEY);
          setToken(null);
          setUser(null);
        }
      })
      .catch(() => { /* network error — keep session */ });
  }, []);

  const login = (newToken: string, newUser: AuthUser) => {
    localStorage.setItem(TOKEN_KEY, newToken);
    localStorage.setItem(USER_KEY, JSON.stringify(newUser));
    setToken(newToken);
    setUser(newUser);
  };

  const updateUser = (fields: Partial<AuthUser>) => {
    setUser(prev => {
      if (!prev) return prev;
      const updated = { ...prev, ...fields };
      localStorage.setItem(USER_KEY, JSON.stringify(updated));
      return updated;
    });
  };

  const logout = () => {
    // Best-effort server-side session cleanup
    const t = localStorage.getItem(TOKEN_KEY);
    if (t) {
      fetch(appApi('/logout'), {
        method: 'POST',
        headers: { Authorization: `Bearer ${t}` },
      }).catch(() => { /* ignore */ });
    }
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    setToken(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider
      value={{ token, user, email: user?.email ?? null, login, logout, updateUser }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
