import { ipcMain } from 'electron';
import { getDb, ensureSchema } from '../db/index.js';
import log from '../log.js';
import { verifyPassword, hashPassword } from '../auth/password.js';
import { randomUUID } from 'crypto';

interface Session { token: string; userId: string; createdAt: number; }
const sessions = new Map<string, Session>();

function createToken(userId: string) {
  const token = randomUUID();
  sessions.set(token, { token, userId, createdAt: Date.now() });
  return token;
}

/**
  * Accepts a username or an email.
  *
  * The till asks for a username, but anyone who learned the email still gets
  * in, and the website uses emails throughout. Matching either costs one extra
  * comparison and avoids splitting the two apps' logins.
  */
function findUser(db: any, who: string) {
  const key = String(who || '').trim().toLowerCase();
  if (!key) return null;
  return db.prepare('SELECT * FROM users WHERE lower(username) = ? OR lower(email) = ?').get(key, key);
}

ipcMain.handle('auth:login', async (_e, email: string, password: string) => {
  try {
    const db = getDb();
    try { await ensureSchema(); } catch {}
    let user: any;
    try {
      user = findUser(db, email);
    } catch (err: any) {
      if ((err?.message||'').includes('no such table')) {
        await ensureSchema();
        user = findUser(db, email);
      } else throw err;
    }
    if (!user) return { ok: false, error: 'INVALID_CREDENTIALS' };
    const valid = await verifyPassword(user.password_hash, password);
    if (!valid) return { ok: false, error: 'INVALID_CREDENTIALS' };
    const token = createToken(user.id);
    return { ok: true, token, user: { id: user.id, email: user.email, username: user.username,
      role: user.role, name: user.name || user.username || user.email.split('@')[0] } };
  } catch (err: any) {
    log.error('[Auth] login error', err);
    return { ok: false, error: 'LOGIN_ERROR', message: err?.message || 'Unexpected error' };
  }
});

/**
 * Creates an account from a username; an email is optional.
 *
 * A cashier does not necessarily have an email and should not need one to be
 * given a till login. The column is NOT NULL from the original schema, so one
 * is synthesised as <username>@local when none is given — invisible, and it
 * keeps the constraint honest without a table rebuild.
 */
ipcMain.handle('auth:register', async (_e, username: string, password: string, role = 'clerk', name?: string, email?: string) => {
  const db = getDb();
  const uname = String(username || '').trim().toLowerCase();
  if (!uname) return { ok: false, error: 'A username is required' };
  if (!password || password.length < 4) return { ok: false, error: 'PASSWORD_TOO_SHORT' };

  const mail = String(email || '').trim().toLowerCase() || `${uname}@local`;
  if (db.prepare('SELECT 1 FROM users WHERE lower(username) = ?').get(uname)) {
    return { ok: false, error: `The username "${uname}" is already taken` };
  }
  if (db.prepare('SELECT 1 FROM users WHERE lower(email) = ?').get(mail)) {
    return { ok: false, error: `The email "${mail}" is already in use` };
  }

  const hash = await hashPassword(password);
  const id = randomUUID();
  const displayName = name || uname;
  db.prepare('INSERT INTO users (id,email,username,password_hash,role,name,created_at) VALUES (?,?,?,?,?,?,?)')
    .run(id, mail, uname, hash, role || 'clerk', displayName, new Date().toISOString());
  const token = createToken(id);
  return { ok: true, token, user: { id, email: mail, username: uname, role, name: displayName } };
});

ipcMain.handle('auth:me', (_e, token: string) => {
  const s = sessions.get(token);
  if (!s) return { ok: false, error: 'UNAUTHORIZED' };
  const db = getDb();
  const user = db.prepare('SELECT id,email,username,role,name FROM users WHERE id = ?').get(s.userId) as any;
  if (!user) return { ok: false, error: 'UNAUTHORIZED' };
  return { ok: true, user: { ...user, name: user.name || user.username || user.email.split('@')[0] } };
});

