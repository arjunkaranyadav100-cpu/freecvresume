-- FreeCVResume marketplace payment foundation.
-- Apply in Supabase SQL Editor. Do not expose the service-role key in browser code.

create table if not exists public.marketplace_products (
  id text primary key,
  title text not null,
  amount_paise bigint not null check (amount_paise >= 100),
  currency text not null default 'INR' check (currency = 'INR'),
  creator_user_id uuid not null,
  active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.marketplace_orders (
  id uuid primary key default gen_random_uuid(),
  razorpay_order_id text not null unique,
  razorpay_payment_id text unique,
  note_id text not null references public.marketplace_products(id),
  buyer_user_id uuid not null,
  creator_user_id uuid not null,
  amount_paise bigint not null check (amount_paise > 0),
  currency text not null default 'INR',
  status text not null default 'created' check (status in ('created','paid','failed','refunded','partially_refunded')),
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.marketplace_entitlements (
  id uuid primary key default gen_random_uuid(),
  buyer_user_id uuid not null,
  note_id text not null references public.marketplace_products(id),
  order_id uuid not null references public.marketplace_orders(id),
  granted_at timestamptz not null default now(),
  unique (buyer_user_id, note_id)
);

create table if not exists public.creator_ledger (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.marketplace_orders(id),
  creator_user_id uuid not null,
  entry_type text not null check (entry_type in ('sale_credit','refund_debit','adjustment')),
  gross_paise bigint not null,
  gateway_fee_paise bigint not null default 0,
  creator_share_paise bigint not null,
  platform_share_paise bigint not null,
  created_at timestamptz not null default now(),
  unique (order_id, entry_type)
);

create table if not exists public.marketplace_webhook_events (
  event_id text primary key,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  processed_at timestamptz not null default now()
);

alter table public.marketplace_products enable row level security;
alter table public.marketplace_orders enable row level security;
alter table public.marketplace_entitlements enable row level security;
alter table public.creator_ledger enable row level security;
alter table public.marketplace_webhook_events enable row level security;

-- No client writes. Public catalog can read only active product metadata.
drop policy if exists "active marketplace products are readable" on public.marketplace_products;
create policy "active marketplace products are readable" on public.marketplace_products
  for select to anon, authenticated using (active = true);

drop policy if exists "buyers can read their own orders" on public.marketplace_orders;
create policy "buyers can read their own orders" on public.marketplace_orders
  for select to authenticated using (buyer_user_id = auth.uid());

drop policy if exists "buyers can read their own entitlements" on public.marketplace_entitlements;
create policy "buyers can read their own entitlements" on public.marketplace_entitlements
  for select to authenticated using (buyer_user_id = auth.uid());

drop policy if exists "creators can read their ledger" on public.creator_ledger;
create policy "creators can read their ledger" on public.creator_ledger
  for select to authenticated using (creator_user_id = auth.uid());

revoke all on public.marketplace_products, public.marketplace_orders, public.marketplace_entitlements, public.creator_ledger, public.marketplace_webhook_events from anon, authenticated;
grant select on public.marketplace_products, public.marketplace_orders, public.marketplace_entitlements, public.creator_ledger to authenticated;
grant select on public.marketplace_products to anon;

create or replace function public.create_marketplace_order(
  p_razorpay_order_id text, p_note_id text, p_buyer_user_id uuid,
  p_amount_paise bigint, p_currency text
) returns uuid language plpgsql security definer set search_path = public as $$
declare product_row public.marketplace_products%rowtype; new_id uuid;
begin
  select * into product_row from public.marketplace_products
   where id = p_note_id and active = true for share;
  if not found or product_row.amount_paise <> p_amount_paise or product_row.currency <> p_currency then
    raise exception 'Product is not purchasable or amount mismatch';
  end if;
  if product_row.creator_user_id = p_buyer_user_id then raise exception 'Creator cannot purchase own note'; end if;
  insert into public.marketplace_orders(razorpay_order_id,note_id,buyer_user_id,creator_user_id,amount_paise,currency)
  values(p_razorpay_order_id,p_note_id,p_buyer_user_id,product_row.creator_user_id,p_amount_paise,p_currency)
  returning id into new_id;
  return new_id;
end; $$;

create or replace function public.complete_marketplace_payment(
  p_razorpay_order_id text, p_razorpay_payment_id text,
  p_buyer_user_id uuid, p_amount_paise bigint
) returns jsonb language plpgsql security definer set search_path = public as $$
declare o public.marketplace_orders%rowtype; net_paise bigint; creator_paise bigint; platform_paise bigint;
begin
  select * into o from public.marketplace_orders where razorpay_order_id=p_razorpay_order_id for update;
  if not found or o.buyer_user_id <> p_buyer_user_id or o.amount_paise <> p_amount_paise then
    raise exception 'Order, buyer, or amount mismatch';
  end if;
  if o.status = 'paid' then return jsonb_build_object('already_paid',true,'order_id',o.id); end if;
  update public.marketplace_orders set status='paid', razorpay_payment_id=p_razorpay_payment_id,
    paid_at=now(), updated_at=now() where id=o.id;
  insert into public.marketplace_entitlements(buyer_user_id,note_id,order_id)
    values(o.buyer_user_id,o.note_id,o.id) on conflict (buyer_user_id,note_id) do nothing;
  -- Revenue share is 50/50 of net collected after actual gateway fees.
  -- Gateway fee must be reconciled from provider settlement data before creator payout.
  net_paise := o.amount_paise;
  creator_paise := floor(net_paise * 0.50);
  platform_paise := net_paise - creator_paise;
  insert into public.creator_ledger(order_id,creator_user_id,entry_type,gross_paise,gateway_fee_paise,creator_share_paise,platform_share_paise)
    values(o.id,o.creator_user_id,'sale_credit',o.amount_paise,0,creator_paise,platform_paise)
    on conflict (order_id,entry_type) do nothing;
  return jsonb_build_object('verified',true,'order_id',o.id,'entitlement_granted',true);
end; $$;

create or replace function public.complete_marketplace_payment_webhook(
  p_event_id text, p_razorpay_order_id text, p_razorpay_payment_id text, p_amount_paise bigint
) returns jsonb language plpgsql security definer set search_path = public as $$
declare o public.marketplace_orders%rowtype; result jsonb;
begin
  insert into public.marketplace_webhook_events(event_id,event_type,payload)
    values(p_event_id,'payment.captured',jsonb_build_object('order_id',p_razorpay_order_id,'payment_id',p_razorpay_payment_id))
    on conflict(event_id) do nothing;
  select * into o from public.marketplace_orders where razorpay_order_id=p_razorpay_order_id;
  if not found then raise exception 'Unknown order'; end if;
  select public.complete_marketplace_payment(p_razorpay_order_id,p_razorpay_payment_id,o.buyer_user_id,p_amount_paise) into result;
  return result;
end; $$;

create or replace function public.record_marketplace_webhook_event(
  p_event_id text, p_event_type text, p_payload jsonb
) returns void language sql security definer set search_path = public as $$
  insert into public.marketplace_webhook_events(event_id,event_type,payload)
  values(p_event_id,p_event_type,p_payload) on conflict(event_id) do nothing;
$$;

revoke all on function public.create_marketplace_order(text,text,uuid,bigint,text) from public, anon, authenticated;
revoke all on function public.complete_marketplace_payment(text,text,uuid,bigint) from public, anon, authenticated;
revoke all on function public.complete_marketplace_payment_webhook(text,text,text,bigint) from public, anon, authenticated;
revoke all on function public.record_marketplace_webhook_event(text,text,jsonb) from public, anon, authenticated;
grant execute on function public.create_marketplace_order(text,text,uuid,bigint,text) to service_role;
grant execute on function public.complete_marketplace_payment(text,text,uuid,bigint) to service_role;
grant execute on function public.complete_marketplace_payment_webhook(text,text,text,bigint) to service_role;
grant execute on function public.record_marketplace_webhook_event(text,text,jsonb) to service_role;
