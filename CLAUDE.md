# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

All commands run from `app-desktop/`:

```bash
npm run dev        # doctor + build main/preload + Vite + Electron
npm run build      # Bundle main + preload (esbuild) and renderer (vite) → dist/
npm run doctor     # Repair a corrupted local electron install
npm run package    # Build then package as Windows .exe via electron-builder
```

`npm run dev` runs `scripts/doctor.mjs` first. Three things have silently broken
startup before and it detects all three: a hand-patched
`node_modules/electron/index.js`, a stale `app.asar` planted in
`node_modules/electron/dist/resources/` (Electron prefers it over the CLI path),
and `ELECTRON_RUN_AS_NODE=1` inherited from VS Code's terminal, which makes
`electron.exe` run as plain Node.

**Build output must be CJS with explicit `.cjs` extensions.** `package.json` sets
`"type": "module"`, so a `.js` file in `dist/` is loaded as ESM. This previously
broke the preload silently: it threw on load, `contextBridge` never ran,
`window.api` was undefined, and since the renderer calls it as
`window.api?.x?.()`, every action failed with no error.

Dev opens DevTools only when `OPEN_DEVTOOLS=1` env var is set.

Default login: `admin@local` / `admin123` (seeded automatically on first run).

## Architecture

### Two-process Electron model

```
src/main/          ← Node.js process (never bundled by Vite)
src/preload/       ← Bridge between main and renderer
src/renderer/      ← Vite + React SPA
dist/              ← Compiled output (gitignored in production)
```

**Data flow for every UI action:**
`React component → window.api.*(…) → ipcRenderer.invoke → ipcMain.handle → SQLite → { ok, data?, error? }`

All IPC handlers return `{ ok: boolean; data?: any; error?: string }`. Never throw across the IPC boundary — always return `{ ok: false, error }`.

### Database layer

SQLite runs via **sql.js WASM** (not better-sqlite3). The wrapper in `src/main/db/sqlite-wasm.ts` exposes a better-sqlite3-compatible interface (`prepare/run/get/all/transaction`) and auto-persists to disk after every write by calling `db.export()` → `fs.writeFileSync`.

Schema is created programmatically in `src/main/db/index.ts → ensureSchema()` which runs on startup. There is no migration runner — new optional columns are added lazily via `ALTER TABLE ADD COLUMN` in IPC handlers (see `ensureProductExtraColumns()` in `ipc/products.ts`). The staging restore mechanism (`pharmaflow.db.restore`) is applied on the next `initDb()` call before the DB opens.

DB file location: `app.getPath('userData')/pharmaflow.db`

### Preload API surface (`src/preload/index.ts`)

`window.api` is the only way the renderer accesses backend functionality. It is typed on `Window` in the same file. The full API groups are: `auth`, `products`, `sales`, `pos`, `sync`, `reports`, `settings`, `admin`, `util`, `dev`.

### Batches and expiry (`src/main/db/batches.ts`)

A product's stock is the **sum of its batches**, one row per delivery, so the
same medicine can sit on the shelf under several expiry dates at once.
`products.stock` is a cache recomputed by `recomputeStock()` after every change
— the POS, reports and stock badges read it and never need to know about
batches.

Allocation is **FEFO — first expired, first out**: soonest expiry leaves first,
so stock does not quietly go out of date. This is expiry order, not delivery
order. Batches with no expiry date sort last, behind everything dated.

- `planAllocation()` decides which batches cover a quantity and **throws rather
  than partially filling**, so a sale that cannot be covered fails before any
  stock moves. `applyAllocation()` then writes it.
- One bill line can become **several `sale_items`** when it spans two batches.
  Price does not vary by batch, so the money is unaffected by the split.
- `sale_items.batch_id` records where each part came from, which is what lets a
  void put the quantity back in the right batch.
- **Expired stock is refused for cashiers and allowed for admins.** The role is
  read from the database in `sales:create`, never taken from the renderer.

