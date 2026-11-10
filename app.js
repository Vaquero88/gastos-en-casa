const MONTHS = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const CATEGORIES = {
  Fijos: ['Electricidad','Agua','Gas','Comunidad','Comunicaciones','TV','Seguros','Alarma','Ahorros Hucha','Préstamo Conchi','Préstamo Carmen','IBI y basura','Hipoteca','Financiaciones','Otros fijos'],
  Comida: ['Supermercado','Comida domicilio','Otros comida'],
  Ocio: ['Viajes','Tomar algo','Otros ocio'],
  Hogar: ['Mobiliario','Electrodomésticos','Mantenimiento','Otros hogar'],
  Salud: ['Medicinas','Servicios','Otros salud'],
  Transporte: ['Mantenimiento','Seguros vehículo','Combustible','Taxi / bus / tren','Otros transporte'],
  Animales: ['Comida','Veterinario','Peluquería','Otros animales'],
  Otros: ['Otros'],
};
const HOUSEHOLD_ID = 'f8578860-5cab-48bf-8643-6c6ca874036c';
const SESSION_STORAGE_KEY = 'casa-en-comun-session-v1';
const CASA_API_URL = `${String(window.CASA_SUPABASE_URL || '').replace(/\/+$/, '')}/functions/v1/casa-api`;
const now = new Date();
let sessionToken = sessionStorage.getItem(SESSION_STORAGE_KEY) || '';

let selectedYear = now.getFullYear();
let selectedMonth = now.getMonth();
let activeView = 'inicio';
let movementFilter = 'todos';
let movementCategories = null;
let categoryPeriodMode = 'month';
let chartPeriodMode = 'year';
let editingId = null;
let currentMember = null;
let dataLoaded = false;
let undoHistory = [];
let redoHistory = [];
let db = { openingBalance: 0, initialSavings: 0, initialConchiDebt: 0, initialTito: 0, initialSheila: 0, movements: [] };

const appShell = document.getElementById('appShell');
const authGate = document.getElementById('authGate');
const dialog = document.getElementById('movementDialog');
const form = document.getElementById('movementForm');

