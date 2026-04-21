import {
  initializeAdminUser,
  findByEmail,
  verifyPassword,
  hashPassword,
  createUser,
  createSession,
  destroySession,
  getSession,
  loadUsers,
  updateUserStatus,
  updatePasswordHash,
  updateUserProfile,
  refreshSession,
  toPublicUser,
} from './userStore';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function readBody(req: any): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk: Buffer) => { raw += chunk.toString(); });
    req.on('end', () => {
      try { resolve(JSON.parse(raw)); } catch { resolve({}); }
    });
    req.on('error', () => resolve({}));
  });
}

function json(res: any, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

function getBearerToken(req: any): string | null {
  const auth = String(req.headers['authorization'] || '');
  const m = auth.match(/^Bearer\s+(\S+)$/i);
  return m ? m[1] : null;
}

// ─── Plugin ───────────────────────────────────────────────────────────────────

export function authDevPlugin() {
  return {
    name: 'auth-dev-api',
    configureServer(server: any) {
      // Seed admin on startup
      const adminEmail = process.env.ADMIN_EMAIL || 'kaisenyao0817@gmail.com';
      const adminPassword = process.env.ADMIN_PASSWORD || 'admin';
      if (!process.env.ADMIN_PASSWORD) {
        console.warn(
          '[auth] ADMIN_PASSWORD not set in .env — using default "admin". Change it after first login.',
        );
      }
      initializeAdminUser(adminEmail, adminPassword);

      // ── GET /api/auth/verify ─────────────────────────────────────────────
      server.middlewares.use('/api/auth', (req: any, res: any, next: any) => {
        const urlPath = (req.url || '/').split('?')[0];
        if (req.method !== 'GET' || urlPath !== '/verify') return next();

        const token = getBearerToken(req);
        if (!token) return json(res, 401, { error: 'No token.' });

        const session = getSession(token);
        if (!session) return json(res, 401, { error: 'Session not found.' });

        return json(res, 200, { user: session });
      });

      // ── POST /api/signup ─────────────────────────────────────────────────
      server.middlewares.use('/api/signup', async (req: any, res: any, next: any) => {
        if (req.method !== 'POST') return next();

        const body = await readBody(req);
        const first_name = String(body.first_name || '').trim();
        const last_name  = String(body.last_name  || '').trim();
        const email      = String(body.email      || '').toLowerCase().trim();
        const password   = String(body.password   || '');

        if (!first_name || !last_name || !email || !password) {
          return json(res, 400, { error: 'All fields are required.' });
        }
        if (password.length > 1024) {
          return json(res, 400, { error: 'Password is too long.' });
        }
        if (password.length < 8) {
          return json(res, 400, { error: 'Password must be at least 8 characters.' });
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          return json(res, 400, { error: 'Invalid email address.' });
        }
        if (findByEmail(email)) {
          return json(res, 409, { error: 'An account with this email already exists.' });
        }

        createUser({ first_name, last_name, email, password });
        return json(res, 200, { ok: true });
      });

      // ── POST /api/login ──────────────────────────────────────────────────
      server.middlewares.use('/api/login', async (req: any, res: any, next: any) => {
        if (req.method !== 'POST') return next();

        const body = await readBody(req);
        const email    = String(body.email    || '').toLowerCase().trim();
        const password = String(body.password || '');

        if (!email || !password) {
          return json(res, 400, { error: 'Email and password are required.' });
        }
        if (password.length > 1024) {
          return json(res, 401, { error: 'Incorrect email or password.' });
        }

        const user = findByEmail(email);
        if (!user || !verifyPassword(password, user.password_hash)) {
          return json(res, 401, { error: 'Incorrect email or password.' });
        }

        if (user.status === 'pending') {
          return json(res, 403, { error: 'pending' });
        }
        if (user.status === 'rejected') {
          return json(res, 403, { error: 'rejected' });
        }

        const token = createSession(user);
        return json(res, 200, { token, user: toPublicUser(user) });
      });

      // ── POST /api/account/update-profile  ───────────────────────────────
      // ── POST /api/account/change-password ───────────────────────────────
      server.middlewares.use('/api/account', async (req: any, res: any, next: any) => {
        const urlPath = (req.url || '/').split('?')[0];
        if (req.method !== 'POST') return next();

        // ── update-profile ──────────────────────────────────────────────
        if (urlPath === '/update-profile') {
          const token = getBearerToken(req);
          if (!token) return json(res, 401, { error: 'Unauthorized.' });

          const session = getSession(token);
          if (!session) return json(res, 401, { error: 'Unauthorized.' });

          const body = await readBody(req);
          const first_name = String(body.first_name ?? '').trim();
          const last_name  = String(body.last_name  ?? '').trim();
          const newEmail   = String(body.email       ?? '').toLowerCase().trim();

          if (!first_name) {
            return json(res, 400, { error: 'First name is required.' });
          }
          if (newEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
            return json(res, 400, { error: 'Invalid email address.' });
          }

          const user = findByEmail(session.email);
          if (!user) return json(res, 404, { error: 'User not found.' });

          // Check email uniqueness only if it changed
          if (newEmail && newEmail !== user.email) {
            if (findByEmail(newEmail)) {
              return json(res, 409, { error: 'An account with this email already exists.' });
            }
          }

          const updated = updateUserProfile(user.id, first_name, last_name, newEmail || undefined);
          const pub = toPublicUser(updated!);
          // Keep session cache in sync so subsequent requests resolve the correct email
          const tok = getBearerToken(req)!;
          refreshSession(tok, pub);
          return json(res, 200, pub);
        }

        // ── change-password ─────────────────────────────────────────────
        if (urlPath !== '/change-password') return next();

        const token = getBearerToken(req);
        if (!token) return json(res, 401, { error: 'Unauthorized.' });

        const session = getSession(token);
        if (!session) return json(res, 401, { error: 'Unauthorized.' });

        const body = await readBody(req);
        const currentPassword = String(body.current_password || '');
        const newPassword     = String(body.new_password     || '');

        if (!currentPassword || !newPassword) {
          return json(res, 400, { error: 'Both current and new password are required.' });
        }
        if (currentPassword.length > 1024 || newPassword.length > 1024) {
          return json(res, 400, { error: 'Password is too long.' });
        }
        if (newPassword.length < 8) {
          return json(res, 400, { error: 'Password must be at least 8 characters.' });
        }

        const user = findByEmail(session.email);
        if (!user) return json(res, 404, { error: 'User not found.' });

        if (!verifyPassword(currentPassword, user.password_hash)) {
          return json(res, 400, { error: 'Current password is incorrect.' });
        }

        updatePasswordHash(user.id, hashPassword(newPassword));
        return json(res, 200, { ok: true });
      });

      // ── POST /api/logout ─────────────────────────────────────────────────
      server.middlewares.use('/api/logout', async (req: any, res: any, next: any) => {
        if (req.method !== 'POST') return next();
        const token = getBearerToken(req);
        if (token) destroySession(token);
        return json(res, 200, { ok: true });
      });

      // ── Admin endpoints: /api/admin/* ────────────────────────────────────
      // All admin routes require a valid session with role=admin.
      server.middlewares.use('/api/admin', async (req: any, res: any, next: any) => {
        const token = getBearerToken(req);
        if (!token) return json(res, 401, { error: 'Unauthorized.' });

        const session = getSession(token);
        if (!session || session.role !== 'admin') {
          return json(res, 403, { error: 'Forbidden.' });
        }

        // req.url has the /api/admin prefix stripped by Connect, e.g. "/users" or "/users/123/approve"
        const urlPath = (req.url || '/').split('?')[0];
        const qs = new URL(`http://localhost${req.url || '/'}`);

        // GET /api/admin/users[?status=pending]
        if (req.method === 'GET' && /^\/users\/?$/.test(urlPath)) {
          const statusFilter = qs.searchParams.get('status');
          const users = loadUsers();
          const result = statusFilter
            ? users.filter(u => u.status === statusFilter)
            : users;
          return json(res, 200, result.map(toPublicUser));
        }

        // POST /api/admin/users/:id/approve  |  /users/:id/reject  |  /users/:id/pend
        const actionMatch = urlPath.match(/^\/users\/([^/]+)\/(approve|reject|pend)$/);
        if (req.method === 'POST' && actionMatch) {
          const [, id, action] = actionMatch;
          const status = action === 'approve' ? 'approved' : action === 'pend' ? 'pending' : 'rejected';
          const updated = updateUserStatus(id, status);
          if (!updated) return json(res, 404, { error: 'User not found.' });
          return json(res, 200, toPublicUser(updated));
        }

        return next();
      });
    },
  };
}
