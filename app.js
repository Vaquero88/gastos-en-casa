const MONTHS = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const CATEGORIES = {
  Fijos: ['Electricidad','Agua','Gas','Comunidad','Comunicaciones','TV','Seguros','Alarma','Ahorros Hucha','Préstamo Conchi','IBI y basura','Hipoteca','Financiaciones','Otros fijos'],
  Comida: ['Supermercado','Comida domicilio','Otros comida'],
  Ocio: ['Viajes','Tomar algo','Otros ocio'],
  Hogar: ['Mobiliario','Electrodomésticos','Mantenimiento','Otros hogar'],
  Salud: ['Medicinas','Servicios','Otros salud'],
  Transporte: ['Mantenimiento','Seguros vehículo','Combustible','Taxi / bus / tren','Otros transporte'],
  Animales: ['Comida','Veterinario','Peluquería','Otros animales'],
  Otros: ['Otros'],
};
const HOUSEHOLD_ID = 'f8578860-5cab-48bf-8643-6c6ca874036c';
const now = new Date();
const supabaseClient = window.supabase?.createClient(
  window.CASA_SUPABASE_URL,
  window.CASA_SUPABASE_PUBLISHABLE_KEY,
);

let selectedYear = now.getFullYear();
let selectedMonth = now.getMonth();
let activeView = 'inicio';
let movementFilter = 'todos';
let editingId = null;
let currentUser = null;
let currentMember = null;
let loadedUserId = null;
let sessionLoadSequence = 0;
let db = { openingBalance: 0, initialSavings: 0, initialTito: 0, initialSheila: 0, movements: [] };

const authGate = document.getElementById('authGate');
const appShell = document.getElementById('appShell');
const authMessage = document.getElementById('authMessage');
const dialog = document.getElementById('movementDialog');
const form = document.getElementById('movementForm');

