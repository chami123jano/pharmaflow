-- PharmaFlow cloud mirror
--
-- Run this once in the Supabase SQL editor (Dashboard → SQL Editor → New query).
--
-- This is a MIRROR, not the source of truth. The shop PC owns the real data and
-- keeps selling with no internet at all; this copy exists so the website can
-- answer when the shop PC is switched off.
--
-- Two rules carried over from the desktop and not to be broken here:
--   * Stock is never written as an absolute number from the website. It moves
--     only through sync_events as a delta, so a sale at the shop and a delivery
--     entered from home both land instead of one erasing the other.
--   * Sales are created at the till and only ever pushed up. Nothing in the
--     cloud may invent one.

-- ---------------------------------------------------------------- devices ---
create table if not exists devices (
  id            text primary key,          -- matches sync.device_id on the PC
  label         text,
  last_seen_at  timestamptz,
  created_at    timestamptz not null default now()
);

-- --------------------------------------------------------------- products ---
create table if not exists products (
  id            uuid primary key,
  name          text not null,
  sku           text,
  generic_name  text,
  barcode       text,
  category      text,
  price         numeric(12,2) not null default 0,
  stock         integer not null default 0,  -- mirror of the PC's cached total
  supplier      text,
  description   text,
  expiry        date,
  updated_at    timestamptz not null default now(),
  created_at    timestamptz not null default now()
);
create index if not exists products_name_idx     on products (lower(name));
create index if not exists products_generic_idx  on products (lower(coalesce(generic_name,'')));
create index if not exists products_barcode_idx  on products (barcode);

-- ---------------------------------------------------------------- batches ---
create table if not exists product_batches (
  id            uuid primary key,
  product_id    uuid not null references products(id) on delete cascade,
  batch_no      text,
  expiry        date,
  qty_received  integer not null default 0,
  qty_remaining integer not null default 0,
  cost_price    numeric(12,2),
  supplier      text,
  supplier_id   uuid,
  created_at    timestamptz not null default now()
);
create index if not exists batches_product_idx on product_batches (product_id);
create index if not exists batches_expiry_idx  on product_batches (expiry);

-- ------------------------------------------------------------------ sales ---
create table if not exists sales (
  id              uuid primary key,
  receipt_no      integer,
  subtotal        numeric(12,2) not null default 0,
  discount_amount numeric(12,2) not null default 0,
  total           numeric(12,2) not null default 0,
  payment_method  text,
  customer_amount numeric(12,2) not null default 0,
  change_amount   numeric(12,2) not null default 0,
  cashier_name    text,
  customer_id     uuid,
  device_id       text,
  voided_at       timestamptz,
  created_at      timestamptz not null default now()
);
-- Reports are almost always "today" or "this week", so lead with the date.
create index if not exists sales_created_idx on sales (created_at desc);
create index if not exists sales_live_idx    on sales (created_at desc) where voided_at is null;

create table if not exists sale_items (
  id          uuid primary key,
  sale_id     uuid not null references sales(id) on delete cascade,
  product_id  uuid,
  product_name text,
  quantity    integer not null,
  unit_price  numeric(12,2) not null,
  line_total  numeric(12,2) not null,
  batch_id    uuid
);
create index if not exists sale_items_sale_idx on sale_items (sale_id);

-- ---------------------------------------------------------------- people ----
create table if not exists customers (
  id         uuid primary key,
  name       text not null,
  phone      text,
  email      text,
  address    text,
  notes      text,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists suppliers (
  id             uuid primary key,
  name           text not null,
  phone          text,
  email          text,
  address        text,
  contact_person text,
  notes          text,
  updated_at     timestamptz not null default now(),
  created_at     timestamptz not null default now()
);

-- ------------------------------------------------------------ the queue -----
-- The change log, in both directions. The desktop appends what it did; the
-- website appends what the owner asked for. Each side applies what it has not
-- seen. device_id = 'web' marks a change made from the website.
create table if not exists sync_events (
  id         uuid primary key,
  device_id  text not null,
  type       text not null,       -- product.upsert | stock.delta | sale.created | …
  payload    jsonb not null,
  ts         timestamptz not null default now(),
  applied_by jsonb not null default '[]'::jsonb   -- devices that have taken it
);
create index if not exists sync_events_ts_idx     on sync_events (ts);
create index if not exists sync_events_device_idx on sync_events (device_id, ts);

-- ------------------------------------------------------------------ roles ---
-- Who may see and do what. A row per Supabase auth user.
create table if not exists app_users (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  role       text not null default 'staff' check (role in ('owner','staff')),
  created_at timestamptz not null default now()
);

create or replace function is_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from app_users where user_id = auth.uid() and role = 'owner'
  );