Sync carries `batch_id` on every `stock.delta`, and reuses the id verbatim, so
the same physical delivery is identifiable on both machines. A negative delta
for an unknown batch falls back to FEFO locally: the totals still agree even
when the split cannot.

Existing stock is migrated once into a single `OPENING` batch, guarded by the
`batches.migrated` setting.

### Sync between two machines (`src/main/sync/`)

Shop and home each run the full app offline; neither is authoritative. Each
records what it did and replays what the other did.

There are **two transports and one setting deciding which runs** —
`sync.provider`, `github` or `supabase`. Both stay configured; only the selected
one runs. `ipc/sync.ts` dispatches to `runGithub()` or `runCloud()`.

- **`github.ts`** — a private repo used as a mailbox (REST API, so git need not
  be installed). Carries the change log and nothing else.
- **`supabase.ts`** — the same change log over PostgREST, *plus* `pushSnapshot`,
  which mirrors readable rows (products, batches, sales, people) so the website
  can answer while the shop PC is off. `snapshot.ts` builds those rows and
  denormalises cashier and product names, because the phone should not have to
  join. Sales go from the `cloud.sales_watermark` watermark, not wholesale.
  Cloud tables and their RLS policies live in `supabase/schema.sql`.

Either way an exported `.jsonl` file still works when there is no internet.

**Credentials are checked before they are stored.** `sync:configure` and
`sync:configureCloud` both validate the candidate secret against the live
service and only call `storeSecret` once it is accepted — otherwise a refused
key is left behind reading as "saved" and the next attempt silently reuses it.
The service_role key is desktop-only; the website gets the anon key and a login.

Three rules keep it correct — do not break them:

1. **A device only ever appends to its own file** (`sync/<device-id>.jsonl`), so
   two devices never write the same path and there is nothing to merge.
2. **Stock never travels as an absolute number**, only as `stock.delta`. A sale
   at the shop and a restock from home must both land; last-write-wins on a
   stock column would erase one. `product.upsert` deliberately carries no stock.
3. **Every event has a unique id and is applied at most once** (`sync_applied`),
   so syncing twice is harmless. Events whose `device` is our own are skipped.

`recordEvent` resolves the device id *before* opening its insert — on a fresh
database that call writes to `settings`, and starting a nested write mid-insert
upsets the sql.js wrapper.

### Auth / Sessions

Sessions are an in-memory `Map<token, Session>` in `src/main/ipc/auth.ts` — they are lost when the app restarts. The renderer persists the token in `localStorage` and re-validates it via `auth:me` on boot (`src/renderer/src/lib/auth.tsx`). `AuthContext` (`useAuth()` hook) provides `user`, `token`, `login`, `logout` to all components.

### Renderer routing

Routing is manual — `App.tsx` holds a `page` string state and renders the correct route component via `switch`. There is no React Router `<Route>` — the `HashRouter` in `main.tsx` is present but currently unused for routing. Navigation is driven by `setPage(key)` calls from the nav bar.

### Cross-component refresh

When data changes (e.g., after seeding products), dispatch:
```ts
window.dispatchEvent(new CustomEvent('ph:data:changed', { detail: { area: 'products' } }));
```
Components subscribe to this event in `useEffect` to re-fetch.

### Print / Export

- **Print**: `window.api.util.printHTML(htmlString)` opens a hidden `BrowserWindow`, loads the HTML, and calls `webContents.print()`. Printer name/silent mode come from the `settings` table keys `printer.receipt.name` / `printer.receipt.silent`.
- **CSV export**: `window.api.util.exportCSV(filename, csvString)` opens a save-file dialog and writes the string.

### Key files to understand the system

| File | Purpose |
|---|---|
| `src/main/main.ts` | App bootstrap, window creation, util IPC handlers |
| `src/main/db/sqlite-wasm.ts` | WASM SQLite adapter (understand before touching DB code) |
| `src/main/db/index.ts` | Schema definition and seed user |
| `src/preload/index.ts` | Entire API surface exposed to renderer |
| `src/renderer/src/App.tsx` | Page routing, nav bar, dark mode, auth gate |
| `src/renderer/src/lib/auth.tsx` | Session lifecycle |

