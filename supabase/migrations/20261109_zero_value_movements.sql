-- Permit zero-value entries for both income and expense movements.
alter table public.casa_movimientos
  drop constraint if exists casa_movimientos_importe_check;
