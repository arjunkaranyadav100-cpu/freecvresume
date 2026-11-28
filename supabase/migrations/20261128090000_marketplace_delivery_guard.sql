-- Require an explicit secure-delivery readiness approval before any paid product can be ordered.
alter table public.marketplace_products
  add column if not exists delivery_ready boolean not null default false;

comment on column public.marketplace_products.delivery_ready is
  'Must be explicitly set true only after the PDF is stored privately and server-side entitlement delivery is enforced.';
