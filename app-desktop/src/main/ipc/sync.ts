/**
 * Sync configuration and the sync run itself.
 *
 * Two transports, one interface. The GitHub one carries the change log between
 * two machines and nothing else. The Supabase one carries the same log *and*
 * pushes readable rows up, so the website can answer while the shop PC is off.
 * Only one is active at a time — `sync.provider` decides which.
 *
 * Secrets are encrypted with Electron's safeStorage (OS-backed) and only ever
 * leave this process as a yes/no — never returned to the renderer, never
 * written to the log.
 */
import { ipcMain, safeStorage } from 'electron';
import { getDb } from '../db/index.js';
import log from '../log.js';
import { getDeviceId, getDeviceLabel, unpushedEvents, markPushed, applyEvent } from '../sync/events.js';
import { checkAccess, parseRepo, pushEvents, pullEvents, type RepoConfig } from '../sync/github.js';
import * as cloud from '../sync/supabase.js';
import { buildSnapshot } from '../sync/snapshot.js';

type Provider = 'github' | 'supabase';

function setSetting(key: string, value: string) {
  getDb().prepare('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)').run(key, value);
}
function getSetting(key: string): string {
  try {
    const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key) as any;
    return row?.value || '';
  } catch { return ''; }
}

function storeSecret(key: string, secret: string) {
  if (!secret) { setSetting(key, ''); return; }
  try {
    if (safeStorage.isEncryptionAvailable()) {
      setSetting(key, 'enc:' + safeStorage.encryptString(secret).toString('base64'));
      return;
    }
  } catch {}
  // Without OS encryption the secret still has to be usable; mark it so the UI
  // can warn that it is stored in plain text.
  setSetting(key, 'raw:' + secret);
}

function readSecret(key: string): string {
  const v = getSetting(key);
  if (!v) return '';
  if (v.startsWith('enc:')) {
    try { return safeStorage.decryptString(Buffer.from(v.slice(4), 'base64')); } catch { return ''; }
  }
  if (v.startsWith('raw:')) return v.slice(4);
  return v;
}

function provider(): Provider {
  return getSetting('sync.provider') === 'supabase' ? 'supabase' : 'github';
}

function repoConfig(): RepoConfig | null {
  const owner = getSetting('sync.owner');
  const repo = getSetting('sync.repo');
  const token = readSecret('sync.token');
  if (!owner || !repo || !token) return null;
  return { owner, repo, token, branch: getSetting('sync.branch') || undefined };
}

function cloudConfig(): cloud.CloudConfig | null {
  const url = getSetting('cloud.url');
  const serviceKey = readSecret('cloud.key');
  if (!url || !serviceKey) return null;
  return { url, serviceKey };
}

/** Is the *currently selected* transport ready to run? */
function configured(): boolean {
  return provider() === 'supabase' ? !!cloudConfig() : !!repoConfig();
}

ipcMain.handle('sync:status', () => {
  const db = getDb();
  let pending = 0;
  try { pending = (db.prepare('SELECT COUNT(1) AS c FROM sync_events WHERE pushed = 0').get() as any)?.c || 0; } catch {}
  const token = getSetting('sync.token');
  const key = getSetting('cloud.key');
  return {
    ok: true,
    data: {
      provider: provider(),
      configured: configured(),
      owner: getSetting('sync.owner'),
      repo: getSetting('sync.repo'),
      cloudUrl: getSetting('cloud.url'),
      cloudConfigured: !!cloudConfig(),
      cloudKeyEncrypted: key.startsWith('enc:'),
      hasCloudKey: !!key,
      deviceId: getDeviceId(),
      deviceLabel: getDeviceLabel(),
      pending,
      lastSync: getSetting('sync.last_run'),
      lastResult: getSetting('sync.last_result'),
      lastSnapshot: getSetting('cloud.last_snapshot'),
      tokenEncrypted: token.startsWith('enc:'),
      hasToken: !!token,
    },
  };
});

/** Switches which transport `sync:run` uses. Both stay configured. */
ipcMain.handle('sync:setProvider', (_e, name: string) => {
  const p: Provider = name === 'supabase' ? 'supabase' : 'github';
  setSetting('sync.provider', p);
  return { ok: true, data: { provider: p, configured: configured() } };
});

