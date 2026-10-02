-- Ejecuta esto en Supabase > SQL Editor
create table products (
  id bigint generated always as identity primary key,
  name text not null,
  sku text default '',
  price numeric not null check (price >= 0),
  stock integer not null default 0 check (stock >= 0),
  min_stock integer not null default 0,
  created_at timestamptz default now()
);
create table sales (
  id bigint generated always as identity primary key,
  created_at timestamptz default now(),
  total numeric not null,
  lines jsonb not null,
  user_id uuid default auth.uid()
);

alter table products enable row level security;
alter table sales enable row level security;
-- Solo usuarios con sesión iniciada (tu equipo) pueden leer y escribir
create policy "staff products" on products for all to authenticated using (true) with check (true);
create policy "staff sales" on sales for select to authenticated using (true);
-- Las ventas se crean solo con register_sale (descuenta stock de forma atómica)

create or replace function register_sale(p_lines jsonb) returns void
language plpgsql as $$
declare l jsonb; pr numeric; t numeric := 0;
begin
  for l in select * from jsonb_array_elements(p_lines) loop
    update products set stock = stock - (l->>'qty')::int
      where id = (l->>'id')::bigint and stock >= (l->>'qty')::int
      returning price into pr;
    if not found then raise exception 'Stock insuficiente'; end if;
    t := t + (l->>'qty')::int * pr;
  end loop;
  insert into sales(total, lines) values (t, p_lines);
end $$;