function euro(value) {
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(value || 0);
}
function monthName(month = selectedMonth) { return MONTHS[month]; }
function monthKey(year, month) { return year * 12 + month; }
function dateForInput() {
  const day = Math.min(now.getDate(), new Date(selectedYear, selectedMonth + 1, 0).getDate());
  return `${selectedYear}-${String(selectedMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);
}
function toast(message, isError = false) {
  const element = document.createElement('div');
  element.className = 'toast';
  if (isError) element.style.background = '#a44d54';
  element.textContent = message;
  document.body.append(element);
  setTimeout(() => element.remove(), 2800);
}
function showAuth(message = '', isError = false) {
  authGate.hidden = false;
  appShell.hidden = true;
  authMessage.textContent = message;
  authMessage.classList.toggle('error', isError);
}
function mapFromDatabase(row) {
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
    createdAt: Date.parse(row.created_at || row.fecha),
  };
}
function forCurrentPeriod(movement) {
  return movement.periodYear === selectedYear && movement.periodMonth === selectedMonth + 1;
}
function currentMovements() { return db.movements.filter(forCurrentPeriod); }
function totals() {
  const list = currentMovements();
  const income = list.filter(item => item.type === 'ingreso').reduce((sum, item) => sum + item.amount, 0);
  const expenses = list.filter(item => item.type === 'gasto');
  const expense = expenses.reduce((sum, item) => sum + item.amount, 0);
  const period = monthKey(selectedYear, selectedMonth + 1);
  const balance = db.openingBalance + db.movements
    .filter(item => monthKey(item.periodYear, item.periodMonth) <= period)
    .reduce((sum, item) => sum + (item.type === 'ingreso' ? item.amount : -item.amount), 0);
  return { list, income, expense, expenses, balance };
}

async function activateSession(session) {
  if (!session || !supabaseClient) return;
  if (loadedUserId === session.user.id && !appShell.hidden) return;
  const sequence = ++sessionLoadSequence;
  try {
    const { data: member, error: memberError } = await supabaseClient
      .from('casa_miembros')
      .select('id,hogar_id,auth_user_id,email,nombre,rol,activo')
      .eq('auth_user_id', session.user.id)
      .eq('activo', true)
      .maybeSingle();
    if (memberError) throw memberError;
    if (!member) {
      loadedUserId = null;
      await supabaseClient.auth.signOut();
      showAuth('Ese correo todavía no tiene acceso a este hogar. Revisa la dirección o pide que te habiliten.', true);
      return;
    }
    const [{ data: household, error: householdError }, { data: rows, error: movementsError }] = await Promise.all([
      supabaseClient.from('casa_hogares')
        .select('id,nombre,saldo_inicial,hucha_inicial,aportacion_inicial_tito,aportacion_inicial_sheila')
        .eq('id', member.hogar_id).single(),
      supabaseClient.from('casa_movimientos')
        .select('*').eq('hogar_id', member.hogar_id).eq('archivado', false)
        .order('periodo_anio').order('periodo_mes').order('fecha'),
    ]);
    if (householdError) throw householdError;
    if (movementsError) throw movementsError;
    if (sequence !== sessionLoadSequence) return;
    currentUser = session.user;
    currentMember = member;
    loadedUserId = session.user.id;
    db = {
      openingBalance: Number(household.saldo_inicial || 0),
      initialSavings: Number(household.hucha_inicial || 0),
      initialTito: Number(household.aportacion_inicial_tito || 0),
      initialSheila: Number(household.aportacion_inicial_sheila || 0),
      movements: (rows || []).map(mapFromDatabase),
    };
    document.querySelector('.profile-button strong').textContent = member.nombre;
    document.querySelector('.profile-button small').textContent = member.rol === 'admin' ? 'Administrador' : 'Solo lectura';
    document.querySelector('.profile-button .avatar').textContent = (member.nombre || '?').slice(0, 1).toUpperCase();
    setWriteAccess(member.rol === 'admin');
    authGate.hidden = true;
    appShell.hidden = false;
    render();
  } catch (error) {
    showAuth('No se pudo cargar el hogar. Comprueba la conexión e inténtalo de nuevo.', true);
    console.error('No se pudo cargar Supabase:', error);
  }
}
function setWriteAccess(canWrite) {
  ['addMovement', 'addContribution', 'addContributionView', 'emptyAdd'].forEach(id => {
    const button = document.getElementById(id);
    if (button) button.hidden = !canWrite;
  });
}
async function refreshMovements() {
  const { data, error } = await supabaseClient.from('casa_movimientos')
    .select('*').eq('hogar_id', currentMember.hogar_id).eq('archivado', false)
    .order('periodo_anio').order('periodo_mes').order('fecha');
  if (error) throw error;
  db.movements = (data || []).map(mapFromDatabase);
  render();
}

function render() {
  if (!currentMember) return;
  const result = totals();
  document.getElementById('monthLabel').textContent = `${monthName()} ${selectedYear}`;
  document.getElementById('periodText').textContent = `${monthName().toLocaleLowerCase('es-ES')} de ${selectedYear}`;
  document.getElementById('balanceValue').textContent = euro(result.balance);
  document.getElementById('incomeValue').textContent = euro(result.income);
  document.getElementById('expenseValue').textContent = euro(result.expense);
  document.getElementById('netValue').textContent = euro(result.income - result.expense);
  document.getElementById('balanceCaption').textContent = `Saldo inicial: ${euro(db.openingBalance)}`;
  document.getElementById('expenseCount').textContent = `${result.expenses.length} ${result.expenses.length === 1 ? 'movimiento' : 'movimientos'}`;
  const byPerson = { Tito: 0, Sheila: 0, Varios: 0 };
  result.list.filter(item => item.type === 'ingreso').forEach(item => {
    byPerson[item.person] = (byPerson[item.person] || 0) + item.amount;
  });
  document.getElementById('contributionTotal').textContent = euro(result.income);
  document.getElementById('peopleList').innerHTML = ['Tito', 'Sheila'].map(name => `
    <div class="person-row"><span class="person-avatar ${name.toLowerCase()}">${name[0]}</span>
    <span class="person-name"><strong>${name}</strong><small>Aportación del mes</small></span>
    <span class="person-amount">${euro(byPerson[name] || 0)}</span>
    <span class="person-track"><i style="width:${result.income ? Math.min(100, Math.max(0, (byPerson[name] || 0) / result.income * 100)) : 0}%"></i></span></div>`).join('');
  renderMiniBars();
  renderTransactions(result.list);
  renderCategories(result.expenses);
  renderSecondaryViews(result);
}
function renderMiniBars() {
  const incomeBars = document.getElementById('incomeBars');
  const expenseBars = document.getElementById('expenseBars');
  incomeBars.innerHTML = '';
  expenseBars.innerHTML = '';
  const byMonth = Array.from({ length: 12 }, (_, month) => db.movements.filter(item => item.periodYear === selectedYear && item.periodMonth === month + 1));
  const maxIncome = Math.max(1, ...byMonth.map(list => list.filter(item => item.type === 'ingreso').reduce((sum, item) => sum + item.amount, 0)));
  const maxExpense = Math.max(1, ...byMonth.map(list => list.filter(item => item.type === 'gasto').reduce((sum, item) => sum + item.amount, 0)));
  byMonth.slice(-6).forEach(list => {
    const income = list.filter(item => item.type === 'ingreso').reduce((sum, item) => sum + item.amount, 0);
    const expense = list.filter(item => item.type === 'gasto').reduce((sum, item) => sum + item.amount, 0);
    const incomeBar = document.createElement('i');
    const expenseBar = document.createElement('i');
    incomeBar.style.height = `${Math.max(3, Math.min(22, income / maxIncome * 22))}px`;
    expenseBar.style.height = `${Math.max(3, Math.min(22, expense / maxExpense * 22))}px`;
    incomeBars.append(incomeBar);
    expenseBars.append(expenseBar);
  });
}
function transactionRow(item) {
  const cashflow = item.type === 'ingreso' ? item.amount : -item.amount;
  const positive = cashflow >= 0;
  const date = new Date(`${item.date}T12:00:00`).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
  const iconClass = item.type === 'ingreso' ? 'income' : item.category === 'Fijos' ? 'fixed' : 'variable';
  const icon = item.type === 'ingreso' ? '↗' : item.category === 'Fijos' ? '⌂' : '✳';
  const actions = currentMember?.rol === 'admin'
    ? `<span class="transaction-actions"><button aria-label="Editar" data-edit="${item.id}">✎</button><button aria-label="Archivar" data-archive="${item.id}">×</button></span>`
    : '';
  return `<div class="transaction-row"><span class="transaction-icon ${iconClass}">${icon}</span>
    <span class="transaction-main"><strong>${escapeHtml(item.description)}</strong><small>${date} · ${escapeHtml(item.type === 'ingreso' ? (item.person || 'Varios') : item.category)}</small></span>
    <span class="transaction-category"><strong>${item.type === 'ingreso' ? 'Aportación' : escapeHtml(item.category)}</strong><small>${item.type === 'ingreso' ? 'Ingreso' : escapeHtml(item.subcategory || '')}</small></span>
    <span class="transaction-amount ${positive ? 'income' : 'outflow'}">${positive ? '+' : '−'}${euro(Math.abs(item.amount))}</span>${actions}</div>`;
}
function bindTransactionActions(host) {
  host.querySelectorAll('[data-archive]').forEach(button => button.onclick = () => archiveMovement(button.dataset.archive));
  host.querySelectorAll('[data-edit]').forEach(button => button.onclick = () => editMovement(button.dataset.edit));
}
function renderTransactions(list) {
  const host = document.getElementById('transactionList');
  const empty = document.getElementById('emptyTransactions');
  const sorted = [...list].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
  host.innerHTML = sorted.slice(0, 6).map(transactionRow).join('');
  empty.classList.toggle('show', list.length === 0);
  host.style.display = list.length ? 'block' : 'none';
  bindTransactionActions(host);
}
function renderCategories(expenses) {
  const totalsByCategory = {};
  expenses.forEach(item => totalsByCategory[item.category] = (totalsByCategory[item.category] || 0) + item.amount);
  const pairs = Object.entries(totalsByCategory).sort((a, b) => b[1] - a[1]);
  const host = document.getElementById('categoryOverview');
  document.getElementById('emptyCategories').classList.toggle('show', !pairs.length);
  host.innerHTML = pairs.slice(0, 8).map(([name, amount]) => `<div class="category-item"><div class="category-title"><span>${escapeHtml(name)}</span><strong>${euro(amount)}</strong></div><div class="category-track"><i style="width:${pairs[0][1] ? Math.max(3, Math.abs(amount / pairs[0][1] * 100)) : 3}%"></i></div></div>`).join('');
}
function renderSecondaryViews(result) {
  document.querySelectorAll('.selected-month-inline').forEach(element => element.textContent = monthName().toLowerCase());
  const search = (document.getElementById('movementSearch')?.value || '').trim().toLocaleLowerCase('es-ES');
  const allHost = document.getElementById('allTransactionList');
  const allEmpty = document.getElementById('emptyMovementView');
  const allRows = [...result.list].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt)
    .filter(item => (movementFilter === 'todos' || item.type === movementFilter)
      && (!search || `${item.description} ${item.category} ${item.subcategory} ${item.person || ''}`.toLocaleLowerCase('es-ES').includes(search)));
  allHost.innerHTML = allRows.map(transactionRow).join('');
  allEmpty.classList.toggle('show', allRows.length === 0);
  allHost.style.display = allRows.length ? 'block' : 'none';
  document.getElementById('movementViewCount').textContent = `${allRows.length} ${allRows.length === 1 ? 'movimiento' : 'movimientos'}`;
  bindTransactionActions(allHost);
  document.querySelectorAll('[data-movement-filter]').forEach(button => button.classList.toggle('active', button.dataset.movementFilter === movementFilter));

  const incomes = result.list.filter(item => item.type === 'ingreso');
  const byPerson = { Tito: 0, Sheila: 0, Varios: 0 };
  incomes.forEach(item => byPerson[item.person] = (byPerson[item.person] || 0) + item.amount);
  document.getElementById('contributionSummaryGrid').innerHTML = ['Tito', 'Sheila'].map(name => `
    <article class="panel contribution-person-card"><span class="person-avatar ${name.toLowerCase()}">${name[0]}</span>
    <span class="contribution-card-name">${name}</span><strong>${euro(byPerson[name] || 0)}</strong>
    <small>Aportado en ${monthName().toLowerCase()}</small></article>`).join('') + `
    <article class="panel contribution-person-card total-contribution-card"><span class="contribution-total-icon">＋</span>
    <span class="contribution-card-name">Total aportado</span><strong>${euro(result.income)}</strong>
    <small>Ingresos en la cuenta común</small></article>`;
  const history = document.getElementById('contributionHistory');
  history.innerHTML = [...incomes].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt).map(transactionRow).join('');
  history.style.display = incomes.length ? 'block' : 'none';
  document.getElementById('emptyContributionView').classList.toggle('show', !incomes.length);
  bindTransactionActions(history);

  const groups = {};
  result.expenses.forEach(item => {
    const category = item.category || 'Otros';
    const subcategory = item.subcategory || 'Otros';
    groups[category] ??= { total: 0, subs: {} };
    groups[category].total += item.amount;
    groups[category].subs[subcategory] = (groups[category].subs[subcategory] || 0) + item.amount;
  });
  const groupList = Object.entries(groups).sort((a, b) => b[1].total - a[1].total);
  document.getElementById('categoryDetailList').innerHTML = groupList.map(([name, data]) => `
    <article class="category-detail-card"><div class="category-detail-head"><span class="category-detail-icon">${name === 'Fijos' ? '⌂' : '✳'}</span>
    <div><strong>${escapeHtml(name)}</strong><small>${Object.keys(data.subs).length} ${Object.keys(data.subs).length === 1 ? 'subcategoría' : 'subcategorías'}</small></div>
    <b>${euro(data.total)}</b></div><div class="subcategory-breakdown">${Object.entries(data.subs).sort((a, b) => b[1] - a[1]).map(([subcategory, amount]) => `
      <div><span>${escapeHtml(subcategory)}</span><strong>${euro(amount)}</strong></div>`).join('')}</div></article>`).join('');
  document.getElementById('emptyCategoryView').classList.toggle('show', !groupList.length);
}

const VIEW_META = {
  inicio: { title: 'Resumen', subtitle: 'Todo lo que entra y sale de vuestra cuenta común.' },
  movimientos: { title: 'Movimientos', subtitle: 'Consulta y busca los ingresos y gastos del mes.' },
  aportaciones: { title: 'Aportaciones', subtitle: 'Lo que Tito y Sheila ingresan en la cuenta común.' },
  categorias: { title: 'Categorías', subtitle: 'Descubre en qué se distribuyen los gastos del mes.' },
};
function setView(view) {
  if (!VIEW_META[view]) return;
  activeView = view;
  document.getElementById('pageTitle').textContent = VIEW_META[view].title;
  document.getElementById('pageSubtitle').textContent = VIEW_META[view].subtitle;
  document.getElementById('breadcrumb').textContent = VIEW_META[view].title;
  document.getElementById('dashboardView').hidden = view !== 'inicio';
  document.getElementById('secondaryView').hidden = view === 'inicio';
  document.querySelectorAll('.secondary-page').forEach(section => section.hidden = section.id !== `${view}View`);
  document.querySelectorAll('.nav-link').forEach(link => {
    const active = link.dataset.view === view;
    link.classList.toggle('active', active);
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function openMovement(type = 'gasto', item = null) {
  if (currentMember?.rol !== 'admin') return;
  editingId = item?.id || null;
  form.reset();
  document.getElementById('date').value = item?.date || dateForInput();
  const category = document.getElementById('category');
  category.innerHTML = Object.keys(CATEGORIES).map(name => `<option>${escapeHtml(name)}</option>`).join('');
  document.getElementById('description').value = item?.description || '';
  document.getElementById('amount').value = item?.amount ?? '';
  document.getElementById('notes').value = item?.notes || '';
  document.getElementById('person').value = item?.person || 'Tito';
  if (item?.category) category.value = item.category;
  updateSubcategories(item?.subcategory || '');
  setType(item?.type || type);
  document.querySelectorAll('.form-error').forEach(element => element.remove());
  dialog.showModal();
  setTimeout(() => document.getElementById('description').focus(), 50);
}
function setType(type) {
  document.getElementById('movementType').value = type;
  document.querySelectorAll('.type-option').forEach(button => button.classList.toggle('active', button.dataset.type === type));
  const income = type === 'ingreso';
  document.getElementById('categoryField').style.display = income ? 'none' : 'grid';
  document.getElementById('subcategoryField').style.display = income ? 'none' : 'grid';
  document.getElementById('personField').style.display = income ? 'grid' : 'none';
  document.getElementById('category').required = !income;
  document.getElementById('subcategory').required = !income;
  document.getElementById('amount').min = income ? '0.01' : '-9999999';
  document.getElementById('amountHint').hidden = income;
  document.getElementById('dialogTitle').textContent = editingId ? 'Editar movimiento' : income ? 'Añadir ingreso o aportación' : 'Añadir gasto';
}
function updateSubcategories(selected = '') {
  const category = document.getElementById('category').value;
  const select = document.getElementById('subcategory');
  const options = CATEGORIES[category] || [];
  select.innerHTML = '<option value="">Elige una subcategoría</option>' + options.map(value => `<option>${escapeHtml(value)}</option>`).join('');
  if (options.includes(selected)) select.value = selected;
}
function closeDialog() { dialog.close(); editingId = null; }
async function saveMovement(event) {
  event.preventDefault();
  if (currentMember?.rol !== 'admin') return;
  const type = document.getElementById('movementType').value;
  const amount = Number(document.getElementById('amount').value);
  if (!Number.isFinite(amount) || amount === 0 || (type === 'ingreso' && amount < 0)) return;
  const date = document.getElementById('date').value;
  const movement = {
    hogar_id: currentMember.hogar_id,
    fecha: date,
    periodo_anio: selectedYear,
    periodo_mes: selectedMonth + 1,
    descripcion: document.getElementById('description').value.trim(),
    tipo: type,
    categoria: type === 'ingreso' ? 'Aportación' : document.getElementById('category').value,
    subcategoria: type === 'ingreso' ? document.getElementById('person').value : document.getElementById('subcategory').value,
    persona: type === 'ingreso' ? document.getElementById('person').value : null,
    importe: amount,
    notas: document.getElementById('notes').value.trim(),
    creado_por: currentUser.id,
  };
  if (!date || !movement.descripcion) return;
  try {
    const response = editingId
      ? await supabaseClient.from('casa_movimientos').update(movement).eq('id', editingId).eq('hogar_id', currentMember.hogar_id)
      : await supabaseClient.from('casa_movimientos').insert(movement);
    if (response.error) throw response.error;
    closeDialog();
    await refreshMovements();
    toast(editingId ? 'Movimiento actualizado' : 'Movimiento guardado');
  } catch (error) {
    toast('No se pudo guardar el movimiento. Inténtalo de nuevo.', true);
    console.error('Error al guardar movimiento:', error);
  }
}
async function archiveMovement(id) {
  const movement = db.movements.find(item => item.id === id);
  if (!movement || currentMember?.rol !== 'admin' || !confirm(`¿Archivar «${movement.description}»?`)) return;
  const { error } = await supabaseClient.from('casa_movimientos').update({ archivado: true }).eq('id', id).eq('hogar_id', currentMember.hogar_id);
  if (error) { toast('No se pudo archivar el movimiento.', true); return; }
  await refreshMovements();
  toast('Movimiento archivado');
}
function editMovement(id) {
  const movement = db.movements.find(item => item.id === id);
  if (movement) openMovement(movement.type, movement);
}

document.getElementById('authForm').addEventListener('submit', async event => {
  event.preventDefault();
  const email = document.getElementById('authEmail').value.trim();
  const button = document.getElementById('sendMagicLink');
  if (!supabaseClient) { showAuth('No se pudo iniciar la conexión con la base de datos.', true); return; }
  button.disabled = true;
  authMessage.classList.remove('error');
  authMessage.textContent = 'Enviando enlace…';
  const { error } = await supabaseClient.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${window.location.origin}${window.location.pathname}` },
  });
  button.disabled = false;
  if (error) {
    authMessage.textContent = 'No se pudo enviar el enlace. Inténtalo de nuevo.';
    authMessage.classList.add('error');
    console.error('Error de inicio de sesión:', error);
    return;
  }
  authMessage.textContent = 'Si el correo está habilitado, recibirás un enlace de acceso.';
});

