import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

// Resolved relative to project root (where `vite` is run from)
const DATA_FILE = path.join(process.cwd(), 'server', 'data', 'users.json');

// ─── Types ────────────────────────────────────────────────────────────────────

export interface User {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  password_hash: string;
  status: 'pending' | 'approved' | 'rejected';
  role: 'user' | 'admin';
  created_at: string;
  updated_at: string;
}

/** User record safe to send to the client (no sensitive fields). */
export type PublicUser = Omit<User, 'password_hash'>;

// ─── Password hashing (Node crypto — no extra deps) ───────────────────────────

const ITERATIONS = 100_000;
const KEYLEN = 64;
const DIGEST = 'sha512';

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto
    .pbkdf2Sync(password, salt, ITERATIONS, KEYLEN, DIGEST)
    .toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const derived = crypto
    .pbkdf2Sync(password, salt, ITERATIONS, KEYLEN, DIGEST)
    .toString('hex');
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(derived, 'hex');
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

// ─── File I/O ─────────────────────────────────────────────────────────────────

function ensureDir(): void {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export function loadUsers(): User[] {
  ensureDir();
  if (!fs.existsSync(DATA_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) as User[];
  } catch {
    return [];
  }
}

export function saveUsers(users: User[]): void {
  ensureDir();
  // Strip any legacy session_token fields that may exist in old records on disk
  const clean = (users as any[]).map(({ session_token: _st, ...u }) => u);
  fs.writeFileSync(DATA_FILE, JSON.stringify(clean, null, 2), 'utf8');
}

export function toPublicUser(u: User): PublicUser {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { password_hash: _ph, ...pub } = u;
  return pub;
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

export function findByEmail(email: string): User | undefined {
  return loadUsers().find(u => u.email === email.toLowerCase().trim());
}

export function findById(id: string): User | undefined {
  return loadUsers().find(u => u.id === id);
}

export function createUser(data: {
  first_name: string;
  last_name: string;
  email: string;
  password: string;
}): User {
  const users = loadUsers();
  const now = new Date().toISOString();
  const user: User = {
    id: crypto.randomUUID(),
    first_name: data.first_name.trim(),
    last_name: data.last_name.trim(),
    email: data.email.toLowerCase().trim(),
    password_hash: hashPassword(data.password),
    status: 'approved',
    role: 'user',
    created_at: now,
    updated_at: now,
  };
  users.push(user);
  saveUsers(users);
  return user;
}

export function updateUserStatus(
  id: string,
  status: 'approved' | 'rejected' | 'pending',
): User | null {
  const users = loadUsers();
  const idx = users.findIndex(u => u.id === id);
  if (idx === -1) return null;
  users[idx].status = status;
  users[idx].updated_at = new Date().toISOString();
  saveUsers(users);
  return users[idx];
}

export function updateUserProfile(
  id: string,
  first_name: string,
  last_name: string,
  email?: string,
): User | null {
  const users = loadUsers();
  const idx = users.findIndex(u => u.id === id);
  if (idx === -1) return null;
  users[idx].first_name = first_name.trim();
  users[idx].last_name = last_name.trim();
  if (email) {
    users[idx].email = email.toLowerCase().trim();
  }
  users[idx].updated_at = new Date().toISOString();
  saveUsers(users);
  return users[idx];
}

export function updatePasswordHash(id: string, passwordHash: string): boolean {
  const users = loadUsers();
  const idx = users.findIndex(u => u.id === id);
  if (idx === -1) return false;
  users[idx].password_hash = passwordHash;
  users[idx].updated_at = new Date().toISOString();
  saveUsers(users);
  return true;
}

// ─── Admin seeding ────────────────────────────────────────────────────────────

export function initializeAdminUser(email: string, password: string): void {
  const users = loadUsers();
  if (users.some(u => u.role === 'admin')) return; // at least one admin exists — skip seeding
  const normalized = email.toLowerCase().trim();
  const now = new Date().toISOString();
  users.push({
    id: crypto.randomUUID(),
    first_name: 'Admin',
    last_name: '',
    email: normalized,
    password_hash: hashPassword(password),
    status: 'approved',
    role: 'admin',
    created_at: now,
    updated_at: now,
  });
  saveUsers(users);
  console.log(`[auth] Admin user seeded: ${normalized}`);
}

// ─── Session store (in-memory only) ──────────────────────────────────────────
// Sessions are never written to disk. All users must re-authenticate after a
// dev server restart. This keeps users.json free of sensitive token data.

const sessionCache = new Map<string, PublicUser>();

export function createSession(user: User): string {
  const token = crypto.randomBytes(32).toString('hex');
  sessionCache.set(token, toPublicUser(user));
  return token;
}

export function getSession(token: string): PublicUser | undefined {
  return sessionCache.get(token);
}

export function destroySession(token: string): void {
  sessionCache.delete(token);
}

/** Refresh the cached PublicUser for a token — call after any mutation that changes user fields. */
export function refreshSession(token: string, updated: PublicUser): void {
  if (sessionCache.has(token)) sessionCache.set(token, updated);
}

