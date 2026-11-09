-- Intentionally make the Casa en común household ledger public to anyone using the app link.
-- Restrict policies to the one household used by this app; do not expose member email/auth records.
do $$
begin
  if not exists (select 1 from public.casa_hogares where id = 'f8578860-5cab-48bf-8643-6c6ca874036c') then
    raise exception 'Casa en común household f8578860-5cab-48bf-8643-6c6ca874036c was not found';
  end if;
end
$$;

drop policy if exists casa_hogares_public_link_select on public.casa_hogares;
create policy casa_hogares_public_link_select on public.casa_hogares
  for select to anon
  using (id = 'f8578860-5cab-48bf-8643-6c6ca874036c');

drop policy if exists casa_movimientos_public_link_access on public.casa_movimientos;
create policy casa_movimientos_public_link_access on public.casa_movimientos
  for all to anon
  using (hogar_id = 'f8578860-5cab-48bf-8643-6c6ca874036c')
  with check (hogar_id = 'f8578860-5cab-48bf-8643-6c6ca874036c');

revoke all on public.casa_miembros from anon;
grant select on public.casa_hogares to anon;
grant select, insert, update, delete on public.casa_movimientos to anon;