$$;

create or replace function is_signed_in() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from app_users where user_id = auth.uid());
$$;

-- ----------------------------------------------------------------- policy ---
-- Row level security is on everywhere. Without a matching policy, nothing is
-- readable — including by an attacker holding the public key, which is the
-- point: that key is in the website's source and must be worth nothing alone.
--
-- The desktop app connects with the service role key, which bypasses all of
-- this. That key lives only in the desktop, encrypted, and never in the website.
alter table devices         enable row level security;
alter table products        enable row level security;
alter table product_batches enable row level security;
alter table sales           enable row level security;
alter table sale_items      enable row level security;
alter table customers       enable row level security;
alter table suppliers       enable row level security;
alter table sync_events     enable row level security;
alter table app_users       enable row level security;

-- Anyone signed in may look at stock and people.
do $$
declare t text;
begin
  foreach t in array array['products','product_batches','customers','suppliers','devices'] loop
    execute format('drop policy if exists read_all on %I', t);
    execute format('create policy read_all on %I for select using (is_signed_in())', t);
  end loop;
end $$;

-- Money is the owner's business only. Staff can use the till; staff cannot
-- stand at home reading the takings.
drop policy if exists owner_reads_sales on sales;
create policy owner_reads_sales on sales for select using (is_owner());
drop policy if exists owner_reads_sale_items on sale_items;
create policy owner_reads_sale_items on sale_items for select using (is_owner());

-- Only the owner may queue a change for the till to pick up.
drop policy if exists owner_writes_events on sync_events;
create policy owner_writes_events on sync_events for insert with check (is_owner());
drop policy if exists owner_reads_events on sync_events;
create policy owner_reads_events on sync_events for select using (is_owner());

-- Owners may edit product details straight away, so the website does not look
-- frozen while the shop PC is off. Stock is deliberately absent: it changes
-- only through sync_events.
drop policy if exists owner_writes_products on products;
create policy owner_writes_products on products for insert with check (is_owner());
drop policy if exists owner_updates_products on products;
create policy owner_updates_products on products for update using (is_owner()) with check (is_owner());

drop policy if exists owner_writes_customers on customers;
create policy owner_writes_customers on customers for insert with check (is_owner());
drop policy if exists owner_updates_customers on customers;
create policy owner_updates_customers on customers for update using (is_owner()) with check (is_owner());

drop policy if exists owner_writes_suppliers on suppliers;
create policy owner_writes_suppliers on suppliers for insert with check (is_owner());
drop policy if exists owner_updates_suppliers on suppliers;
create policy owner_updates_suppliers on suppliers for update using (is_owner()) with check (is_owner());

-- Everyone may read their own role, so the website knows what to show.
drop policy if exists read_own_role on app_users;
create policy read_own_role on app_users for select using (user_id = auth.uid());

-- ----------------------------------------------------------------- grants ---
-- Row level security decides which rows a request may see; these grants decide
-- whether the role may ask at all. Spelled out here so the schema works the
-- same whether or not the project has "automatically expose new tables" on.
grant usage on schema public to anon, authenticated, service_role;

-- The desktop connects as service_role and bypasses RLS entirely.
grant all on all tables in schema public to service_role;

-- The website connects as a signed-in user. Every one of these is still gated
-- by the policies above, so a grant here opens nothing on its own.
grant select on products, product_batches, customers, suppliers, devices,
                sales, sale_items, sync_events, app_users to authenticated;
grant insert, update on products, customers, suppliers to authenticated;
grant insert on sync_events to authenticated;

-- anon is the key sitting in the website's source before anyone signs in.
-- It is granted nothing: unauthenticated, that key is worth having.
revoke all on all tables in schema public from anon;

-- ------------------------------------------------------------------ live ----
-- Lets the website watch sales arrive as they happen.
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;
alter publication supabase_realtime add table sales;

-- ------------------------------------------------------------------------ --
-- After running this, make yourself the owner. Create your login under
-- Authentication → Users, then run:
--
--   insert into app_users (user_id, role)
--   select id, 'owner' from auth.users where email = 'you@example.com';
--
-- Staff accounts are added the same way with 'staff'.