### Sales transaction pattern

`ipc/sales.ts → sales:create` wraps all stock checks and inserts in `db.transaction(fn)()`. The skeleton sale row is inserted first (to satisfy FK), then items are processed in a loop (stock check → decrement → insert sale_item), then the total is back-filled. Any throw inside the transaction triggers automatic `ROLLBACK`.

### Branding: one codebase, two identities

This repo is published twice — privately as the shop's till, publicly as the
generic product. **The source is identical in both.** Do not hardcode a shop
name anywhere; that forks the code and every later change has to be made twice.

- **Desktop**: `pharmacy.name/address/phone/regno/footer` in `settings`, read
  through `lib/shop.tsx` (`useShop()`). Default `'PharmaFlow'`. Edited in
  Settings → Shop details.
- **Website**: `VITE_SHOP_NAME` at build time, via `lib/shop.ts`. The web
  manifest is rewritten by `scripts/postbuild.mjs` for the same reason the CSP
  is — a fixed copy would be wrong for every other shop.
- **Packaged program**: `SHOP_NAME=... npm run package`, read by
  `electron-builder.config.cjs`.

**`app.setName('pharmaflow-desktop')` in `main.ts` must not be removed or
changed.** Electron derives `userData` from the app name, so renaming the
product would move the data folder and orphan the database — still on disk,
invisible to the app. `appId` is fixed for the same class of reason: Windows
identifies an installed program by it.

The receipt lives in `renderer/src/lib/receipt.ts`, sized for a 76mm roll.

### The website (`web/`)

A separate Vite + React + Tailwind static site — no framework server, so it
hosts free on Cloudflare Pages. It reads the Supabase mirror, not the shop PC,
which is why it still answers when the PC is off.

- Auth is Supabase's, and the **role comes from `app_users`, read from the
  database** (`lib/auth.tsx`). Hiding a tab is a courtesy; the RLS policies are
  the actual gate. A signed-in account with no `app_users` row sees an explicit
  "no access yet" screen rather than blank pages.
- `.env` holds the project URL and the **publishable** key only. Both are public
  and compiled into the bundle. A test asserts the key alone reads nothing.
- **The product editor has no stock field**, and must not grow one. Stock is a
  delta from the till; a website writing an absolute number would erase
  concurrent sales.
- A product edit inserts the `sync_events` row **before** upserting the mirror
  row. If only one succeeds it must be the one the till will see, or the till's
  next snapshot silently reverts the edit.
- Inputs are 16px on purpose — anything smaller makes iOS Safari zoom on focus.

## Schema

```sql
users        (id, email, password_hash, role, created_at)
products     (id, name, sku, price, stock, expiry, description, supplier, category, created_at, updated_at)
sales        (id, total, payment_method, created_at)
sale_items   (id, sale_id→sales, product_id→products, quantity, unit_price, line_total)
settings     (key PK, value)
```

`products` also has `generic_name` and `barcode`; `sales` has `voided_at`,
`voided_by`, `void_reason`; `sale_items` has `batch_id`. Newer tables:
`product_batches` (one row per delivery), `held_sales` (parked bills),
`sync_events` (this device's outbox), `sync_applied` (events already replayed).

Columns are added in `ensureSchema()` via `ensureColumn`, which runs at startup.
`ensureProductExtraColumns()` in `ipc/products.ts` is a lazy fallback that only
fires when a products IPC runs — do not rely on it alone, or the column is
missing until someone happens to open Inventory.

**Every query that sums revenue must filter `voided_at IS NULL`**, otherwise a
voided sale inflates the takings.

## Packaging notes

- Uses `electron-window-state` to remember window bounds.
- `app.requestSingleInstanceLock()` prevents multiple instances; second launch focuses the existing window.
- Production renderer path: `dist/renderer/index.html` (relative to `dist/main/main.js`).
- Renderer uses `base: './'` in Vite config for relative asset paths inside the packaged app.
