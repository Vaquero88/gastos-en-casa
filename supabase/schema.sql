-- Private household ledger for Casa en común.
-- Historical transactions are imported separately and are not part of the website repository.

create extension if not exists pgcrypto;

create table if not exists public.casa_hogares (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  saldo_inicial numeric(12,2) not null default 0,
  hucha_inicial numeric(12,2) not null default 0,
  deuda_conchi_inicial numeric(12,2) not null default 0,
  aportacion_inicial_tito numeric(12,2) not null default 0,
  aportacion_inicial_sheila numeric(12,2) not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.casa_miembros (
  id uuid primary key default gen_random_uuid(),
  hogar_id uuid not null references public.casa_hogares(id) on delete cascade,
  auth_user_id uuid unique references auth.users(id) on delete set null,
  email text,
  nombre text not null,
  rol text not null default 'lectura' check (rol in ('admin','lectura')),
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  unique (hogar_id, nombre)
);

create unique index if not exists casa_miembros_email_unique
  on public.casa_miembros (lower(email)) where email is not null;

create table if not exists public.casa_movimientos (
  id uuid primary key default gen_random_uuid(),
  hogar_id uuid not null references public.casa_hogares(id) on delete cascade,
  fecha date not null,
  periodo_anio smallint not null,
  periodo_mes smallint not null check (periodo_mes between 1 and 12),
  descripcion text not null,
  tipo text not null check (tipo in ('ingreso','gasto')),
  categoria text not null,
  subcategoria text not null default '',
  persona text,
  importe numeric(12,2) not null check (tipo = 'ingreso' or importe <> 0),
  notas text not null default '',
  clave_importacion text,
  plantilla_fijo_id text,
  creado_por uuid references auth.users(id) on delete set null,
  archivado boolean not null default false,
  created_at timestamptz not null default now(),
  unique (hogar_id, clave_importacion)
);

create index if not exists casa_movimientos_periodo_idx
  on public.casa_movimientos (hogar_id, periodo_anio, periodo_mes, fecha desc);

create unique index if not exists casa_movimientos_fixed_template_unique
  on public.casa_movimientos (hogar_id, plantilla_fijo_id, periodo_anio, periodo_mes)
  where plantilla_fijo_id is not null and archivado = false;

create or replace function public.casa_hogar_actual()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.hogar_id
  from public.casa_miembros as m
  where m.auth_user_id = auth.uid() and m.activo = true
  limit 1
$$;

create or replace function public.casa_es_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.casa_miembros as m
    where m.auth_user_id = auth.uid()
      and m.hogar_id = public.casa_hogar_actual()
      and m.activo = true
      and m.rol = 'admin'
  )
$$;

create or replace function public.casa_enlazar_miembro()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.casa_miembros
  set auth_user_id = new.id
  where email is not null
    and lower(email) = lower(new.email)
    and auth_user_id is null;
  return new;
end
$$;

drop trigger if exists casa_enlazar_miembro_auth_user on auth.users;
drop trigger if exists casa_actualizar_email_miembro on auth.users;
create trigger casa_enlazar_miembro_auth_user
  after insert on auth.users
  for each row execute function public.casa_enlazar_miembro();
create trigger casa_actualizar_email_miembro
  after update of email on auth.users
  for each row execute function public.casa_enlazar_miembro();

alter table public.casa_hogares enable row level security;
alter table public.casa_miembros enable row level security;
alter table public.casa_movimientos enable row level security;

drop policy if exists casa_hogares_select_member on public.casa_hogares;
create policy casa_hogares_select_member on public.casa_hogares
  for select to authenticated using (id = public.casa_hogar_actual());
drop policy if exists casa_hogares_update_admin on public.casa_hogares;
create policy casa_hogares_update_admin on public.casa_hogares
  for update to authenticated using (id = public.casa_hogar_actual() and public.casa_es_admin())
  with check (id = public.casa_hogar_actual() and public.casa_es_admin());

drop policy if exists casa_miembros_select_member on public.casa_miembros;
create policy casa_miembros_select_member on public.casa_miembros
  for select to authenticated using (hogar_id = public.casa_hogar_actual());
drop policy if exists casa_miembros_update_admin on public.casa_miembros;
create policy casa_miembros_update_admin on public.casa_miembros
  for update to authenticated using (hogar_id = public.casa_hogar_actual() and public.casa_es_admin())
  with check (hogar_id = public.casa_hogar_actual() and public.casa_es_admin());

drop policy if exists casa_movimientos_select_member on public.casa_movimientos;
create policy casa_movimientos_select_member on public.casa_movimientos
  for select to authenticated using (hogar_id = public.casa_hogar_actual());
drop policy if exists casa_movimientos_insert_admin on public.casa_movimientos;
create policy casa_movimientos_insert_admin on public.casa_movimientos
  for insert to authenticated with check (
    hogar_id = public.casa_hogar_actual()
    and public.casa_es_admin()
    and (creado_por is null or creado_por = auth.uid())
  );
drop policy if exists casa_movimientos_update_admin on public.casa_movimientos;
create policy casa_movimientos_update_admin on public.casa_movimientos
  for update to authenticated using (hogar_id = public.casa_hogar_actual() and public.casa_es_admin())
  with check (hogar_id = public.casa_hogar_actual() and public.casa_es_admin());
drop policy if exists casa_movimientos_delete_admin on public.casa_movimientos;
create policy casa_movimientos_delete_admin on public.casa_movimientos
  for delete to authenticated using (hogar_id = public.casa_hogar_actual() and public.casa_es_admin());

revoke all on public.casa_hogares, public.casa_miembros, public.casa_movimientos from anon;
grant select, update on public.casa_hogares to authenticated;
grant select, update on public.casa_miembros to authenticated;
grant select, insert, update, delete on public.casa_movimientos to authenticated;
revoke all on function public.casa_hogar_actual() from public, anon;
revoke all on function public.casa_es_admin() from public, anon;
grant execute on function public.casa_hogar_actual() to authenticated;
grant execute on function public.casa_es_admin() to authenticated;