ipcMain.handle('auth:list', () => {
  const db = getDb();
  const users = db.prepare('SELECT id,email,username,role,name,created_at FROM users ORDER BY email').all();
  return { ok: true, data: users };
});

ipcMain.handle('auth:update', async (_e, id: string, patch: any) => {
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as any;
  if (!user) return { ok: false, error: 'NOT_FOUND' };
  try {
    if (patch.name !== undefined) db.prepare('UPDATE users SET name=? WHERE id=?').run(patch.name, id);
    if (patch.role !== undefined) db.prepare('UPDATE users SET role=? WHERE id=?').run(patch.role, id);

    // Both identifiers are editable. A clash is reported in plain words rather
    // than as a constraint error, because the person reading it is a shopkeeper.
    if (patch.username !== undefined) {
      const uname = String(patch.username || '').trim().toLowerCase();
      if (!uname) return { ok: false, error: 'A username is required' };
      const taken = db.prepare('SELECT id FROM users WHERE lower(username) = ? AND id <> ?').get(uname, id);
      if (taken) return { ok: false, error: `The username "${uname}" is already taken` };
      db.prepare('UPDATE users SET username=? WHERE id=?').run(uname, id);
    }
    if (patch.email !== undefined) {
      const mail = String(patch.email || '').trim().toLowerCase();
      if (!mail) return { ok: false, error: 'An email is required' };
      const taken = db.prepare('SELECT id FROM users WHERE lower(email) = ? AND id <> ?').get(mail, id);
      if (taken) return { ok: false, error: `The email "${mail}" is already in use` };
      db.prepare('UPDATE users SET email=? WHERE id=?').run(mail, id);
    }
    if (patch.password && patch.password.length >= 4) {
      const hash = await hashPassword(patch.password);
      db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hash, id);
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'UPDATE_FAILED' };
  }
});

ipcMain.handle('auth:delete', (_e, id: string) => {
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as any;
  if (!user) return { ok: false, error: 'NOT_FOUND' };
  // Only protect the original admin@local admin account (not staff users with same email)
  if (user.email === 'admin@local' && user.role === 'admin') return { ok: false, error: 'CANNOT_DELETE_SUPER_ADMIN' };
  const admins = db.prepare("SELECT COUNT(*) as c FROM users WHERE role = 'admin'").get() as any;
  if (user.role === 'admin' && Number(admins?.c || 0) <= 1) return { ok: false, error: 'LAST_ADMIN' };
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  return { ok: true };
});

/**
 * Checks a password against any admin account, for approving something at the
 * counter — a discount above the allowed limit, or selling expired stock.
 *
 * Which admin matched is deliberately not revealed to the renderer beyond the
 * name recorded on the sale, and repeated failures are slowed down so the
 * password cannot be guessed at the till.
 */
let approvalFailures = 0;
let approvalBlockedUntil = 0;

ipcMain.handle('auth:verifyAdmin', async (_e, password: string) => {
  if (Date.now() < approvalBlockedUntil) {
    const secs = Math.ceil((approvalBlockedUntil - Date.now()) / 1000);
    return { ok: false, error: 'LOCKED', message: `Too many attempts. Wait ${secs} seconds.` };
  }
  if (!password) return { ok: false, error: 'NO_PASSWORD' };

  const db = getDb();
  const admins = db.prepare("SELECT id, email, name, password_hash FROM users WHERE role = 'admin'").all() as any[];
  for (const a of admins) {
    if (await verifyPassword(a.password_hash, password)) {
      approvalFailures = 0;
      log.info('[Auth] admin approval granted', { by: a.email });
      return { ok: true, data: { id: a.id, name: a.name || a.email } };
    }
  }

  approvalFailures++;
  if (approvalFailures >= 5) {
    approvalBlockedUntil = Date.now() + 30000;
    approvalFailures = 0;
    return { ok: false, error: 'LOCKED', message: 'Too many attempts. Wait 30 seconds.' };
  }
  return { ok: false, error: 'WRONG_PASSWORD', message: 'That is not an admin password.' };
});