ipcMain.handle('sync:configure', async (_e, payload: { repo: string; token?: string; label?: string; branch?: string }) => {
  const parsed = parseRepo(payload?.repo || '');
  if (!parsed) return { ok: false, error: 'Enter the repository as owner/name, for example your-github-name/pharmacy-sync' };

  // Check the candidate before saving it. A token that has just been refused
  // must not be left behind as "saved" — the next attempt would silently reuse
  // a token we already know is bad.
  const token = payload.token?.trim() || readSecret('sync.token');
  if (!token) return { ok: false, error: 'A GitHub token is required' };

  const cfg: RepoConfig = { ...parsed, token, branch: payload.branch || undefined };
  const access = await checkAccess(cfg);
  if (!access.ok) return { ok: false, error: access.error };

  storeSecret('sync.token', token);
  setSetting('sync.owner', parsed.owner);
  setSetting('sync.repo', parsed.repo);
  setSetting('sync.provider', 'github');
  if (payload.branch) setSetting('sync.branch', payload.branch);
  if (payload.label) setSetting('sync.device_label', payload.label);
  getDeviceId();

  return { ok: true, data: { owner: parsed.owner, repo: parsed.repo, private: access.private } };
});

/**
 * Connects the cloud mirror.
 *
 * The key is checked against the live project before anything is saved, so a
 * mistyped key fails here with a readable message rather than silently at 2am
 * during a sync run.
 */
ipcMain.handle('sync:configureCloud', async (_e, payload: { url: string; key?: string; label?: string }) => {
  const url = cloud.parseProjectUrl(payload?.url || '');
  if (!url) {
    return { ok: false, error: 'Enter the Project URL from Supabase → Settings → API, like https://abcdefgh.supabase.co' };
  }

  // Same rule as GitHub: nothing is written until the project has accepted it.
  const serviceKey = payload.key?.trim() || readSecret('cloud.key');
  if (!serviceKey) return { ok: false, error: 'The service_role key is required' };

  const access = await cloud.checkAccess({ url, serviceKey });
  if (!access.ok) return { ok: false, error: access.message || access.error };

  storeSecret('cloud.key', serviceKey);
  setSetting('cloud.url', url);
  setSetting('sync.provider', 'supabase');
  if (payload.label) setSetting('sync.device_label', payload.label);

  const device = getDeviceId();
  await cloud.announceDevice({ url, serviceKey }, device, getDeviceLabel());

  return { ok: true, data: { url } };
});

ipcMain.handle('sync:disconnect', (_e, which?: string) => {
  if (which === 'cloud') {
    for (const k of ['cloud.url', 'cloud.key', 'cloud.last_snapshot', 'cloud.sales_watermark', 'cloud.pull_cursor']) setSetting(k, '');
    setSetting('sync.provider', 'github');
  } else if (which === 'github') {
    for (const k of ['sync.owner', 'sync.repo', 'sync.token', 'sync.branch']) setSetting(k, '');
  } else {
    // No argument: the old behaviour, which only ever meant GitHub.
    for (const k of ['sync.owner', 'sync.repo', 'sync.token', 'sync.branch']) setSetting(k, '');
  }
  return { ok: true };
});

/**
 * Sync without internet: hand the events over as a file.
 *
 * Export produces the same JSONL the repository would carry, so it can travel
 * on a USB stick or through a messaging app when the shop has no connection.
 */
ipcMain.handle('sync:exportEvents', () => {
  const out = unpushedEvents();
  const content = out.map((e) => JSON.stringify(e)).join('\n') + (out.length ? '\n' : '');
  return {
    ok: true,
    data: {
      filename: `pharmaflow-${getDeviceId()}-${new Date().toISOString().slice(0, 10)}.jsonl`,
      content,
      count: out.length,
      ids: out.map((e) => e.id),
    },
  };
});

/** Marks exported events as sent, once the renderer confirms the file saved. */
ipcMain.handle('sync:markExported', (_e, ids: string[]) => {
  markPushed(Array.isArray(ids) ? ids : []);
  return { ok: true };
});

ipcMain.handle('sync:importEvents', (_e, content: string) => {
  if (!content || typeof content !== 'string') return { ok: false, error: 'Nothing to import' };
  const device = getDeviceId();
  let applied = 0, skipped = 0, malformed = 0, own = 0;

  const events: any[] = [];
  for (const line of content.split('\n')) {
    const s = line.trim();
    if (!s) continue;
    try { events.push(JSON.parse(s)); } catch { malformed++; }
  }
  events.sort((a, b) => String(a.ts || '').localeCompare(String(b.ts || '')));

  for (const ev of events) {
    // Our own events coming back must never be re-applied — that would double
    // every stock movement this device already made.
    if (ev?.device === device) { own++; continue; }
    try {
      const r = applyEvent(ev);
      if (r) applied++; else skipped++;
    } catch (err: any) {
      log.error('[sync] import could not apply', ev?.id, err?.message);
      skipped++;
    }
  }
  setSetting('sync.last_run', new Date().toISOString());
  setSetting('sync.last_result', `imported ${applied} from file`);
  log.info('[sync] file import:', { applied, skipped, malformed, own });
  return { ok: true, data: { applied, skipped, malformed, own } };
});

