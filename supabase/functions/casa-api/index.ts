import { createClient } from 'npm:@supabase/supabase-js@2';

const HOUSEHOLD_ID = 'f8578860-5cab-48bf-8643-6c6ca874036c';
const SESSION_HOURS = 12;
const PASSWORD_ITERATIONS = 600_000;
const USERS: Record<string, { displayName: string; person: string }> = {
  vaquero88: { displayName: 'Vaquero88', person: 'Tito' },
  sheila: { displayName: 'Sheila', person: 'Sheila' },
};
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'apikey, content-type, x-casa-session',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8',
};

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}
function base64ToBytes(value: string) {
  return Uint8Array.from(atob(value), char => char.charCodeAt(0));
}
function bytesToBase64Url(value: Uint8Array) {
  return btoa(String.fromCharCode(...value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
async function sha256Hex(value: string) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  return [...digest].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
async function hashPassword(password: string) {
  const salt = Deno.env.get('CASA_PASSWORD_SALT');
  if (!salt || !Deno.env.get('CASA_PASSWORD_HASH')) throw new Error('Login secrets are not configured.');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: base64ToBytes(salt), iterations: PASSWORD_ITERATIONS }, key, 256);
  return new Uint8Array(bits);
}
function equalBytes(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let index = 0; index < a.length; index++) mismatch |= a[index] ^ b[index];
  return mismatch === 0;
}
function sessionFromRequest(request: Request) {
  return request.headers.get('x-casa-session') || '';
}
async function findSession(request: Request) {
  const rawToken = sessionFromRequest(request);
  if (rawToken.length < 40 || rawToken.length > 100) return null;
  const tokenHash = await sha256Hex(rawToken);
  const { data, error } = await supabase.from('casa_api_sessions')
    .select('username,expires_at').eq('token_hash', tokenHash).gt('expires_at', new Date().toISOString()).maybeSingle();
  if (error) throw error;
  if (!data || !Object.hasOwn(USERS, data.username)) return null;
  return { tokenHash, username: data.username, user: USERS[data.username] };
}
async function allowLoginAttempt(bucket: string, maxAttempts: number) {
  const bucketHash = await sha256Hex(bucket);
  const { data, error } = await supabase.rpc('casa_api_rate_limit', {
    p_bucket_hash: bucketHash,
    p_max_attempts: maxAttempts,
    p_window_seconds: 900,
    p_block_seconds: 900,
  }).single();
  if (error) throw error;
  return data as { allowed: boolean; retry_after_seconds: number };
}
async function login(request: Request, body: Record<string, unknown>) {
  const username = String(body.username || '').normalize('NFKC').trim().toLowerCase();
  const password = String(body.password || '');
  if (password.length > 256) return json({ error: 'Usuario o contraseña incorrectos.' }, 401);
  const ip = (request.headers.get('x-forwarded-for') || 'unknown').split(',')[0].trim();
  const [ipLimit, accountLimit] = await Promise.all([
    allowLoginAttempt(`ip-user:${ip}:${username}`, 8),
    allowLoginAttempt(`account:${username}`, 40),
  ]);
  if (!ipLimit.allowed || !accountLimit.allowed) return json({ error: 'Demasiados intentos de acceso.' }, 429);

  const supplied = await hashPassword(password);
  const expected = base64ToBytes(Deno.env.get('CASA_PASSWORD_HASH')!);
  if (!Object.hasOwn(USERS, username) || !equalBytes(supplied, expected)) return json({ error: 'Usuario o contraseña incorrectos.' }, 401);

  const rawToken = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(48)));
  const tokenHash = await sha256Hex(rawToken);
  const expiresAt = new Date(Date.now() + SESSION_HOURS * 60 * 60 * 1000).toISOString();
  const { error } = await supabase.from('casa_api_sessions').insert({ token_hash: tokenHash, username, expires_at: expiresAt });
  if (error) throw error;
  await supabase.from('casa_api_sessions').delete().lt('expires_at', new Date().toISOString());
  return json({ sessionToken: rawToken, expiresAt, member: USERS[username] });
}
async function allMovements(includeArchived = false) {
  const rows: Record<string, unknown>[] = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    let query = supabase.from('casa_movimientos').select('*').eq('hogar_id', HOUSEHOLD_ID);
    if (!includeArchived) query = query.eq('archivado', false);
    const { data, error } = await query.order('periodo_anio').order('periodo_mes').order('fecha').order('id')
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < pageSize) return rows;
  }
}
function validateMovement(item: Record<string, unknown>) {
  const id = String(item.id || '');
  const periodYear = Number(item.periodYear);
  const periodMonth = Number(item.periodMonth);
  const amount = Number(item.amount);
  const date = String(item.date || '');
  const type = String(item.type || '');
  const description = String(item.description || '').trim();
  const category = String(item.category || '').trim();
  if (!/^[0-9a-f-]{36}$/i.test(id) || !/^\d{4}-\d{2}-\d{2}$/.test(date)
      || !Number.isInteger(periodYear) || periodYear < 1900 || periodYear > 2200
      || !Number.isInteger(periodMonth) || periodMonth < 1 || periodMonth > 12
      || !Number.isFinite(amount) || Math.abs(amount) >= 10_000_000_000
      || !['ingreso', 'gasto'].includes(type) || !description || description.length > 255 || !category || category.length > 120) {
    throw new Error('La copia contiene un movimiento no válido.');
  }
  return {
    id, date, periodYear, periodMonth, description, type, category,
    subcategory: String(item.subcategory || '').slice(0, 120),
    person: item.person ? String(item.person).slice(0, 80) : null,
    amount, notes: String(item.notes || '').slice(0, 2000),
    fixedTemplateId: item.fixedTemplateId ? String(item.fixedTemplateId).slice(0, 120) : null,
    archived: Boolean(item.archived),
  };
}
function toDatabaseMovement(item: Record<string, unknown>) {
  const movement = validateMovement(item);
  return {
    id: movement.id,
    hogar_id: HOUSEHOLD_ID,
    fecha: movement.date,
    periodo_anio: movement.periodYear,
    periodo_mes: movement.periodMonth,
    descripcion: movement.description,
    tipo: movement.type,
    categoria: movement.category,
    subcategoria: movement.subcategory,
    persona: movement.person,
    importe: movement.amount,
    notas: movement.notes,
    plantilla_fijo_id: movement.fixedTemplateId,
    creado_por: null,
    archivado: movement.archived,
  };
}
function fromDatabaseMovement(row: Record<string, unknown>) {
  return {
    id: row.id,
    date: row.fecha,
    periodYear: Number(row.periodo_anio),
    periodMonth: Number(row.periodo_mes),
    description: row.descripcion,
    type: row.tipo,
    category: row.categoria,
    subcategory: row.subcategoria || '',
    person: row.persona,
    amount: Number(row.importe),
    notes: row.notas || '',
    fixedTemplateId: row.plantilla_fijo_id || null,
    createdAt: Date.parse(String(row.created_at || row.fecha)),
    archived: Boolean(row.archivado),
  };
}
async function handleAuthenticatedAction(action: string, body: Record<string, unknown>, session: NonNullable<Awaited<ReturnType<typeof findSession>>>) {
  if (action === 'logout') {
    const { error } = await supabase.from('casa_api_sessions').delete().eq('token_hash', session.tokenHash);
    if (error) throw error;
    return json({ ok: true });
  }
  if (action === 'getData') {
    const { data: household, error } = await supabase.from('casa_hogares')
      .select('id,nombre,saldo_inicial,hucha_inicial,deuda_conchi_inicial,aportacion_inicial_tito,aportacion_inicial_sheila')
      .eq('id', HOUSEHOLD_ID).single();
    if (error) throw error;
    return json({ household, movements: await allMovements(false), member: session.user });
  }
  if (action === 'getMovements') return json({ movements: await allMovements(Boolean(body.includeArchived)) });
  if (action === 'saveMovement' || action === 'createMovement') {
    if (!body.movement || typeof body.movement !== 'object') return json({ error: 'Movimiento no válido.' }, 400);
    const row = toDatabaseMovement(body.movement as Record<string, unknown>);
    const { error } = action === 'createMovement'
      ? await supabase.from('casa_movimientos').insert(row)
      : await supabase.from('casa_movimientos').upsert(row, { onConflict: 'id' });
    if (error) throw error;
    return json({ ok: true });
  }
  if (action === 'updateMovement') {
    const id = String(body.id || '');
    const { data: existing, error: readError } = await supabase.from('casa_movimientos').select('*')
      .eq('id', id).eq('hogar_id', HOUSEHOLD_ID).single();
    if (readError) throw readError;
    const changes = (body.changes && typeof body.changes === 'object') ? body.changes as Record<string, unknown> : {};
    const merged = { ...fromDatabaseMovement(existing), ...changes, id, archived: false };
    const { error } = await supabase.from('casa_movimientos').upsert(toDatabaseMovement(merged), { onConflict: 'id' });
    if (error) throw error;
    return json({ ok: true });
  }
  if (action === 'archiveMovement') {
    const { error } = await supabase.from('casa_movimientos').update({ archivado: true })
      .eq('id', String(body.id || '')).eq('hogar_id', HOUSEHOLD_ID);
    if (error) throw error;
    return json({ ok: true });
  }
  if (action === 'restoreBackup') {
    if (body.householdId !== HOUSEHOLD_ID || !body.balances || !Array.isArray(body.movements) || body.movements.length > 20000) {
      return json({ error: 'Copia de seguridad no válida.' }, 400);
    }
    const movements = body.movements.map(item => validateMovement(item as Record<string, unknown>));
    const ids = new Set(movements.map(item => item.id));
    if (ids.size !== movements.length) return json({ error: 'La copia repite identificadores de movimientos.' }, 400);
    const { error } = await supabase.rpc('casa_restore_backup', {
      p_household_id: HOUSEHOLD_ID,
      p_balances: body.balances,
      p_movements: movements,
    });
    if (error) throw error;
    return json({ ok: true, count: movements.length });
  }
  return json({ error: 'Solicitud no válida.' }, 400);
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Método no permitido.' }, 405);
  try {
    const body = await request.json() as Record<string, unknown>;
    const action = String(body.action || '');
    if (action === 'login') return await login(request, body);
    const session = await findSession(request);
    if (!session) return json({ error: 'Sesión caducada. Vuelve a iniciar sesión.' }, 401);
    return await handleAuthenticatedAction(action, body, session);
  } catch (error) {
    console.error('casa-api request failed:', error);
    const message = error instanceof Error ? error.message : 'No se pudo completar la solicitud.';
    if (message.includes('duplicate key') || message.includes('23505')) return json({ error: 'Este movimiento ya existe.', code: '23505' }, 409);
    return json({ error: message === 'Failed to fetch' ? 'No se pudo conectar con la cuenta.' : 'No se pudo completar la solicitud.' }, 500);
  }
});
