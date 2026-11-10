-- Replace public-link database access with the server-side username/password API.
drop policy if exists casa_hogares_public_link_select on public.casa_hogares;
drop policy if exists casa_hogares_public_link_restore_update on public.casa_hogares;
drop policy if exists casa_movimientos_public_link_access on public.casa_movimientos;
drop policy if exists casa_miembros_select_member on public.casa_miembros;
drop policy if exists casa_miembros_update_admin on public.casa_miembros;
revoke all on table public.casa_hogares, public.casa_miembros, public.casa_movimientos from public, anon, authenticated;
grant select, insert, update, delete on table public.casa_hogares, public.casa_movimientos to service_role;

create table if not exists public.casa_api_sessions (
  token_hash text primary key,
  username text not null check (username in ('vaquero88', 'sheila')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists public.casa_api_login_limits (
  bucket_hash text primary key,
  attempts integer not null default 0,
  window_started_at timestamptz not null default now(),
  blocked_until timestamptz
);

alter table public.casa_api_sessions enable row level security;
alter table public.casa_api_login_limits enable row level security;
revoke all on table public.casa_api_sessions, public.casa_api_login_limits from public, anon, authenticated;
grant select, insert, update, delete on table public.casa_api_sessions, public.casa_api_login_limits to service_role;

create or replace function public.casa_api_rate_limit(
  p_bucket_hash text,
  p_max_attempts integer,
  p_window_seconds integer,
  p_block_seconds integer
)
returns table(allowed boolean, retry_after_seconds integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_limit public.casa_api_login_limits%rowtype;
  next_attempt integer;
begin
  insert into public.casa_api_login_limits(bucket_hash)
  values (p_bucket_hash)
  on conflict (bucket_hash) do nothing;

  select * into current_limit
  from public.casa_api_login_limits
  where bucket_hash = p_bucket_hash
  for update;

  if current_limit.blocked_until is not null and current_limit.blocked_until > now() then
    return query select false, greatest(1, ceil(extract(epoch from (current_limit.blocked_until - now())))::integer);
    return;
  end if;

  if current_limit.window_started_at < now() - make_interval(secs => p_window_seconds) then
    update public.casa_api_login_limits
    set attempts = 1, window_started_at = now(), blocked_until = null
    where bucket_hash = p_bucket_hash;
    return query select true, 0;
    return;
  end if;

  next_attempt := current_limit.attempts + 1;
  if next_attempt > p_max_attempts then
    update public.casa_api_login_limits
    set attempts = next_attempt, blocked_until = now() + make_interval(secs => p_block_seconds)
    where bucket_hash = p_bucket_hash;
    return query select false, p_block_seconds;
    return;
  end if;

  update public.casa_api_login_limits
  set attempts = next_attempt
  where bucket_hash = p_bucket_hash;
  return query select true, 0;
end;
$$;

create or replace function public.casa_restore_backup(
  p_household_id uuid,
  p_balances jsonb,
  p_movements jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  allowed_household constant uuid := 'f8578860-5cab-48bf-8643-6c6ca874036c';
begin
  if p_household_id <> allowed_household or jsonb_typeof(p_movements) <> 'array' then
    raise exception 'Invalid household backup';
  end if;

  update public.casa_hogares
  set saldo_inicial = (p_balances ->> 'openingBalance')::numeric,
      hucha_inicial = (p_balances ->> 'initialSavings')::numeric,
      deuda_conchi_inicial = (p_balances ->> 'initialConchiDebt')::numeric,
      aportacion_inicial_tito = (p_balances ->> 'initialTito')::numeric,
      aportacion_inicial_sheila = (p_balances ->> 'initialSheila')::numeric
  where id = allowed_household;
  if not found then
    raise exception 'Household not found';
  end if;

  update public.casa_movimientos as existing
  set archivado = true
  where existing.hogar_id = allowed_household
    and not (existing.id = any(
      coalesce(
        (select array_agg((item ->> 'id')::uuid) from jsonb_array_elements(p_movements) as incoming(item)),
        array[]::uuid[]
      )
    ));

  insert into public.casa_movimientos (
    id, hogar_id, fecha, periodo_anio, periodo_mes, descripcion, tipo,
    categoria, subcategoria, persona, importe, notas, plantilla_fijo_id,
    creado_por, archivado
  )
  select
    (item ->> 'id')::uuid,
    allowed_household,
    (item ->> 'date')::date,
    (item ->> 'periodYear')::smallint,
    (item ->> 'periodMonth')::smallint,
    item ->> 'description',
    item ->> 'type',
    item ->> 'category',
    coalesce(item ->> 'subcategory', ''),
    nullif(item ->> 'person', ''),
    (item ->> 'amount')::numeric,
    coalesce(item ->> 'notes', ''),
    nullif(item ->> 'fixedTemplateId', ''),
    null,
    coalesce((item ->> 'archived')::boolean, false)
  from jsonb_array_elements(p_movements) as incoming(item)
  on conflict (id) do update set
    hogar_id = excluded.hogar_id,
    fecha = excluded.fecha,
    periodo_anio = excluded.periodo_anio,
    periodo_mes = excluded.periodo_mes,
    descripcion = excluded.descripcion,
    tipo = excluded.tipo,
    categoria = excluded.categoria,
    subcategoria = excluded.subcategoria,
    persona = excluded.persona,
    importe = excluded.importe,
    notas = excluded.notas,
    plantilla_fijo_id = excluded.plantilla_fijo_id,
    archivado = excluded.archivado;
end;
$$;

revoke all on function public.casa_api_rate_limit(text, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.casa_api_rate_limit(text, integer, integer, integer) to service_role;
revoke all on function public.casa_restore_backup(uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.casa_restore_backup(uuid, jsonb, jsonb) to service_role;
