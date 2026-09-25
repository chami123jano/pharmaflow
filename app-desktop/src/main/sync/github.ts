/**
 * Carries the change log between machines using a private GitHub repository as
 * the drop box.
 *
 * The repo is only a place to leave files — no server runs anywhere, and a
 * private repo costs nothing. The GitHub REST API is used rather than the git
 * command line so the pharmacy PC does not need git installed.
 *
 * Layout inside the repo:
 *   sync/<device-id>.jsonl   one line per event, append-only
 *
 * Because a device only ever writes its own file, two devices never touch the
 * same path and there is nothing to merge.
 */
import log from '../log.js';

const API = 'https://api.github.com';

export interface RepoConfig {
  owner: string;
  repo: string;
  token: string;
  branch?: string;
}

interface FileState {
  content: string;
  sha: string | null;
}

function headers(token: string) {
  return {
    Authorization: 'Bearer ' + token,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'PharmaFlow-Sync',
  };
}

/** Parses "owner/repo", a full URL, or a .git URL into its parts. */
export function parseRepo(input: string): { owner: string; repo: string } | null {
  const s = (input || '').trim().replace(/\.git$/, '');
  if (!s) return null;
  const url = s.match(/github\.com[/:]([^/]+)\/([^/?#]+)/i);
  if (url) return { owner: url[1], repo: url[2] };
  const plain = s.match(/^([A-Za-z0-9-_.]+)\/([A-Za-z0-9-_.]+)$/);
  if (plain) return { owner: plain[1], repo: plain[2] };
  return null;
}

async function gh(cfg: RepoConfig, path: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(API + path, {
    ...init,
    headers: { ...headers(cfg.token), ...(init.headers || {}) },
  });
  return res;
}

/** Confirms the token works and the repo is reachable and writable. */
export async function checkAccess(cfg: RepoConfig): Promise<{ ok: boolean; error?: string; private?: boolean }> {
  try {
    const res = await gh(cfg, `/repos/${cfg.owner}/${cfg.repo}`);
    if (res.status === 401) return { ok: false, error: 'Token rejected. Check the token is correct and not expired.' };
    if (res.status === 404) return { ok: false, error: 'Repository not found, or the token cannot see it. It needs Contents: read and write.' };
    if (!res.ok) return { ok: false, error: `GitHub returned ${res.status}` };
    const body: any = await res.json();
    if (!body?.permissions?.push) return { ok: false, error: 'This token can read the repository but not write to it.' };
    return { ok: true, private: !!body.private };
  } catch (err: any) {
    return { ok: false, error: 'No connection to GitHub: ' + (err?.message || 'network error') };
  }
}

async function getFile(cfg: RepoConfig, path: string): Promise<FileState> {
  const ref = cfg.branch ? `?ref=${encodeURIComponent(cfg.branch)}` : '';
  const res = await gh(cfg, `/repos/${cfg.owner}/${cfg.repo}/contents/${path}${ref}`);
  if (res.status === 404) return { content: '', sha: null };
  if (!res.ok) throw new Error(`GitHub ${res.status} reading ${path}`);
  const body: any = await res.json();
  const content = Buffer.from(body.content || '', 'base64').toString('utf-8');
  return { content, sha: body.sha };
}

async function putFile(cfg: RepoConfig, path: string, content: string, sha: string | null, message: string): Promise<string> {
  const res = await gh(cfg, `/repos/${cfg.owner}/${cfg.repo}/contents/${path}`, {
    method: 'PUT',
    body: JSON.stringify({
      message,
      content: Buffer.from(content, 'utf-8').toString('base64'),
      ...(sha ? { sha } : {}),
      ...(cfg.branch ? { branch: cfg.branch } : {}),
    }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`GitHub ${res.status} writing ${path}: ${txt.slice(0, 200)}`);
  }
  const body: any = await res.json();
  return body?.content?.sha || '';
}

/** Lists the per-device log files present in the repo. */
export async function listDeviceFiles(cfg: RepoConfig): Promise<string[]> {
  const ref = cfg.branch ? `?ref=${encodeURIComponent(cfg.branch)}` : '';
  const res = await gh(cfg, `/repos/${cfg.owner}/${cfg.repo}/contents/sync${ref}`);
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`GitHub ${res.status} listing sync/`);
  const body: any = await res.json();
  if (!Array.isArray(body)) return [];
  return body.filter((f: any) => f.type === 'file' && f.name.endsWith('.jsonl')).map((f: any) => f.name);
}

/** Appends this device's new events to its own file. */
export async function pushEvents(cfg: RepoConfig, deviceId: string, lines: string[]): Promise<number> {
  if (!lines.length) return 0;
  const path = `sync/${deviceId}.jsonl`;
  const current = await getFile(cfg, path);
  const body = (current.content ? current.content.replace(/\s*$/, '') + '\n' : '') + lines.join('\n') + '\n';
  await putFile(cfg, path, body, current.sha, `sync: ${lines.length} event(s) from ${deviceId}`);
  log.info('[sync] pushed', lines.length, 'events as', deviceId);
  return lines.length;
}

/** Reads every other device's log. */
export async function pullEvents(cfg: RepoConfig, ownDeviceId: string): Promise<any[]> {
  const files = await listDeviceFiles(cfg);
  const out: any[] = [];
  for (const name of files) {
    if (name === `${ownDeviceId}.jsonl`) continue;
    const f = await getFile(cfg, `sync/${name}`);
    for (const line of f.content.split('\n')) {
      const s = line.trim();
      if (!s) continue;
      try { out.push(JSON.parse(s)); } catch { /* a torn line is skipped, not fatal */ }
    }
  }
  out.sort((a, b) => String(a.ts || '').localeCompare(String(b.ts || '')));
  return out;
}
