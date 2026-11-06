-- Identifies monthly fixed movements and prevents applying one twice per period.
alter table public.casa_movimientos
  add column if not exists plantilla_fijo_id text;

create unique index if not exists casa_movimientos_fixed_template_unique
  on public.casa_movimientos (hogar_id, plantilla_fijo_id, periodo_anio, periodo_mes)
  where plantilla_fijo_id is not null and archivado = false;
