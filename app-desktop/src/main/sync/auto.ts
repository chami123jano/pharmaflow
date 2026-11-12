/**
 * Sync on its own.
 *
 * Sync used to run only when someone pressed "Sync now" in Settings. Nobody
 * did, and the website showed data six weeks old. Now it runs every few
 * minutes, and shortly after anything changes at the till, so the website is
 * never more than a few minutes behind while the PC is on.
 *
 * Kept free of imports so any module can ask for a sync without creating a
 * circular dependency: the sync IPC module registers the runner at startup.
 */
let runner: null | (() => Promise<any>) = null;
let inFlight: Promise<any> | null = null;
let soon: ReturnType<typeof setTimeout> | null = null;
let every: ReturnType<typeof setInterval> | null = null;

export function setSyncRunner(fn: () => Promise<any>) { runner = fn; }

let again = false;

/**
 * Runs a sync now, or joins the one already running — never two at once. A
 * request that arrives mid-run (a sale while uploading) earns one more run
 * afterwards, so that sale is not left waiting for the next five-minute tick.
 */
export function syncNow(): Promise<any> {
  if (!runner) return Promise.resolve({ ok: false, error: 'NOT_READY' });
  if (inFlight) { again = true; return inFlight; }
  inFlight = runner().catch((e) => ({ ok: false, error: e?.message || String(e) })).finally(() => {
    inFlight = null;
    if (again) { again = false; requestSync(2_000); }
  });
  return inFlight;
}

/**
 * Something changed: sync a little later. Repeated calls push the time back,
 * so a burst of work (a whole GRN, a busy minute at the counter) becomes one
 * upload rather than dozens.
 */
export function requestSync(delayMs = 20_000) {
  if (soon) clearTimeout(soon);
  soon = setTimeout(() => { soon = null; syncNow(); }, delayMs);
  (soon as any).unref?.();
}

export function startAutoSync(intervalMs = 5 * 60_000) {
  if (every) clearInterval(every);
  requestSync(30_000); // once shortly after opening, to pick up the home PC's changes
  every = setInterval(() => { syncNow(); }, intervalMs);
  (every as any).unref?.();
}