/** Replays a batch of incoming events, counting rather than throwing. */
function applyIncoming(events: any[]): { applied: number; skipped: number } {
  let applied = 0, skipped = 0;
  for (const ev of events) {
    try {
      const r = applyEvent(ev);
      if (r) applied++; else skipped++;
    } catch (err: any) {
      log.error('[sync] could not apply event', ev?.id, err?.message);
      skipped++;
    }
  }
  return { applied, skipped };
}

async function runGithub() {
  const cfg = repoConfig();
  if (!cfg) return { ok: false as const, error: 'GitHub sync is not set up yet' };
  const device = getDeviceId();

  const incoming = await pullEvents(cfg, device);
  const { applied, skipped } = applyIncoming(incoming);

  let pushed = 0;
  const out = unpushedEvents();
  if (out.length) {
    pushed = await pushEvents(cfg, device, out.map((e) => JSON.stringify(e)));
    markPushed(out.map((e) => e.id));
  }
  return { ok: true as const, data: { applied, pushed, skipped } };
}

/**
 * Cloud run: the change log both ways, then the readable rows upward.
 *
 * The snapshot goes last on purpose. It is the part the website reads, and it
 * should reflect the events we just applied — otherwise the phone would show a
 * stock figure one sync behind the till.
 */
async function runCloud() {
  const cfg = cloudConfig();
  if (!cfg) return { ok: false as const, error: 'Cloud sync is not set up yet' };
  const device = getDeviceId();

  const cursor = getSetting('cloud.pull_cursor') || undefined;
  const incoming = await cloud.pullEvents(cfg, device, cursor);
  const { applied, skipped } = applyIncoming(incoming);
  // Only advance the cursor once the batch is in. A crash mid-batch re-reads
  // it next time, which the ledger dedupes.
  if (incoming.length) setSetting('cloud.pull_cursor', incoming[incoming.length - 1].ts);

  let pushed = 0;
  const out = unpushedEvents();
  if (out.length) {
    pushed = await cloud.pushEvents(cfg, device, out);
    markPushed(out.map((e) => e.id));
  }

  const watermark = getSetting('cloud.sales_watermark') || null;
  const snap = buildSnapshot(getDb(), device, watermark);
  await cloud.pushSnapshot(cfg, snap);
  // Only move the watermark after the rows are accepted, so a failed upload is
  // retried rather than skipped.
  if (snap.newestSale) setSetting('cloud.sales_watermark', snap.newestSale);
  setSetting('cloud.last_snapshot', new Date().toISOString());

  await cloud.announceDevice(cfg, device, getDeviceLabel());

  return { ok: true as const, data: { applied, pushed, skipped, sales: snap.sales.length, products: snap.products.length } };
}

/**
 * Pull first, then push. Applying other devices' work before sending our own
 * means a failure part-way still leaves this machine strictly more up to date,
 * never less.
 */
ipcMain.handle('sync:run', async () => {
  if (!configured()) return { ok: false, error: 'Sync is not set up yet' };

  try {
    const r = provider() === 'supabase' ? await runCloud() : await runGithub();
    if (!r.ok) return r;

    const d: any = r.data;
    const summary = d.sales !== undefined
      ? `applied ${d.applied}, sent ${d.pushed}, mirrored ${d.sales} sales`
      : `applied ${d.applied}, sent ${d.pushed}`;
    setSetting('sync.last_run', new Date().toISOString());
    setSetting('sync.last_result', summary);
    log.info('[sync] run complete:', summary, d.skipped ? `(${d.skipped} already known)` : '');
    return { ok: true, data: d };
  } catch (err: any) {
    // Never swallow a thrown string — that is how a real fault became the
    // useless words "Sync failed" instead of saying what broke.
    const msg = err?.message || (typeof err === 'string' ? err : '') || 'Sync failed';
    setSetting('sync.last_result', 'failed: ' + msg);
    log.error('[sync] run failed', msg);
    return { ok: false, error: msg };
  }
});
