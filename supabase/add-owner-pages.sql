-- Owner pages: profit, deliveries (GRNs), returns and cash-ups on the website.
--
-- Safe to run more than once. Run it once in the Supabase SQL editor; until
-- then the till keeps syncing everything else and simply skips these.
-- Everything here is readable by the OWNER only — staff signed in to the
-- website see none of it, the same rule as sales.

-- The newer figures on existing tables.
alter table sales      add column if not exists refunded  numeric(12,2) not null default 0;
alter table sale_items add column if not exists unit_cost numeric(12,2);

create table if not exists grns (
  id              uuid primary key,
  grn_no          integer,
  supplier_name   text,
  invoice_no      text,
  invoice_date    date,
  invoice_total   numeric(12,2),
  total_cost      numeric(12,2) not null default 0,
  line_count      integer not null default 0,
  unit_count      integer not null default 0,
  notes           text,
  created_by_name text,
  device_id       text,
  voided_at       timestamptz,
  void_reason     text,
  created_at      timestamptz not null default now()
);
create index if not exists grns_created_idx on grns (created_at desc);

create table if not exists grn_items (
  id           uuid primary key,
  grn_id       uuid not null references grns(id) on delete cascade,
  product_id   uuid,
  product_name text,
  batch_no     text,
  expiry       date,
  qty          integer not null default 0,
  free_qty     integer not null default 0,
  cost_price   numeric(12,2),
  line_total   numeric(12,2) not null default 0
);
create index if not exists grn_items_grn_idx on grn_items (grn_id);

create table if not exists sale_returns (
  id              uuid primary key,
  return_no       integer,
  sale_id         uuid,
  receipt_no      integer,
  refund_total    numeric(12,2) not null default 0,
  method          text,
  reason          text,
  created_by_name text,
  approved_by     text,
  device_id       text,
  created_at      timestamptz not null default now()
);
create index if not exists sale_returns_created_idx on sale_returns (created_at desc);

create table if not exists sale_return_items (
  id           uuid primary key,
  return_id    uuid not null references sale_returns(id) on delete cascade,
  sale_item_id uuid,
  product_id   uuid,
  product_name text,
  qty          integer not null default 0,
  unit_price   numeric(12,2),
  refund       numeric(12,2) not null default 0,
  unit_cost    numeric(12,2),
  restocked    boolean not null default true
);
create index if not exists sale_return_items_return_idx on sale_return_items (return_id);

create table if not exists cash_ups (
  id              uuid primary key,
  period_start    timestamptz not null,
  period_end      timestamptz not null,
  float_amount    numeric(12,2) not null default 0,
  cash_sales      numeric(12,2) not null default 0,
  card_sales      numeric(12,2) not null default 0,
  cash_refunds    numeric(12,2) not null default 0,
  card_refunds    numeric(12,2) not null default 0,
  sales_count     integer not null default 0,
  expected_cash   numeric(12,2) not null default 0,
  counted_cash    numeric(12,2) not null default 0,
  difference      numeric(12,2) not null default 0,
  notes           text,
  created_by_name text,
  device_id       text,
  created_at      timestamptz not null default now()
);
create index if not exists cash_ups_created_idx on cash_ups (created_at desc);

-- Owner only. The till writes with the service role, which bypasses this.
do $$
declare t text;
begin
  foreach t in array array['grns','grn_items','sale_returns','sale_return_items','cash_ups'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists owner_reads on %I', t);
    execute format('create policy owner_reads on %I for select using (is_owner())', t);
    execute format('grant select on %I to authenticated', t);
    execute format('grant all on %I to service_role', t);
    execute format('revoke all on %I from anon', t);
  end loop;
end $$;
