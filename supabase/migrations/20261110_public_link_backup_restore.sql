-- Allow the public-link app to restore the household's opening balances from a backup.
-- Access remains limited to the single household used by Casa en comun.
drop policy if exists casa_hogares_public_link_restore_update on public.casa_hogares;
create policy casa_hogares_public_link_restore_update on public.casa_hogares
  for update to anon
  using (id = 'f8578860-5cab-48bf-8643-6c6ca874036c')
  with check (id = 'f8578860-5cab-48bf-8643-6c6ca874036c');

grant update on public.casa_hogares to anon;