async function requestApi(action, payload = {}, token = sessionToken) {
  const headers = {
    'Content-Type': 'application/json',
    apikey: window.CASA_SUPABASE_PUBLISHABLE_KEY,
  };
  if (token) headers['x-casa-session'] = token;
  const response = await fetch(CASA_API_URL, { method: 'POST', headers, body: JSON.stringify({ action, ...payload }) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(result.error || 'No se pudo completar la solicitud.');
    error.status = response.status;
    error.code = result.code;
    throw error;
  }
  return result;
}
function showAuthGate(message = '') {
  appShell.hidden = true;
  authGate.hidden = false;
  const messageElement = document.getElementById('loginMessage');
  messageElement.textContent = message;
  messageElement.classList.toggle('error', Boolean(message));
}
function setAuthSession(token) {
  sessionToken = token || '';
  if (sessionToken) sessionStorage.setItem(SESSION_STORAGE_KEY, sessionToken);
  else sessionStorage.removeItem(SESSION_STORAGE_KEY);
}

function euro(value) {
  return new Intl.NumberFormat('es-ES', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value || 0);
}
function monthName(month = selectedMonth) { return MONTHS[month]; }
function monthKey(year, month) { return year * 12 + month; }
function remainingTerm(months) {
  const years = Math.floor(months / 12);
  const remainingMonths = months % 12;
  if (years && remainingMonths) return `${years} ${years === 1 ? 'año' : 'años'} y ${remainingMonths} ${remainingMonths === 1 ? 'mes' : 'meses'}`;
  if (years) return `${years} ${years === 1 ? 'año' : 'años'}`;
  return `${remainingMonths} ${remainingMonths === 1 ? 'mes' : 'meses'}`;
}
function latestLoanInstallment(subcategory, totalInstallments) {
  // Debt cards show the latest recorded installment, regardless of the month being viewed.
  return db.movements
    .filter(item => item.type === 'gasto' && item.category === 'Fijos' && item.subcategory === subcategory)
    .map(item => {
      const match = item.description.match(/(\d{1,3})\s+de\s+(\d{1,3})/i);
      if (!match || Number(match[2]) !== totalInstallments) return null;
      return { number: Number(match[1]), amount: Math.abs(item.amount), period: monthKey(item.periodYear, item.periodMonth), date: item.date };
    })
    .filter(Boolean)
    .sort((a, b) => a.period - b.period || a.date.localeCompare(b.date))
    .at(-1) || null;
}
function dateForInput() {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
function fixedMonthlyTemplates(year = selectedYear, month = selectedMonth) {
  const previous = new Date(year, month - 1, 1);
  const previousName = MONTHS[previous.getMonth()];
  const previousYearShort = String(previous.getFullYear()).slice(-2);
  const monthOffset = (year - 2026) * 12 + (month - 10);
  const huchaCount = 30 + monthOffset;
  const conchiCount = 68 + monthOffset;
  const mortgageCount = 68 + monthOffset;
  const items = [
    { id: 'aportacion-tito', description: 'Aportación mensual 1', type: 'ingreso', category: 'Ingresos', subcategory: 'Tito', person: 'Tito', amount: 800 },
    { id: 'aportacion-sheila', description: 'Aportación mensual 1 (750+50 ahorro)', type: 'ingreso', category: 'Ingresos', subcategory: 'Sheila', person: 'Sheila', amount: 800 },
    { id: 'comunidad', description: 'Comunidad', type: 'gasto', category: 'Fijos', subcategory: 'Comunidad', amount: 97.60 },
    { id: 'ahorros-hucha', description: `Ahorros Hucha ${huchaCount}`, type: 'gasto', category: 'Fijos', subcategory: 'Ahorros Hucha', amount: 50 },
  ];
  if (conchiCount >= 1 && conchiCount <= 134) items.push({ id: 'prestamo-conchi', description: `Préstamo Conchi ${String(conchiCount).padStart(3, '0')} de 134`, type: 'gasto', category: 'Fijos', subcategory: 'Préstamo Conchi', amount: 300 });
  if (mortgageCount >= 1 && mortgageCount <= 360) items.push({ id: 'hipoteca', description: `Hipoteca ${String(mortgageCount).padStart(3, '0')} de 360`, type: 'gasto', category: 'Fijos', subcategory: 'Hipoteca', amount: 536.31 });
  items.push(
    { id: 'vodafone-lowi', description: `Vodafone (Lowi) - ${previousName} ${previousYearShort}`, type: 'gasto', category: 'Fijos', subcategory: 'Comunicaciones', amount: 28 },
    { id: 'luz-total-energy', description: `Luz TotalEnergy ${previousName} ${previousYearShort}`, type: 'gasto', category: 'Fijos', subcategory: 'Electricidad', amount: null },
    { id: 'luz-coche', description: `Luz coche ${previousName} ${previousYearShort}`, type: 'gasto', category: 'Fijos', subcategory: 'Electricidad', amount: -30 },
  );
  if ([1, 3, 5, 7, 9, 11].includes(month)) {
    items.push({ id: 'redexis-glp', description: `Redexis GLP - ${previousName} y ${MONTHS[month]}`, type: 'gasto', category: 'Fijos', subcategory: 'Gas', amount: null });
  }
  if (month >= 2 && month <= 10) {
    const installment = month - 1;
    items.push({ id: 'ibi-basura', description: `IBI y basura ${installment}/9`, type: 'gasto', category: 'Fijos', subcategory: 'IBI y basura', amount: 67.61 });
  }
  return items;
}
function normalizeFixedDescription(value = '') {
  return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
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
    fixedTemplateId: row.plantilla_fijo_id || null,
    createdAt: Date.parse(row.created_at || row.fecha),
  };
}
function localDateStamp(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
async function downloadBackup() {
  if (!dataLoaded) {
    toast('Espera a que se carguen los datos antes de guardar la copia.', true);
    return;
  }
  try {
    const movements = currentMember?.hogar_id
      ? (await fetchAllMovements(currentMember.hogar_id, true)).map(row => ({ ...mapFromDatabase(row), archived: Boolean(row.archivado) }))
      : db.movements.map(item => ({ ...item, archived: Boolean(item.archived) }));
    const backup = {
      format: 'casa-en-comun-backup',
      version: 1,
      exportedAt: new Date().toISOString(),
      householdId: currentMember?.hogar_id || null,
      balances: {
        openingBalance: db.openingBalance,
        initialSavings: db.initialSavings,
        initialConchiDebt: db.initialConchiDebt,
        initialTito: db.initialTito,
        initialSheila: db.initialSheila,
      },
      movements,
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `casa-en-comun-copia-${localDateStamp()}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast(`Copia descargada con ${movements.length} movimientos.`);
  } catch (error) {
    console.error('No se pudo crear la copia de seguridad:', error);
    toast('No se pudo crear la copia. Comprueba la conexión e inténtalo de nuevo.', true);
  }
}
function validateBackup(backup) {
  if (!backup || backup.format !== 'casa-en-comun-backup' || backup.version !== 1) throw new Error('El archivo no es una copia válida de Casa en común.');
  const balanceKeys = ['openingBalance', 'initialSavings', 'initialConchiDebt', 'initialTito', 'initialSheila'];
  if (!backup.balances || balanceKeys.some(key => !Number.isFinite(Number(backup.balances[key])))) throw new Error('La copia no contiene todos los saldos iniciales.');
  if (!Array.isArray(backup.movements)) throw new Error('La copia no contiene una lista de movimientos válida.');
  const ids = new Set();
  for (const item of backup.movements) {
    if (!item || typeof item.id !== 'string' || !item.id || ids.has(item.id)) throw new Error('La copia contiene movimientos con identificadores inválidos o repetidos.');
    ids.add(item.id);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(item.date || '') || !Number.isInteger(Number(item.periodYear)) || !Number.isInteger(Number(item.periodMonth)) || Number(item.periodMonth) < 1 || Number(item.periodMonth) > 12) throw new Error('La copia contiene un movimiento con fecha o mes no válidos.');
    if (!['ingreso', 'gasto'].includes(item.type) || !Number.isFinite(Number(item.amount)) || typeof item.description !== 'string' || typeof item.category !== 'string') throw new Error('La copia contiene un movimiento con datos no válidos.');
  }
  return backup;
}
async function restoreBackupData(backup) {
  const balances = {
    openingBalance: Number(backup.balances.openingBalance),
    initialSavings: Number(backup.balances.initialSavings),
    initialConchiDebt: Number(backup.balances.initialConchiDebt),
    initialTito: Number(backup.balances.initialTito),
    initialSheila: Number(backup.balances.initialSheila),
  };
    if (!currentMember?.hogar_id) throw new Error('Inicia sesión antes de restaurar una copia.');
    await requestApi('restoreBackup', { householdId: currentMember.hogar_id, balances, movements: backup.movements });
  db = { ...db, ...balances, movements: backup.movements.filter(item => !item.archived).map(item => ({ ...item })) };
  undoHistory = [];
  redoHistory = [];
  render();
}
async function handleBackupRestore(file) {
  if (!file) return;
  try {
    if (!dataLoaded) throw new Error('Espera a que se carguen los datos antes de restaurar una copia.');
    const backup = validateBackup(JSON.parse(await file.text()));
    if (currentMember?.hogar_id && backup.householdId && backup.householdId !== currentMember.hogar_id) throw new Error('Esta copia pertenece a otra cuenta común.');
    const accepted = window.confirm(`Se restaurarán ${backup.movements.length} movimientos y sus saldos iniciales. Los datos actuales que no estén en la copia quedarán archivados. ¿Quieres continuar?`);
    if (!accepted) return;
    await restoreBackupData(backup);
    toast(`Copia restaurada con ${backup.movements.length} movimientos.`);
  } catch (error) {
    console.error('No se pudo restaurar la copia:', error);
    toast(error.message || 'No se pudo restaurar la copia. Comprueba el archivo y la conexión.', true);
  }
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
  const balance = db.openingBalance + db.movements
    .reduce((sum, item) => sum + (item.type === 'ingreso' ? item.amount : -item.amount), 0);
  return { list, income, expense, expenses, balance };
}
function matchesFixedTemplateMovement(movement, template) {
  if (movement.fixedTemplateId) return movement.fixedTemplateId === template.id;
  if (movement.type !== template.type) return false;
  const description = normalizeFixedDescription(movement.description);
  if (template.type === 'ingreso') return movement.person === template.person
    || movement.subcategory === template.person || movement.category === template.person
    || description === normalizeFixedDescription(template.description);
  if (movement.category !== template.category || movement.subcategory !== template.subcategory) return false;
  if (template.id === 'luz-coche') return description.includes('luzcoche');
  if (template.id === 'luz-total-energy') return !description.includes('luzcoche');
  if (template.id === 'vodafone-lowi') return description.includes('vodafone') || description.includes('lowi');
  if (template.id === 'redexis-glp') return description.includes('redexis');
  if (template.id === 'ahorros-hucha') return description.includes('ahoroshucha');
  if (template.id === 'prestamo-conchi') return description.includes('prestamoconchi');
  if (template.id === 'hipoteca') return description.includes('hipoteca');
  if (template.id === 'ibi-basura') return description.includes('ibiybasura') || description.includes('basura');
  return normalizeFixedDescription(movement.description) === normalizeFixedDescription(template.description);
}
function recentYearAverage(yearTotals) {
  const recent = [...yearTotals.entries()].sort((a, b) => b[0] - a[0]).slice(0, 3).map(([, amount]) => amount);
  return recent.length ? recent.reduce((sum, amount) => sum + amount, 0) / recent.length : null;
}
function forecastExpenses(balance) {
  const forecastDate = new Date();
  const forecastYear = forecastDate.getFullYear();
  const forecastMonth = forecastDate.getMonth();
  const monthNumber = forecastMonth + 1;
  const inForecastPeriod = item => item.periodYear === forecastYear && item.periodMonth === monthNumber;
  const currentPeriodMovements = db.movements.filter(item => !item.archived && inForecastPeriod(item));
  const previousMovements = db.movements.filter(item => !item.archived && item.periodMonth === monthNumber && item.periodYear < forecastYear);

  // November 2026 has two outstanding electricity bills and known remaining costs supplied by the user.
  if (forecastYear === 2026 && monthNumber === 11) {
    const expenses = [];
    const electricity = currentPeriodMovements.filter(item => item.type === 'gasto' && item.category === 'Fijos'
      && item.subcategory === 'Electricidad' && item.amount > 0);
    const energyFor = (fullMonth, shortMonth) => electricity.filter(item => {
      const description = normalizeFixedDescription(item.description);
      return description.includes(fullMonth) || description.includes(shortMonth);
    }).reduce((sum, item) => sum + item.amount, 0);
    const octoberPaid = energyFor('octubre', 'oct');
    const novemberPaid = energyFor('noviembre', 'nov');
    const namedPaid = octoberPaid + novemberPaid;
    const genericPaid = Math.max(0, electricity.reduce((sum, item) => sum + item.amount, 0) - namedPaid);
    const octoberPending = Math.max(0, 55 - octoberPaid);
    const novemberPending = Math.max(0, 60 - novemberPaid - genericPaid);
    if (octoberPending) expenses.push({ label: 'Luz atrasada de octubre', amount: octoberPending, note: 'Importe aproximado: 55,00 €.' });
    if (novemberPending) expenses.push({ label: 'Luz de noviembre', amount: novemberPending, note: 'Importe aproximado: 60,00 €.' });
    const ibiPaid = currentPeriodMovements.filter(item => item.type === 'gasto' && item.category === 'Fijos'
      && item.subcategory === 'IBI y basura' && item.amount > 0).reduce((sum, item) => sum + item.amount, 0);
    const communicationsPaid = currentPeriodMovements.filter(item => item.type === 'gasto' && item.category === 'Fijos'
      && item.subcategory === 'Comunicaciones' && item.amount > 0).reduce((sum, item) => sum + item.amount, 0);
    const foodPaid = currentPeriodMovements.filter(item => item.type === 'gasto' && item.category === 'Comida')
      .reduce((sum, item) => sum + item.amount, 0);
    const ibiPending = Math.max(0, 67.61 - ibiPaid);
    const communicationsPending = Math.max(0, 28 - communicationsPaid);
    const foodPending = Math.max(0, 321 - foodPaid);
    if (ibiPending) expenses.push({ label: 'IBI y basura', amount: ibiPending, note: 'Cuota pendiente: 67,61 €.' });
    if (communicationsPending) expenses.push({ label: 'Comunicaciones (Vodafone / Lowi)', amount: communicationsPending, note: 'Factura pendiente: 28,00 €.' });
    if (foodPending) expenses.push({ label: 'Comida', amount: foodPending, note: `Incluye unos 175,00 € más de comida; ya gastados: ${euro(foodPaid)}.` });
    const incomes = pendingIncomeTemplates(fixedMonthlyTemplates(forecastYear, forecastMonth), currentPeriodMovements, previousMovements);
    const expenseTotal = expenses.reduce((sum, item) => sum + item.amount, 0);
    const incomeTotal = incomes.reduce((sum, item) => sum + item.amount, 0);
    return { expenses, incomes, expenseTotal, incomeTotal, projectedBalance: balance - expenseTotal + incomeTotal };
  }

  const fixedTemplates = fixedMonthlyTemplates(forecastYear, forecastMonth).filter(template => template.type === 'gasto');
  const expenses = [];

  fixedTemplates.forEach(template => {
    const byYear = new Map();
    previousMovements.filter(item => item.type === 'gasto' && matchesFixedTemplateMovement(item, template))
      .forEach(item => byYear.set(item.periodYear, (byYear.get(item.periodYear) || 0) + item.amount));
    const historicalAverage = recentYearAverage(byYear);
    const expected = historicalAverage !== null ? historicalAverage
      : template.amount !== null && template.amount !== undefined ? Number(template.amount) || 0
        : template.id === 'luz-total-energy' ? monthNumber === 12 ? 120 : monthNumber === 2 ? 90 : 60 : 0;
    const alreadyPaid = currentPeriodMovements.filter(item => matchesFixedTemplateMovement(item, template))
      .reduce((sum, item) => sum + item.amount, 0);
    const pending = expected >= 0 ? Math.max(0, expected - alreadyPaid) : expected - alreadyPaid;
    if (pending) expenses.push({
      label: pending < 0 ? `Ajuste: ${template.description}` : template.description,
      amount: pending,
      note: historicalAverage !== null ? 'Estimación a partir de los últimos años para este mes.' : 'Importe orientativo del fijo mensual.',
    });
  });

  const variableByCategory = new Map();
  previousMovements.filter(item => item.type === 'gasto' && item.category !== 'Fijos')
    .forEach(item => {
      const byYear = variableByCategory.get(item.category || 'Otros') || new Map();
      byYear.set(item.periodYear, (byYear.get(item.periodYear) || 0) + item.amount);
      variableByCategory.set(item.category || 'Otros', byYear);
    });
  variableByCategory.forEach((byYear, category) => {
    const expected = recentYearAverage(byYear) || 0;
    const alreadyPaid = currentPeriodMovements.filter(item => item.type === 'gasto' && item.category === category)
      .reduce((sum, item) => sum + item.amount, 0);
    const pending = Math.max(0, expected - alreadyPaid);
    if (pending) expenses.push({ label: category, amount: pending, note: `Gasto variable estimado para ${MONTHS[forecastMonth].toLowerCase()}, menos lo ya registrado.` });
  });
  const incomes = pendingIncomeTemplates(fixedMonthlyTemplates(forecastYear, forecastMonth), currentPeriodMovements, previousMovements);
  const expenseTotal = expenses.reduce((sum, item) => sum + item.amount, 0);
  const incomeTotal = incomes.reduce((sum, item) => sum + item.amount, 0);
  return { expenses, incomes, expenseTotal, incomeTotal, projectedBalance: balance - expenseTotal + incomeTotal };
}
function pendingIncomeTemplates(templates, currentPeriodMovements, previousMovements) {
  return templates.filter(template => template.type === 'ingreso').flatMap(template => {
    const byYear = new Map();
    previousMovements.filter(item => item.type === 'ingreso' && matchesFixedTemplateMovement(item, template))
      .forEach(item => byYear.set(item.periodYear, (byYear.get(item.periodYear) || 0) + item.amount));
    const historicalAverage = recentYearAverage(byYear);
    const expected = historicalAverage !== null ? historicalAverage : Number(template.amount) || 0;
    const alreadyPaid = currentPeriodMovements.filter(item => matchesFixedTemplateMovement(item, template))
      .reduce((sum, item) => sum + item.amount, 0);
    const pending = Math.max(0, expected - alreadyPaid);
    return pending ? [{ label: template.person || template.description, amount: pending, note: 'Aportación fija pendiente de registrar.' }] : [];
  });
}
function showForecastDialog() {
  const currentBalance = totals().balance;
  const forecast = forecastExpenses(currentBalance);
  const currentDate = new Date();
  document.getElementById('forecastDialogTitle').textContent = `Previsión de ${MONTHS[currentDate.getMonth()].toLowerCase()} ${currentDate.getFullYear()}`;
  document.getElementById('forecastDialogBalance').textContent = euro(currentBalance);
  document.getElementById('forecastDialogExpensesTotal').textContent = euro(forecast.expenseTotal);
  document.getElementById('forecastDialogIncomeTotal').textContent = euro(forecast.incomeTotal);
  document.getElementById('forecastDialogProjected').textContent = euro(forecast.projectedBalance);
  const renderLines = (items, emptyText) => items.length ? items.map(item => `
    <div class="forecast-line"><div><strong>${escapeHtml(item.label)}</strong><small>${escapeHtml(item.note || '')}</small></div><b>${euro(item.amount)}</b></div>`).join('')
    : `<p class="forecast-empty">${emptyText}</p>`;
  document.getElementById('forecastExpenseList').innerHTML = renderLines(forecast.expenses, 'No quedan gastos aproximados por pasar.');
  document.getElementById('forecastIncomeList').innerHTML = renderLines(forecast.incomes, 'No quedan aportaciones fijas pendientes. Los ingresos ocasionales no se pueden prever.');
  document.getElementById('forecastDialog').showModal();
}
function renderHouseholdBalances() {
  const titoAdds = db.movements
    .filter(item => item.type === 'ingreso' && item.person === 'Tito')
    .reduce((sum, item) => sum + item.amount, 0);
  const sheilaAdds = db.movements
    .filter(item => item.type === 'ingreso' && item.person === 'Sheila')
    .reduce((sum, item) => sum + item.amount, 0);
  const titoTotal = db.initialTito + titoAdds;
  const sheilaTotal = db.initialSheila + sheilaAdds;
  const difference = titoTotal - sheilaTotal;
  const huchaMovement = db.movements
    .filter(item => item.type === 'gasto' && item.category === 'Fijos' && item.subcategory === 'Ahorros Hucha')
    .reduce((sum, item) => sum + item.amount, 0);
  const conchiPaid = db.movements
    .filter(item => item.type === 'gasto' && item.category === 'Fijos' && item.subcategory === 'Préstamo Conchi')
    .reduce((sum, item) => sum + item.amount, 0);
  const conchiProgress = latestLoanInstallment('Préstamo Conchi', 134);
  const conchiInstallment = conchiProgress?.number || 0;
  const conchiRemaining = Math.max(0, 134 - conchiInstallment);
  const mortgageProgress = latestLoanInstallment('Hipoteca', 360);
  const mortgageInstallment = mortgageProgress?.number || 0;
  const mortgageRemaining = Math.max(0, 360 - mortgageInstallment);
  const mortgageTemplate = fixedMonthlyTemplates().find(item => item.id === 'hipoteca');
  const mortgageMonthlyAmount = mortgageProgress?.amount || Number(mortgageTemplate?.amount || 0);
  document.getElementById('lifetimeTito').textContent = euro(titoTotal);
  document.getElementById('lifetimeTitoDetail').textContent = `Inicio: ${euro(db.initialTito)} · desde 2021: ${euro(titoAdds)}`;
  document.getElementById('lifetimeSheila').textContent = euro(sheilaTotal);
  document.getElementById('lifetimeSheilaDetail').textContent = `Inicio: ${euro(db.initialSheila)} · desde 2021: ${euro(sheilaAdds)}`;
  document.getElementById('differenceTito').textContent = `${difference >= 0 ? '+' : '−'}${euro(Math.abs(difference))}`;
  document.getElementById('differenceSheila').textContent = `${difference <= 0 ? '+' : '−'}${euro(Math.abs(difference))}`;
  document.getElementById('differenceCaption').textContent = difference === 0
    ? 'Los dos habéis aportado lo mismo'
    : difference > 0 ? 'Tito ha aportado más' : 'Sheila ha aportado más';
  document.getElementById('huchaBalance').textContent = euro(db.initialSavings + huchaMovement);
  document.getElementById('huchaDetail').textContent = `Inicial: ${euro(db.initialSavings)} · movimientos: ${euro(huchaMovement)}`;
  document.getElementById('conchiBalance').textContent = euro(db.initialConchiDebt - conchiPaid);
  document.getElementById('conchiDetail').textContent = `Deuda inicial: ${euro(db.initialConchiDebt)} · pagos: ${euro(conchiPaid)}`;
  document.getElementById('conchiProgress').textContent = conchiProgress
    ? `Cuota ${conchiInstallment} de 134 · quedan ${conchiRemaining} (${remainingTerm(conchiRemaining)})`
    : `Sin cuotas registradas · quedan ${conchiRemaining} (${remainingTerm(conchiRemaining)})`;
  document.getElementById('mortgageProgress').textContent = mortgageProgress
    ? `Pago ${mortgageInstallment} de 360 · quedan ${mortgageRemaining} (${remainingTerm(mortgageRemaining)})`
    : `Sin cuotas registradas · quedan ${mortgageRemaining} (${remainingTerm(mortgageRemaining)})`;
  document.getElementById('mortgageBalance').textContent = euro(mortgageMonthlyAmount * mortgageRemaining);
  document.getElementById('mortgageDetail').textContent = `${euro(mortgageMonthlyAmount)} por cuota · total estimado de ${mortgageRemaining} cuotas`;
}

async function loadPublicData() {
  if (!sessionToken) {
    showAuthGate();
    return;
  }
  try {
    const { household, movements, member } = await requestApi('getData');
    if (household.id !== HOUSEHOLD_ID) throw new Error('No se encontró la cuenta común.');
    currentMember = { hogar_id: household.id, nombre: member.displayName, persona: member.person, rol: 'admin' };
    db = {
      openingBalance: Number(household.saldo_inicial || 0),
      initialSavings: Number(household.hucha_inicial || 0),
      initialConchiDebt: Number(household.deuda_conchi_inicial || 0),
      initialTito: Number(household.aportacion_inicial_tito || 0),
      initialSheila: Number(household.aportacion_inicial_sheila || 0),
      movements: (movements || []).map(mapFromDatabase),
    };
    dataLoaded = true;
    document.querySelector('.profile-button strong').textContent = member.displayName;
    document.querySelector('.profile-button small').textContent = 'Sesión protegida';
    document.querySelector('.profile-button .avatar').textContent = '⌂';
    authGate.hidden = true;
    appShell.hidden = false;
    setWriteAccess(true);
    document.getElementById('syncStatusText').textContent = 'Cuenta protegida';
    render();
    return true;
  } catch (error) {
    if (error.status === 401) {
      setAuthSession('');
      currentMember = null;
      dataLoaded = false;
      showAuthGate('Tu sesión ha caducado. Vuelve a iniciar sesión.');
    } else {
      document.getElementById('loginMessage').textContent = 'No se pudo conectar con la cuenta. Inténtalo de nuevo.';
      document.getElementById('loginMessage').classList.add('error');
      console.error('No se pudo cargar la cuenta protegida:', error);
    }
    return false;
  }
}
async function fetchAllMovements(householdId, includeArchived = false) {
  if (householdId !== HOUSEHOLD_ID) throw new Error('No se puede acceder a este hogar.');
  const { movements } = await requestApi('getMovements', { includeArchived });
  return movements || [];
}
function setWriteAccess(canWrite) {
  ['addMovement', 'addContribution', 'addContributionView', 'emptyAdd'].forEach(id => {
    const button = document.getElementById(id);
    if (button) button.hidden = !canWrite;
  });
}
async function refreshMovements() {
  const data = await fetchAllMovements(currentMember.hogar_id);
  db.movements = data.map(mapFromDatabase);
  render();
}

function sameMovement(a, b) {
  if (!a || !b) return a === b;
  return ['date','periodYear','periodMonth','description','type','category','subcategory','person','amount','notes','fixedTemplateId']
    .every(key => a[key] === b[key]);
}
function recordMovementHistory(previousMovements, label) {
  const before = new Map(previousMovements.map(item => [String(item.id), { ...item }]));
  const after = new Map(db.movements.map(item => [String(item.id), { ...item }]));
  const ids = new Set([...before.keys(), ...after.keys()]);
  const changes = [];
  ids.forEach(id => {
    const oldItem = before.get(id) || null;
    const newItem = after.get(id) || null;
    if (!sameMovement(oldItem, newItem)) changes.push({ id, before: oldItem, after: newItem });
  });
  if (!changes.length) return;
  undoHistory.push({ label, changes });
  if (undoHistory.length > 50) undoHistory.shift();
  redoHistory = [];
  updateHistoryButtons();
}
function updateHistoryButtons() {
  const undo = document.getElementById('undoAction');
  const redo = document.getElementById('redoAction');
  if (undo) undo.disabled = undoHistory.length === 0;
  if (redo) redo.disabled = redoHistory.length === 0;
  if (undo) undo.title = undoHistory.length ? `Deshacer: ${undoHistory.at(-1).label}` : 'Deshacer el último cambio';
  if (redo) redo.title = redoHistory.length ? `Rehacer: ${redoHistory.at(-1).label}` : 'Rehacer el último cambio deshecho';
}
async function applyHistory(direction) {
  const undoing = direction === 'undo';
  const source = undoing ? undoHistory : redoHistory;
  const destination = undoing ? redoHistory : undoHistory;
  const entry = source.at(-1);
  if (!entry || !currentMember) return;
  const undoButton = document.getElementById('undoAction');
  const redoButton = document.getElementById('redoAction');
  undoButton.disabled = true;
  redoButton.disabled = true;
  try {
    for (const change of entry.changes) {
      const target = undoing ? change.before : change.after;
      if (target) await requestApi('saveMovement', { movement: target });
      else await requestApi('archiveMovement', { id: change.id });
    }
    await refreshMovements();
    source.pop();
    destination.push(entry);
    updateHistoryButtons();
    toast(undoing ? `Deshecho: ${entry.label}` : `Rehecho: ${entry.label}`);
  } catch (error) {
    updateHistoryButtons();
    console.error(`No se pudo ${undoing ? 'deshacer' : 'rehacer'} el cambio:`, error);
    toast(`No se pudo ${undoing ? 'deshacer' : 'rehacer'} el cambio.`, true);
  }
}
function undoMovement() { return applyHistory('undo'); }
function redoMovement() { return applyHistory('redo'); }

function render() {
  if (!currentMember) return;
  const result = totals();
  document.getElementById('monthLabel').textContent = `${monthName()} ${selectedYear}`;
  document.getElementById('monthPicker').value = `${selectedYear}-${String(selectedMonth + 1).padStart(2, '0')}`;
  document.getElementById('periodText').textContent = `${monthName().toLocaleLowerCase('es-ES')} de ${selectedYear}`;
  document.getElementById('balanceValue').textContent = euro(result.balance);
  const forecast = forecastExpenses(result.balance);
  document.getElementById('incomeValue').textContent = euro(result.income);
  document.getElementById('expenseValue').textContent = euro(result.expense);
  document.getElementById('netValue').textContent = euro(result.income - result.expense);
  const forecastMonthName = MONTHS[new Date().getMonth()].toLowerCase();
  document.getElementById('balanceCaption').textContent = `Gastos aprox. que quedan en ${forecastMonthName}: ${euro(forecast.expenseTotal)}`;
  document.getElementById('projectedBalance').textContent = euro(forecast.projectedBalance);
  document.getElementById('expenseCount').textContent = `${result.expenses.length} ${result.expenses.length === 1 ? 'movimiento' : 'movimientos'}`;
  renderHouseholdBalances();
  const byPerson = { Tito: 0, Sheila: 0, Varios: 0 };
  result.list.filter(item => item.type === 'ingreso').forEach(item => {
    byPerson[item.person] = (byPerson[item.person] || 0) + item.amount;
  });
  document.getElementById('contributionTotal').textContent = euro(result.income);
  document.getElementById('peopleList').innerHTML = ['Tito', 'Sheila', 'Varios'].map(name => `
    <div class="person-row"><span class="person-avatar ${name.toLowerCase()}">${name[0]}</span>
    <span class="person-name"><strong>${name}</strong><small>Aportación del mes</small></span>
    <span class="person-amount">${euro(byPerson[name] || 0)}</span>
    <span class="person-track"><i style="width:${result.income ? Math.min(100, Math.max(0, (byPerson[name] || 0) / result.income * 100)) : 0}%"></i></span></div>`).join('');
  renderMiniBars();
  renderTransactions(result.list);
  renderCategories(result.expenses);
  renderSecondaryViews(result);
}
function renderCategoryTrend() {
  const chart = document.getElementById('categoryTrendChart');
  if (!chart) return;
  const inPeriod = db.movements.filter(item => !item.archived
    && item.periodYear === selectedYear
    && (chartPeriodMode === 'month' ? item.periodMonth === selectedMonth + 1 : true)
    && (item.type === 'ingreso' || item.type === 'gasto'));
  const expensesByCategory = new Map();
  const incomesByPerson = new Map();
  inPeriod.forEach(item => {
    if (item.type === 'gasto') {
      const category = item.category || 'Otros';
      expensesByCategory.set(category, (expensesByCategory.get(category) || 0) + item.amount);
    } else {
      const person = item.person || 'Varios';
      incomesByPerson.set(person, (incomesByPerson.get(person) || 0) + item.amount);
    }
  });
  const expenses = [...expensesByCategory.entries()].sort((a, b) => b[1] - a[1]);
  const incomes = [...incomesByPerson.entries()].sort((a, b) => b[1] - a[1]);
  const incomeTotal = incomes.reduce((sum, [, amount]) => sum + amount, 0);
  const expenseTotal = expenses.reduce((sum, [, amount]) => sum + amount, 0);
  document.getElementById('trendIncomeTotal').textContent = euro(incomeTotal);
  document.getElementById('trendExpenseTotal').textContent = euro(expenseTotal);
  document.getElementById('categoryTrendCaption').textContent = chartPeriodMode === 'year'
    ? `Importes por categoría y persona durante todo ${selectedYear}.`
    : `Importes de ${monthName().toLowerCase()} de ${selectedYear}, según el mes al que pertenecen.`;
  document.querySelectorAll('[data-chart-period]').forEach(button => {
    const active = button.dataset.chartPeriod === chartPeriodMode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  const renderBars = (rows, colorClass, emptyLabel) => {
    const max = Math.max(1, ...rows.map(([, amount]) => Math.abs(amount)));
    if (!rows.length) return `<p class="category-bars-empty">${emptyLabel}</p>`;
    return rows.map(([label, amount]) => `<div class="category-bar-row"><div class="category-bar-label"><span>${escapeHtml(label)}</span><strong>${euro(amount)}</strong></div><div class="category-bar-track"><i class="${colorClass}" style="width:${Math.max(0, Math.min(100, Math.abs(amount) / max * 100))}%"></i></div></div>`).join('');
  };
  chart.innerHTML = `<section class="category-bar-group"><h3>Gastos por categoría</h3>${renderBars(expenses, 'expense-category-bar', 'No hay gastos en este periodo.')}</section>
    <section class="category-bar-group"><h3>Ingresos por persona</h3>${renderBars(incomes, 'income-category-bar', 'No hay ingresos en este periodo.')}</section>`;
  chart.setAttribute('aria-label', `Gastos por categoría e ingresos por persona en ${chartPeriodMode === 'year' ? selectedYear : `${monthName().toLowerCase()} de ${selectedYear}`}`);
  document.getElementById('emptyCategoryTrend').classList.toggle('show', !inPeriod.length);
  chart.hidden = !inPeriod.length;
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
  const categoryExpenses = db.movements.filter(item => item.type === 'gasto'
    && item.periodYear === selectedYear
    && (categoryPeriodMode === 'year' || item.periodMonth === selectedMonth + 1));
  document.getElementById('categoryPeriodCaption').textContent = categoryPeriodMode === 'year'
    ? `Todo ${selectedYear}`
    : `${monthName().toLowerCase()} de ${selectedYear}`;
  document.querySelectorAll('[data-category-period]').forEach(button => {
    const active = button.dataset.categoryPeriod === categoryPeriodMode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  const search = (document.getElementById('movementSearch')?.value || '').trim().toLocaleLowerCase('es-ES');
  const allHost = document.getElementById('allTransactionList');
  const allEmpty = document.getElementById('emptyMovementView');
  const day = document.getElementById('movementDay').value;
  const sortDirection = document.getElementById('movementSort').value === 'oldest' ? 1 : -1;
  const allRows = [...result.list]
    .filter(item => (movementFilter === 'todos' || item.type === movementFilter)
      && (!day || Number(item.date.slice(-2)) === Number(day))
      && (movementCategories === null || (item.type === 'gasto' && movementCategories.has(item.category)))
      && (!search || `${item.description} ${item.category} ${item.subcategory} ${item.person || ''}`.toLocaleLowerCase('es-ES').includes(search)))
    .sort((a, b) => sortDirection * (a.date.localeCompare(b.date) || a.createdAt - b.createdAt));
  allHost.innerHTML = allRows.map(transactionRow).join('');
  allEmpty.classList.toggle('show', allRows.length === 0);
  allHost.style.display = allRows.length ? 'block' : 'none';
  document.getElementById('movementViewCount').textContent = `${allRows.length} ${allRows.length === 1 ? 'movimiento' : 'movimientos'}`;
  bindTransactionActions(allHost);
  document.querySelectorAll('[data-category-filter]').forEach(button => {
    const key = button.dataset.categoryFilter;
    const selected = key === 'TODOS'
      ? movementCategories === null && movementFilter === 'todos'
      : key === 'GASTOS'
        ? movementFilter === 'gasto' && movementCategories === null
        : key === 'INGRESOS'
          ? movementFilter === 'ingreso' && movementCategories === null
          : movementFilter !== 'ingreso' && (movementCategories === null || movementCategories.has(key));
    button.classList.toggle('active', selected);
    button.setAttribute('aria-pressed', String(selected));
  });

  const incomes = result.list.filter(item => item.type === 'ingreso');
  const byPerson = { Tito: 0, Sheila: 0, Varios: 0 };
  incomes.forEach(item => byPerson[item.person] = (byPerson[item.person] || 0) + item.amount);
  document.getElementById('contributionSummaryGrid').innerHTML = ['Tito', 'Sheila', 'Varios'].map(name => `
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
  categoryExpenses.forEach(item => {
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
  const categoryEmpty = document.getElementById('emptyCategoryView');
  categoryEmpty.textContent = categoryPeriodMode === 'year'
    ? `No hay gastos registrados en ${selectedYear}.`
    : `No hay gastos registrados en ${monthName().toLowerCase()} de ${selectedYear}.`;
  categoryEmpty.classList.toggle('show', !groupList.length);
  renderCategoryTrend();
  renderFixedMonthly();
}

function renderFixedMonthly() {
  const templates = fixedMonthlyTemplates();
  const host = document.getElementById('fixedMonthlyList');
  if (!host) return;
  document.getElementById('fixedMonthLabel').textContent = `${monthName()} ${selectedYear}`;
  const rows = templates.map(template => {
    const applied = db.movements.find(item => forCurrentPeriod(item) && matchesFixedTemplateMovement(item, template));
    const alreadyApplied = Boolean(applied);
    const details = template.type === 'ingreso'
      ? `Ingreso · ${template.person}`
      : `Gasto · ${template.category} · ${template.subcategory}`;
    const values = applied || template;
    return `<article class="fixed-monthly-row ${alreadyApplied ? 'is-applied' : ''}" data-fixed-id="${template.id}" data-movement-id="${applied?.id || ''}">
      <div class="fixed-monthly-details"><strong>${escapeHtml(details)}</strong><small>${alreadyApplied ? 'Ya está en movimientos de este mes' : 'Fecha del movimiento · pertenece a ' + monthName().toLowerCase()}</small></div>
      <div class="fixed-monthly-fields">
        <label>Descripción<input data-fixed-description value="${escapeHtml(values.description)}" maxlength="100" ${alreadyApplied ? 'disabled' : ''}></label>
        <label>Importe<input data-fixed-amount type="number" step="0.01" value="${values.amount ?? ''}" placeholder="Indica el importe" ${alreadyApplied ? 'disabled' : ''}></label>
        <label>Fecha<input data-fixed-date type="date" value="${applied?.date || ''}" required ${alreadyApplied ? 'disabled' : ''}></label>
      </div>
      ${alreadyApplied
        ? '<div class="fixed-monthly-actions"><span class="fixed-monthly-applied">✓ Aplicado</span><button class="fixed-monthly-edit" type="button" data-fixed-edit>Editar</button><button class="fixed-monthly-save" type="button" data-fixed-save hidden>Guardar</button></div>'
        : '<button class="fixed-monthly-apply" type="button" data-fixed-apply aria-label="Añadir movimiento">✓</button>'}
    </article>`;
  });
  host.innerHTML = rows.join('');
  const appliedCount = host.querySelectorAll('.is-applied').length;
  document.getElementById('fixedMonthlyCount').textContent = `${appliedCount} de ${templates.length} aplicados`;
  document.getElementById('fixedMonthlySummary').textContent = currentMember?.rol === 'admin'
    ? 'Completa la fecha real y confirma con ✓. Puedes retocar la descripción y el importe antes de añadirlo.'
    : 'Consulta los movimientos fijos previstos y cuáles ya se han añadido.';
  document.getElementById('emptyFixedMonthly').classList.toggle('show', templates.length === 0);
}

async function applyFixedMonthly(button) {
  if (currentMember?.rol !== 'admin') return;
  const row = button.closest('[data-fixed-id]');
  const template = fixedMonthlyTemplates().find(item => item.id === row?.dataset.fixedId);
  if (!template) return;
  const date = row.querySelector('[data-fixed-date]').value;
  const description = row.querySelector('[data-fixed-description]').value.trim();
  const rawAmount = row.querySelector('[data-fixed-amount]').value;
  const amount = Number(rawAmount);
  if (!date) { toast('Indica la fecha del movimiento.', true); return; }
  if (!description) { toast('Escribe una descripción.', true); return; }
  if (rawAmount === '' || !Number.isFinite(amount) || (template.type === 'ingreso' && amount < 0)) {
    toast('Indica un importe válido.', true); return;
  }
  const previousMovements = db.movements.map(item => ({ ...item }));
  const movement = {
    id: crypto.randomUUID(), date, periodYear: selectedYear, periodMonth: selectedMonth + 1,
    description, type: template.type, category: template.category, subcategory: template.subcategory,
    person: template.person || null, amount, notes: '', fixedTemplateId: template.id, createdAt: Date.now(),
  };
  try {
    await requestApi('createMovement', { movement });
    await refreshMovements();
    recordMovementHistory(previousMovements, `añadir ${description}`);
    render();
    toast('Movimiento fijo añadido');
  } catch (error) {
    if (error.code === '23505') {
      await refreshMovements();
      toast('Este fijo ya estaba añadido para el mes.', true);
    } else {
      console.error('No se pudo aplicar el fijo:', error);
      toast('No se pudo añadir el movimiento fijo.', true);
    }
  }
}

function editFixedMonthly(button) {
  const row = button.closest('[data-fixed-id]');
  if (!row) return;
  row.querySelectorAll('.fixed-monthly-fields input').forEach(input => { input.disabled = false; });
  button.hidden = true;
  row.querySelector('[data-fixed-save]').hidden = false;
}

async function saveFixedMonthlyEdit(button) {
  if (currentMember?.rol !== 'admin') return;
  const row = button.closest('[data-fixed-id]');
  const movement = db.movements.find(item => String(item.id) === row?.dataset.movementId);
  const template = fixedMonthlyTemplates().find(item => item.id === row?.dataset.fixedId);
  if (!row || !movement || !template) { toast('No se encontró el movimiento para editar.', true); return; }
  const date = row.querySelector('[data-fixed-date]').value;
  const description = row.querySelector('[data-fixed-description]').value.trim();
  const rawAmount = row.querySelector('[data-fixed-amount]').value;
  const amount = Number(rawAmount);
  if (!date) { toast('Indica la fecha del movimiento.', true); return; }
  if (!description) { toast('Escribe una descripción.', true); return; }
  if (rawAmount === '' || !Number.isFinite(amount) || (template.type === 'ingreso' && amount < 0)) {
    toast('Indica un importe válido.', true); return;
  }
  const previousMovements = db.movements.map(item => ({ ...item }));
  button.disabled = true;
  try {
    await requestApi('updateMovement', { id: movement.id, changes: { date, description, amount, fixedTemplateId: template.id } });
    await refreshMovements();
    recordMovementHistory(previousMovements, `editar ${description}`);
    render();
    toast('Movimiento fijo actualizado');
  } catch (error) {
    button.disabled = false;
    console.error('No se pudo editar el fijo:', error);
    toast(error.code === '23505' ? 'Ya hay otro movimiento fijo de este tipo en el mes.' : 'No se pudo actualizar el movimiento fijo.', true);
  }
}

const VIEW_META = {
  inicio: { title: 'Resumen', subtitle: 'Todo lo que entra y sale de vuestra cuenta común.' },
  movimientos: { title: 'Movimientos', subtitle: 'Consulta y busca los ingresos y gastos del mes.' },
  aportaciones: { title: 'Aportaciones', subtitle: 'Lo que Tito y Sheila ingresan en la cuenta común.' },
  fijos: { title: 'Fijos mensuales', subtitle: 'Movimientos previstos para cada mes.' },
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
  const period = document.getElementById('periodMonth');
  const periodYear = item?.periodYear ?? selectedYear;
  const periodMonth = item?.periodMonth ?? selectedMonth + 1;
  period.value = `${periodYear}-${String(periodMonth).padStart(2, '0')}`;
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
  document.getElementById('amount').min = income ? '0' : '-9999999';
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
  if (!Number.isFinite(amount) || (type === 'ingreso' && amount < 0)) return;
  const date = document.getElementById('date').value;
  const periodValue = document.getElementById('periodMonth').value;
  const [periodYear, periodMonth] = periodValue.split('-').map(Number);
  const movement = {
    hogar_id: currentMember.hogar_id,
    fecha: date,
    periodo_anio: periodYear,
    periodo_mes: periodMonth,
    descripcion: document.getElementById('description').value.trim(),
    tipo: type,
    categoria: type === 'ingreso' ? 'Aportación' : document.getElementById('category').value,
    subcategoria: type === 'ingreso' ? document.getElementById('person').value : document.getElementById('subcategory').value,
    persona: type === 'ingreso' ? document.getElementById('person').value : null,
    importe: amount,
    notas: document.getElementById('notes').value.trim(),
    creado_por: null,
  };
  if (!date || !periodYear || !periodMonth || !movement.descripcion) return;
  const previousMovements = db.movements.map(item => ({ ...item }));
  const historyLabel = `${editingId ? 'editar' : 'añadir'} ${movement.descripcion}`;
  try {
    const previous = db.movements.find(item => String(item.id) === String(editingId));
    const savedMovement = {
      id: editingId || crypto.randomUUID(), date, periodYear, periodMonth,
      description: movement.descripcion, type, category: movement.categoria,
      subcategory: movement.subcategoria, person: movement.persona,
      amount, notes: movement.notas, fixedTemplateId: previous?.fixedTemplateId || null,
      createdAt: previous?.createdAt || Date.now(),
    };
    await requestApi('saveMovement', { movement: savedMovement });
    selectedYear = periodYear;
    selectedMonth = periodMonth - 1;
    closeDialog();
    await refreshMovements();
    recordMovementHistory(previousMovements, historyLabel);
    toast(editingId ? 'Movimiento actualizado' : 'Movimiento guardado');
  } catch (error) {
    toast('No se pudo guardar el movimiento. Inténtalo de nuevo.', true);
    console.error('Error al guardar movimiento:', error);
  }
}
async function archiveMovement(id) {
  const movement = db.movements.find(item => item.id === id);
  if (!movement || currentMember?.rol !== 'admin' || !confirm(`¿Archivar «${movement.description}»?`)) return;
  const previousMovements = db.movements.map(item => ({ ...item }));
  try {
    await requestApi('archiveMovement', { id });
    await refreshMovements();
    recordMovementHistory(previousMovements, `archivar ${movement.description}`);
    toast('Movimiento archivado');
  } catch (error) {
    console.error('No se pudo archivar el movimiento:', error);
    toast('No se pudo archivar el movimiento.', true);
  }
}
function editMovement(id) {
  const movement = db.movements.find(item => item.id === id);
  if (movement) openMovement(movement.type, movement);
}

document.getElementById('undoAction').onclick = undoMovement;
document.getElementById('redoAction').onclick = redoMovement;
updateHistoryButtons();
document.getElementById('addMovement').onclick = () => openMovement('gasto');
document.getElementById('emptyAdd').onclick = () => openMovement('gasto');
document.getElementById('addContribution').onclick = () => openMovement('ingreso');
document.getElementById('addContributionView').onclick = () => openMovement('ingreso');
document.getElementById('forecastBreakdownAction').onclick = showForecastDialog;
document.getElementById('closeForecastDialog').onclick = () => document.getElementById('forecastDialog').close();
document.getElementById('forecastDialog').addEventListener('click', event => {
  if (event.target === event.currentTarget) event.currentTarget.close();
});
document.getElementById('closeDialog').onclick = closeDialog;
document.getElementById('cancelDialog').onclick = closeDialog;
document.querySelectorAll('.type-option').forEach(button => button.onclick = () => setType(button.dataset.type));
document.getElementById('category').addEventListener('change', () => updateSubcategories());
form.addEventListener('submit', saveMovement);
document.getElementById('prevMonth').onclick = () => moveMonth(-1);
document.getElementById('nextMonth').onclick = () => moveMonth(1);
document.getElementById('currentMonth').onclick = () => { selectedYear = now.getFullYear(); selectedMonth = now.getMonth(); render(); };
document.getElementById('monthPicker').addEventListener('change', event => {
  const [year, month] = event.target.value.split('-').map(Number);
  if (!year || month < 1 || month > 12) return;
  selectedYear = year;
  selectedMonth = month - 1;
  render();
});
document.getElementById('movementDay').innerHTML += Array.from({ length: 31 }, (_, index) => `<option value="${index + 1}">${index + 1}</option>`).join('');
document.getElementById('categoryFilters').innerHTML = `<button type="button" class="category-filter active" data-category-filter="TODOS" aria-pressed="true">TODOS</button><button type="button" class="category-filter" data-category-filter="GASTOS" aria-pressed="false">GASTOS</button><button type="button" class="category-filter" data-category-filter="INGRESOS" aria-pressed="false">INGRESOS</button>` + Object.keys(CATEGORIES).map(category => `<button type="button" class="category-filter active" data-category-filter="${escapeHtml(category)}" aria-pressed="true">${escapeHtml(category)}</button>`).join('');
document.querySelectorAll('[data-category-filter]').forEach(button => button.addEventListener('click', () => {
  const category = button.dataset.categoryFilter;
  if (category === 'TODOS') { movementCategories = null; movementFilter = 'todos'; }
  else if (category === 'GASTOS') { movementCategories = null; movementFilter = 'gasto'; }
  else if (category === 'INGRESOS') { movementCategories = null; movementFilter = 'ingreso'; }
  else {
    if (movementCategories === null) movementCategories = new Set([category]);
    else if (movementCategories.has(category)) movementCategories.delete(category);
    else movementCategories.add(category);
    movementFilter = 'gasto';
  }
  render();
}));
document.querySelectorAll('[data-category-period]').forEach(button => button.addEventListener('click', () => {
  categoryPeriodMode = button.dataset.categoryPeriod;
  render();
}));
document.querySelectorAll('[data-chart-period]').forEach(button => button.addEventListener('click', () => {
  chartPeriodMode = button.dataset.chartPeriod;
  render();
}));
document.getElementById('movementDay').addEventListener('change', () => render());
document.getElementById('movementSort').addEventListener('change', () => render());
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
document.getElementById('fixedMonthlyList').addEventListener('click', event => {
  const button = event.target.closest('[data-fixed-apply]');
  const editButton = event.target.closest('[data-fixed-edit]');
  const saveButton = event.target.closest('[data-fixed-save]');
  if (button) applyFixedMonthly(button);
  else if (editButton) editFixedMonthly(editButton);
  else if (saveButton) saveFixedMonthlyEdit(saveButton);
});
document.getElementById('movementSearch').addEventListener('input', () => render());
const backupDialog = document.getElementById('backupDialog');
function openBackupDialog() { backupDialog.showModal(); }
document.getElementById('backupAction').addEventListener('click', openBackupDialog);
document.getElementById('mobileBackupAction').addEventListener('click', openBackupDialog);
document.getElementById('closeBackupDialog').addEventListener('click', () => backupDialog.close());
document.getElementById('downloadBackupAction').addEventListener('click', () => {
  backupDialog.close();
  downloadBackup();
});
document.getElementById('restoreBackupAction').addEventListener('click', () => {
  backupDialog.close();
  document.getElementById('backupFileInput').click();
});
document.getElementById('backupFileInput').addEventListener('change', async event => {
  await handleBackupRestore(event.target.files?.[0]);
  event.target.value = '';
});

document.getElementById('loginForm').addEventListener('submit', async event => {
  event.preventDefault();
  const usernameInput = document.getElementById('loginUsername');
  const passwordInput = document.getElementById('loginPassword');
  const submit = document.getElementById('loginSubmit');
  const message = document.getElementById('loginMessage');
  submit.disabled = true;
  submit.textContent = 'Entrando…';
  message.textContent = '';
  message.classList.remove('error');
  try {
    const auth = await requestApi('login', { username: usernameInput.value.trim(), password: passwordInput.value }, '');
    setAuthSession(auth.sessionToken);
    const loaded = await loadPublicData();
    if (!loaded) throw new Error('No se pudo abrir la cuenta. Inténtalo de nuevo.');
    passwordInput.value = '';
  } catch (error) {
    setAuthSession('');
    message.textContent = error.status === 429
      ? 'Se han hecho demasiados intentos. Espera unos minutos e inténtalo de nuevo.'
      : error.status === 401 ? 'Usuario o contraseña incorrectos.'
        : error.message || 'No se pudo iniciar sesión. Comprueba la conexión.';
    message.classList.add('error');
    passwordInput.value = '';
  } finally {
    submit.disabled = false;
    submit.innerHTML = 'Entrar <span>→</span>';
  }
});
document.getElementById('logoutAction').addEventListener('click', async () => {
  try { await requestApi('logout'); } catch (error) { console.warn('No se pudo cerrar la sesión en el servidor.', error); }
  setAuthSession('');
  currentMember = null;
  dataLoaded = false;
  undoHistory = [];
  redoHistory = [];
  db = { openingBalance: 0, initialSavings: 0, initialConchiDebt: 0, initialTito: 0, initialSheila: 0, movements: [] };
  updateHistoryButtons();
  showAuthGate('Has cerrado la sesión.');
  document.getElementById('loginForm').reset();
});
if (sessionToken) loadPublicData();
else showAuthGate();