document.getElementById('signOut').onclick = async () => { await supabaseClient.auth.signOut(); };
document.getElementById('addMovement').onclick = () => openMovement('gasto');
document.getElementById('emptyAdd').onclick = () => openMovement('gasto');
document.getElementById('addContribution').onclick = () => openMovement('ingreso');
document.getElementById('addContributionView').onclick = () => openMovement('ingreso');
document.getElementById('closeDialog').onclick = closeDialog;
document.getElementById('cancelDialog').onclick = closeDialog;
document.querySelectorAll('.type-option').forEach(button => button.onclick = () => setType(button.dataset.type));
document.getElementById('category').addEventListener('change', () => updateSubcategories());
form.addEventListener('submit', saveMovement);
document.getElementById('prevMonth').onclick = () => moveMonth(-1);
document.getElementById('nextMonth').onclick = () => moveMonth(1);
document.getElementById('currentMonth').onclick = () => { selectedYear = now.getFullYear(); selectedMonth = now.getMonth(); render(); };
function moveMonth(offset) {
  const next = new Date(selectedYear, selectedMonth + offset, 1);
  selectedYear = next.getFullYear();
  selectedMonth = next.getMonth();
  render();
}
document.querySelectorAll('[data-view]').forEach(element => element.addEventListener('click', event => {
  event.preventDefault();
  setView(element.dataset.view);
}));
document.querySelectorAll('[data-movement-filter]').forEach(button => button.addEventListener('click', () => {
  movementFilter = button.dataset.movementFilter;
  render();
}));
document.getElementById('movementSearch').addEventListener('input', () => render());

clientEventListener();
async function clientEventListener() {
  if (!supabaseClient) {
    showAuth('Falta la configuración pública de Supabase.', true);
    return;
  }
  supabaseClient.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT') {
      sessionLoadSequence++;
      loadedUserId = null;
      currentUser = null;
      currentMember = null;
      db.movements = [];
      showAuth();
      return;
    }
    if (session) setTimeout(() => activateSession(session), 0);
  });
  const { data, error } = await supabaseClient.auth.getSession();
  if (error) { showAuth('No se pudo comprobar la sesión.', true); return; }
  if (data.session) await activateSession(data.session);
  else showAuth();
}

