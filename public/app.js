/* ====================================================================
   Calentaos Bets — SPA en JS puro
   ==================================================================== */

const $app = document.getElementById('app');

/* ----------------------------- Estado ----------------------------- */
const state = {
  token: localStorage.getItem('gb_token') || null,
  user: null,
  view: 'bets', // bets | mybets | new | manage | players
  bets: [],
  myWagers: [],
  allWagers: [],
  players: [],
  ranking: [],
  wins: [],
  night: [],
  nightCategories: [],
  slip: [], // [{betId, optionId, betTitle, optionLabel, odds}]
  stake: '',
  authMode: 'login', // login | register
  loading: true,
};

let socket = null;

/* ------------------------------ API ------------------------------ */
async function api(path, { method = 'GET', body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (state.token) headers.Authorization = 'Bearer ' + state.token;
  const res = await fetch('/api' + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Error inesperado');
  return data;
}

/* ----------------------------- Toast ----------------------------- */
function toast(msg, type = '') {
  const host = document.getElementById('toast-host');
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = msg;
  host.appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity .3s';
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 300);
  }, 3200);
}

/* --------------------------- Utilidades -------------------------- */
const fmt = (n) =>
  Number(n).toLocaleString('es-ES', { maximumFractionDigits: 2 });
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function avatarColor(name) {
  const colors = ['#5b8cff', '#38e07b', '#ff5d6c', '#ffcf4a', '#b06bff', '#00d3a7', '#ff8a4a'];
  let h = 0;
  for (const ch of name) h = ch.charCodeAt(0) + ((h << 5) - h);
  return colors[Math.abs(h) % colors.length];
}
const initials = (name) => name.slice(0, 2).toUpperCase();

function timeLeft(iso) {
  if (!iso) return null;
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) return 'cerrada';
  const m = Math.floor(diff / 60000);
  if (m < 60) return `cierra en ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `cierra en ${h} h`;
  return `cierra en ${Math.floor(h / 24)} d`;
}

function comboOdds() {
  return state.slip.reduce((a, s) => a * s.odds, 1);
}

/* ----------------------------- Sockets --------------------------- */
function connectSocket() {
  if (socket) socket.disconnect();
  socket = io();
  socket.on('connect', () => {
    if (state.token) socket.emit('auth', state.token);
  });
  socket.on('bets:changed', () => loadBets());
  socket.on('me:changed', () => {
    refreshMe();
    loadMyWagers();
  });
  socket.on('admin:changed', () => {
    if (state.user?.role === 'admin') {
      loadPlayers();
      loadAllWagers();
    }
  });
  // Ranking y apuestas ganadas: cambian para todos cuando alguien apuesta o se liquida
  socket.on('feed:changed', () => {
    loadRanking();
    loadWins();
  });
  // Registro de la noche (MVP, cubatas...) cambia para todos
  socket.on('night:changed', () => loadNight());
}

/* --------------------------- Carga datos ------------------------- */
async function refreshMe() {
  try {
    const { user } = await api('/me');
    state.user = user;
    render();
  } catch {
    logout();
  }
}
async function loadBets() {
  try {
    const { bets } = await api('/bets');
    state.bets = bets;
    render();
  } catch (e) {
    /* silencioso */
  }
}
async function loadMyWagers() {
  try {
    const { wagers } = await api('/wagers/me');
    state.myWagers = wagers;
    render();
  } catch {}
}
async function loadPlayers() {
  if (state.user?.role !== 'admin') return;
  try {
    const { users } = await api('/users');
    state.players = users;
    render();
  } catch {}
}
async function loadAllWagers() {
  if (state.user?.role !== 'admin') return;
  try {
    const { wagers } = await api('/wagers');
    state.allWagers = wagers;
    render();
  } catch {}
}
async function loadRanking() {
  try {
    const { ranking } = await api('/ranking');
    state.ranking = ranking;
    render();
  } catch {}
}
async function loadWins() {
  try {
    const { wins } = await api('/wins');
    state.wins = wins;
    render();
  } catch {}
}
async function loadNight() {
  try {
    const { players, categories } = await api('/night');
    state.night = players;
    state.nightCategories = categories;
    render();
  } catch {}
}

async function bootstrap() {
  if (!state.token) {
    state.loading = false;
    render();
    return;
  }
  try {
    const { user } = await api('/me');
    state.user = user;
    state.loading = false;
    connectSocket();
    await Promise.all([loadBets(), loadMyWagers(), loadRanking(), loadWins(), loadNight()]);
    if (user.role === 'admin') await Promise.all([loadPlayers(), loadAllWagers()]);
    render();
  } catch {
    logout();
  }
}

/* ------------------------------ Auth ----------------------------- */
async function handleAuth(e) {
  e.preventDefault();
  const f = e.target;
  const username = f.username.value.trim();
  const password = f.password.value;
  const wantsHouse = f.wantsHouse?.checked;
  const houseCode = f.houseCode?.value.trim();
  try {
    const path = state.authMode === 'login' ? '/login' : '/register';
    const body = { username, password };
    if (state.authMode === 'register' && wantsHouse) body.houseCode = houseCode;
    const { token, user } = await api(path, { method: 'POST', body });
    state.token = token;
    state.user = user;
    localStorage.setItem('gb_token', token);
    state.view = user.role === 'admin' ? 'manage' : 'bets';
    connectSocket();
    await Promise.all([loadBets(), loadMyWagers(), loadRanking(), loadWins(), loadNight()]);
    if (user.role === 'admin') await Promise.all([loadPlayers(), loadAllWagers()]);
    toast(`¡Bienvenido, ${user.username}!`, user.role === 'admin' ? 'gold' : '');
    render();
  } catch (err) {
    toast(err.message, 'error');
  }
}

function logout() {
  localStorage.removeItem('gb_token');
  state.token = null;
  state.user = null;
  state.loading = false;
  state.slip = [];
  if (socket) socket.disconnect();
  render();
}

/* ----------------------- Boleto / apuestas ----------------------- */
function toggleSelection(bet, option) {
  const leg = {
    betId: bet.id,
    optionId: option.id,
    betTitle: bet.title,
    optionLabel: option.label,
    odds: option.odds,
  };
  const sameOption = state.slip.find((s) => s.betId === bet.id && s.optionId === option.id);
  if (sameOption) {
    // ya estaba: quitar esa opción concreta
    state.slip = state.slip.filter((s) => !(s.betId === bet.id && s.optionId === option.id));
  } else if (bet.multi) {
    // apuesta multi-opción: se pueden elegir varias del mismo evento (se multiplican)
    state.slip.push(leg);
  } else {
    // apuesta normal: una sola opción por evento (se reemplaza)
    const existing = state.slip.find((s) => s.betId === bet.id);
    if (existing) Object.assign(existing, leg);
    else state.slip.push(leg);
  }
  render();
}

async function placeWager() {
  const stake = Number(state.stake);
  if (!stake || stake <= 0) return toast('Introduce un importe válido', 'error');
  try {
    const { chips } = await api('/wagers', {
      method: 'POST',
      body: {
        stake,
        selections: state.slip.map((s) => ({ betId: s.betId, optionId: s.optionId })),
      },
    });
    state.user.chips = chips;
    const win = stake * comboOdds();
    const combo = state.slip.length > 1;
    state.slip = [];
    state.stake = '';
    toast(
      combo
        ? `¡Combinada de ${state.slip.length} puesta! Ganancia posible: ${fmt(win)} 🪙`
        : `¡Apuesta realizada! Ganancia posible: ${fmt(win)} 🪙`,
      'gold'
    );
    loadMyWagers();
    render();
  } catch (err) {
    toast(err.message, 'error');
  }
}

/* --------------------- Acciones de admin ------------------------- */
async function adminAction(path, method = 'PATCH', body) {
  try {
    await api(path, { method, body });
  } catch (err) {
    toast(err.message, 'error');
  }
}

let modalEl = null;
function openModal(html) {
  closeModal();
  modalEl = document.createElement('div');
  modalEl.className = 'modal-backdrop';
  modalEl.innerHTML = `<div class="card modal card-pad">${html}</div>`;
  modalEl.addEventListener('click', (e) => {
    if (e.target === modalEl) closeModal();
  });
  document.body.appendChild(modalEl);
  return modalEl;
}
function closeModal() {
  if (modalEl) modalEl.remove();
  modalEl = null;
}

function settleModal(bet) {
  // Apuesta normal: un clic = opción ganadora
  if (!bet.multi) {
    const opts = bet.options
      .map(
        (o) =>
          `<button class="btn mt" data-settle="${o.id}" style="justify-content:space-between;width:100%">
            <span>${esc(o.label)}</span><span class="oo num" style="color:var(--accent)">×${o.odds}</span>
          </button>`
      )
      .join('');
    const m = openModal(`
      <h3>Liquidar apuesta</h3>
      <p>${esc(bet.title)}<br/>Elige la opción <b>ganadora</b>. Se pagarán las fichas automáticamente.</p>
      ${opts}
      <button class="btn btn-ghost mt" data-cancel style="width:100%">Cancelar</button>
    `);
    m.querySelectorAll('[data-settle]').forEach((b) =>
      b.addEventListener('click', async () => {
        await adminAction(`/bets/${bet.id}/settle`, 'PATCH', { winningOptionIds: [b.dataset.settle] });
        closeModal();
        toast('Apuesta liquidada y fichas pagadas', 'gold');
      })
    );
    m.querySelector('[data-cancel]').addEventListener('click', closeModal);
    return;
  }

  // Apuesta multi-opción: marca TODAS las ganadoras y confirma
  const chosen = new Set();
  const m = openModal(`
    <h3>Liquidar apuesta multi-opción</h3>
    <p>${esc(bet.title)}<br/>Marca <b>todas las opciones ganadoras</b>. Una apuesta del jugador gana solo si acertó todas las suyas.</p>
    <div id="settle-opts"></div>
    <div class="row mt">
      <button class="btn btn-ghost" data-cancel>Cancelar</button>
      <button class="btn btn-primary" data-confirm style="width:auto">Liquidar</button>
    </div>
  `);
  const drawOpts = () => {
    m.querySelector('#settle-opts').innerHTML = bet.options
      .map(
        (o) =>
          `<button class="option ${chosen.has(o.id) ? 'selected' : ''}" data-toggle="${o.id}" style="width:100%;margin-bottom:8px">
            <span class="ol">${esc(o.label)} ${chosen.has(o.id) ? '✓' : ''}</span><span class="oo">×${o.odds}</span>
          </button>`
      )
      .join('');
    m.querySelectorAll('[data-toggle]').forEach((b) =>
      b.addEventListener('click', () => {
        const id = b.dataset.toggle;
        chosen.has(id) ? chosen.delete(id) : chosen.add(id);
        drawOpts();
      })
    );
  };
  drawOpts();
  m.querySelector('[data-cancel]').addEventListener('click', closeModal);
  m.querySelector('[data-confirm]').addEventListener('click', async () => {
    if (chosen.size === 0) return toast('Marca al menos una opción ganadora', 'error');
    await adminAction(`/bets/${bet.id}/settle`, 'PATCH', { winningOptionIds: [...chosen] });
    closeModal();
    toast('Apuesta liquidada y fichas pagadas', 'gold');
  });
}

function chipsModal(player) {
  const m = openModal(`
    <h3>Ajustar fichas</h3>
    <p>${esc(player.username)} · saldo actual <b style="color:var(--accent)">${fmt(player.chips)} 🪙</b></p>
    <div class="quick-stakes">
      <button data-add="100">+100</button>
      <button data-add="500">+500</button>
      <button data-add="1000">+1000</button>
      <button data-add="-100">−100</button>
    </div>
    <div class="field"><label>Cantidad (negativo para quitar)</label>
      <input class="input" id="chips-amt" type="number" value="100" /></div>
    <div class="row">
      <button class="btn btn-ghost" data-cancel>Cancelar</button>
      <button class="btn btn-primary" data-apply style="width:auto">Aplicar</button>
    </div>
  `);
  const inp = m.querySelector('#chips-amt');
  m.querySelectorAll('[data-add]').forEach((b) =>
    b.addEventListener('click', () => (inp.value = b.dataset.add))
  );
  m.querySelector('[data-cancel]').addEventListener('click', closeModal);
  m.querySelector('[data-apply]').addEventListener('click', async () => {
    await adminAction(`/users/${player.id}/chips`, 'POST', { amount: Number(inp.value) });
    closeModal();
    toast('Fichas actualizadas');
  });
}

/* --------------------- Copia de seguridad ------------------------ */
// Exporta todos los datos a un archivo .json que se descarga en el navegador.
async function exportBackup() {
  try {
    const data = await api('/export');
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    const a = document.createElement('a');
    a.href = url;
    a.download = `calentaosbets-backup-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast('Copia exportada · guárdala en lugar seguro', 'gold');
  } catch (err) {
    toast(err.message, 'error');
  }
}

// Lee un archivo de copia y lo restaura (reemplaza todos los datos).
async function importBackup(file, houseCode) {
  if (!file) return toast('Elige un archivo de copia', 'error');
  if (!houseCode) return toast('Introduce el código de la casa', 'error');
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch {
    return toast('El archivo no es un JSON válido', 'error');
  }
  try {
    await api('/import', { method: 'POST', body: { houseCode, data } });
    toast('¡Copia restaurada! Recargando…', 'gold');
    setTimeout(() => location.reload(), 900);
  } catch (err) {
    toast(err.message, 'error');
  }
}

// Modal de restauración para el panel de admin (ya logueado).
function importModal() {
  const m = openModal(`
    <h3>Restaurar copia de seguridad</h3>
    <p class="tiny muted">Se reemplazarán <b>todos</b> los datos actuales por los del archivo. Úsalo para recuperar el contenido tras actualizar la app.</p>
    <div class="field mt"><label>Archivo de copia (.json)</label>
      <input class="input" id="imp-file" type="file" accept="application/json,.json" /></div>
    <div class="field"><label>Código de la casa</label>
      <input class="input" id="imp-code" placeholder="Código secreto de admin" /></div>
    <div class="row">
      <button class="btn btn-ghost" data-cancel>Cancelar</button>
      <button class="btn btn-primary" data-confirm style="width:auto">Restaurar</button>
    </div>
  `);
  m.querySelector('[data-cancel]').addEventListener('click', closeModal);
  m.querySelector('[data-confirm]').addEventListener('click', () => {
    const file = m.querySelector('#imp-file').files[0];
    const code = m.querySelector('#imp-code').value.trim();
    closeModal();
    importBackup(file, code);
  });
}

/* ============================ RENDER ============================= */
function render() {
  if (state.loading) {
    $app.innerHTML = `<div class="empty"><div class="big">🎲</div>Cargando…</div>`;
    return;
  }
  if (!state.user) return renderAuth();
  renderApp();
}

/* ----------------------------- Auth view ------------------------- */
function renderAuth() {
  const isLogin = state.authMode === 'login';
  $app.innerHTML = `
    <div class="auth-wrap">
      <div class="auth-card">
        <div class="auth-hero">
          <div class="dice">🎲</div>
          <h1>Calentaos Bets</h1>
          <p>Apuestas entre amigos · ${isLogin ? 'Inicia sesión' : 'Crea tu cuenta'}</p>
        </div>
        <div class="card card-pad">
          <form id="auth-form">
            <div class="field">
              <label>Nombre de usuario</label>
              <input class="input" name="username" autocomplete="username" required />
            </div>
            <div class="field">
              <label>Contraseña</label>
              <input class="input" name="password" type="password" autocomplete="${isLogin ? 'current-password' : 'new-password'}" required />
            </div>
            ${
              isLogin
                ? ''
                : `<label class="house-toggle">
                    <input type="checkbox" name="wantsHouse" id="wantsHouse" />
                    Soy la <b style="color:var(--gold)">&nbsp;casa&nbsp;</b> (administrador)
                  </label>
                  <div class="field hidden" id="house-field">
                    <label>Código de la casa</label>
                    <input class="input" name="houseCode" placeholder="Código secreto de admin" />
                  </div>`
            }
            <button class="btn btn-primary" type="submit">${isLogin ? 'Entrar' : 'Crear cuenta'}</button>
          </form>
        </div>
        <div class="auth-switch">
          ${isLogin ? '¿No tienes cuenta?' : '¿Ya tienes cuenta?'}
          <button id="switch-auth">${isLogin ? 'Regístrate' : 'Inicia sesión'}</button>
        </div>
        <p class="center tiny muted mt">El primer usuario en registrarse se convierte en la casa automáticamente.</p>
        <details class="card card-pad" style="margin-top:14px">
          <summary style="cursor:pointer;font-weight:600">💾 Restaurar copia de seguridad</summary>
          <p class="tiny muted mt">¿Acabas de actualizar la app y está vacía? Sube tu archivo de copia y recupera todo el contenido. Necesitas el código de la casa.</p>
          <div class="field mt"><label>Archivo de copia (.json)</label>
            <input class="input" id="restore-file" type="file" accept="application/json,.json" /></div>
          <div class="field"><label>Código de la casa</label>
            <input class="input" id="restore-code" placeholder="Código secreto de admin" /></div>
          <button class="btn btn-primary" id="restore-btn">Restaurar todo</button>
        </details>
      </div>
    </div>`;

  document.getElementById('auth-form').addEventListener('submit', handleAuth);
  document.getElementById('switch-auth').addEventListener('click', () => {
    state.authMode = isLogin ? 'register' : 'login';
    render();
  });
  const wh = document.getElementById('wantsHouse');
  if (wh)
    wh.addEventListener('change', () => {
      document.getElementById('house-field').classList.toggle('hidden', !wh.checked);
    });
  document.getElementById('restore-btn').addEventListener('click', () => {
    const file = document.getElementById('restore-file').files[0];
    const code = document.getElementById('restore-code').value.trim();
    importBackup(file, code);
  });
}

/* ------------------------------ App view ------------------------- */
function renderApp() {
  const u = state.user;
  const isAdmin = u.role === 'admin';

  const tabs = isAdmin
    ? [
        ['manage', 'Gestionar', state.bets.length],
        ['new', 'Crear apuesta', null],
        ['players', 'Jugadores', state.players.length],
        ['ranking', 'Ranking', state.ranking.length],
        ['wins', 'Ganadas', state.wins.length],
        ['night', '🌙 La noche', null],
        ['bets', 'Apuestas', null],
        ['mybets', 'Mis apuestas', state.myWagers.length],
      ]
    : [
        ['bets', 'Apuestas', state.bets.filter((b) => b.status === 'open').length],
        ['mybets', 'Mis apuestas', state.myWagers.length],
        ['ranking', 'Ranking', state.ranking.length],
        ['wins', 'Ganadas', state.wins.length],
        ['night', '🌙 La noche', null],
      ];

  $app.innerHTML = `
    <div class="topbar">
      <div class="topbar-inner">
        <div class="brand"><span class="dice">🎲</span> Calentaos<small> Bets</small></div>
        <div class="spacer"></div>
        <div class="balance-pill"><span class="lbl">saldo</span> ${fmt(u.chips)} 🪙</div>
        <div class="user-chip">
          <div class="avatar" style="background:${avatarColor(u.username)}">${initials(u.username)}</div>
          <div>
            <div style="color:var(--text);font-weight:600">${esc(u.username)}</div>
            <span class="role-tag ${isAdmin ? 'role-admin' : 'role-player'}">${isAdmin ? 'casa' : 'jugador'}</span>
          </div>
        </div>
        <button class="btn btn-sm btn-ghost" id="logout">Salir</button>
      </div>
    </div>
    <div class="shell">
      <div class="tabs">
        ${tabs
          .map(
            ([id, label, count]) =>
              `<button class="tab ${state.view === id ? 'active' : ''}" data-tab="${id}">
                ${label}${count != null ? `<span class="count">${count}</span>` : ''}
              </button>`
          )
          .join('')}
      </div>
      <div id="view"></div>
    </div>`;

  document.getElementById('logout').addEventListener('click', logout);
  $app.querySelectorAll('[data-tab]').forEach((b) =>
    b.addEventListener('click', () => {
      state.view = b.dataset.tab;
      render();
    })
  );

  const view = document.getElementById('view');
  if (state.view === 'bets') renderBetsView(view);
  else if (state.view === 'mybets') renderMyBets(view);
  else if (state.view === 'new') renderNewBet(view);
  else if (state.view === 'manage') renderManage(view);
  else if (state.view === 'players') renderPlayers(view);
  else if (state.view === 'ranking') renderRanking(view);
  else if (state.view === 'wins') renderWins(view);
  else if (state.view === 'night') renderNight(view);
}

/* --------------------- Vista: apostar (jugador) ------------------ */
function renderBetsView(root) {
  const open = state.bets.filter((b) => b.status === 'open');
  root.innerHTML = `
    <div class="layout">
      <div class="bets-col">
        <div class="section-title">Apuestas abiertas</div>
        <div id="bets-list">${
          open.length
            ? open.map(betCardHTML).join('')
            : `<div class="empty"><div class="big">🍿</div>No hay apuestas abiertas ahora mismo.<br/>Espera a que la casa cree alguna.</div>`
        }</div>
      </div>
      <div class="slip-col">
        <div class="card card-pad slip" id="slip">${slipHTML()}</div>
      </div>
    </div>`;
  attachBetCardEvents(root);
  attachSlipEvents(root);
}

function betCardHTML(bet) {
  const open = bet.status === 'open';
  const closeTxt = bet.closesAt ? timeLeft(bet.closesAt) : null;
  const totalStaked = Object.values(bet.stats.totals || {}).reduce((a, b) => a + b, 0);
  const winners = bet.winningOptionIds || [];
  return `
    <div class="card bet-card" data-bet="${bet.id}">
      <div class="bet-head">
        <div>
          <h3 class="bet-title">${esc(bet.title)}</h3>
          ${bet.description ? `<p class="bet-desc">${esc(bet.description)}</p>` : ''}
        </div>
        <span class="status-badge st-${bet.status}">${
    bet.status === 'open' ? 'abierta' : bet.status === 'closed' ? 'cerrada' : bet.status === 'settled' ? 'liquidada' : 'anulada'
  }</span>
      </div>
      <div class="bet-meta">
        <span><b>${bet.options.length}</b> opciones</span>
        ${bet.multi ? `<span class="combo-tag" style="margin:0">🎯 elige varias</span>` : ''}
        ${closeTxt ? `<span>⏱ ${closeTxt}</span>` : ''}
        <span>🪙 <b>${fmt(totalStaked)}</b> apostado</span>
        <span><b>${bet.stats.count}</b> apuestas</span>
      </div>
      <div class="options">
        ${bet.options
          .map((o) => {
            const pct = totalStaked > 0 ? ((bet.stats.totals[o.id] || 0) / totalStaked) * 100 : 0;
            const selected = state.slip.some((s) => s.betId === bet.id && s.optionId === o.id);
            const isWinner = bet.status === 'settled' && winners.includes(o.id);
            return `
              <button class="option ${selected ? 'selected' : ''} ${isWinner ? 'winner' : ''}"
                ${open ? '' : 'disabled'} data-opt="${o.id}">
                <span class="ol">${esc(o.label)} ${isWinner ? '✓' : ''}</span>
                <span class="oo">×${o.odds}</span>
                <span class="barfill" style="width:${pct}%"></span>
              </button>`;
          })
          .join('')}
      </div>
    </div>`;
}

function attachBetCardEvents(root) {
  root.querySelectorAll('[data-bet]').forEach((card) => {
    const bet = state.bets.find((b) => b.id === card.dataset.bet);
    card.querySelectorAll('[data-opt]').forEach((btn) =>
      btn.addEventListener('click', () => {
        const opt = bet.options.find((o) => o.id === btn.dataset.opt);
        toggleSelection(bet, opt);
      })
    );
  });
}

function slipHTML() {
  if (state.slip.length === 0) {
    return `<div class="section-title" style="margin-top:0">Boleto</div>
      <div class="slip-empty">🎯<br/>Toca las cuotas para añadirlas.<br/>Combina varias para una <b style="color:var(--gold)">apuesta combinada</b>.</div>`;
  }
  const combo = state.slip.length > 1;
  const total = comboOdds();
  const stake = Number(state.stake) || 0;
  const potential = stake * total;
  return `
    <div class="section-title" style="margin-top:0">Boleto ${combo ? `<span class="combo-tag">Combinada ×${state.slip.length}</span>` : ''}</div>
    ${state.slip
      .map(
        (s) => `
      <div class="slip-leg" data-leg="${s.betId}:${s.optionId}">
        <div class="meta">
          <div class="t">${esc(s.betTitle)}</div>
          <div class="o">${esc(s.optionLabel)} <span class="od">×${s.odds}</span></div>
        </div>
        <button class="rm" data-rm="${s.betId}:${s.optionId}">×</button>
      </div>`
      )
      .join('')}
    <div class="stake-input">
      <input id="stake" type="number" min="1" placeholder="Importe en fichas" value="${state.stake}" />
    </div>
    <div class="quick-stakes">
      <button data-stake="10">10</button>
      <button data-stake="50">50</button>
      <button data-stake="100">100</button>
      <button data-stake="max">MAX</button>
    </div>
    <div class="slip-summary">
      <div class="srow"><span class="k">Cuota total</span><span class="v num" style="color:var(--gold)">×${fmt(total)}</span></div>
      <div class="srow"><span class="k">Apuesta</span><span class="v num">${fmt(stake)} 🪙</span></div>
      <div class="srow big"><span class="k">Ganancia posible</span><span class="v">${fmt(potential)} 🪙</span></div>
    </div>
    <button class="btn btn-primary mt" id="place" ${stake <= 0 ? 'disabled' : ''}>
      ${combo ? 'Apostar combinada' : 'Apostar'}
    </button>
    <button class="btn btn-ghost btn-sm mt" id="clear-slip" style="width:100%">Vaciar boleto</button>`;
}

function attachSlipEvents(root) {
  const slip = root.querySelector('#slip');
  if (!slip) return;
  slip.querySelectorAll('[data-rm]').forEach((b) =>
    b.addEventListener('click', () => {
      const [betId, optionId] = b.dataset.rm.split(':');
      state.slip = state.slip.filter((s) => !(s.betId === betId && s.optionId === optionId));
      render();
    })
  );
  const stakeInput = slip.querySelector('#stake');
  if (stakeInput) {
    stakeInput.addEventListener('input', (e) => {
      state.stake = e.target.value;
      // actualizar sólo el resumen sin perder foco
      const total = comboOdds();
      const stake = Number(state.stake) || 0;
      const sum = slip.querySelector('.slip-summary');
      if (sum)
        sum.innerHTML = `
        <div class="srow"><span class="k">Cuota total</span><span class="v num" style="color:var(--gold)">×${fmt(total)}</span></div>
        <div class="srow"><span class="k">Apuesta</span><span class="v num">${fmt(stake)} 🪙</span></div>
        <div class="srow big"><span class="k">Ganancia posible</span><span class="v">${fmt(stake * total)} 🪙</span></div>`;
      const placeBtn = slip.querySelector('#place');
      if (placeBtn) placeBtn.disabled = stake <= 0;
    });
  }
  slip.querySelectorAll('[data-stake]').forEach((b) =>
    b.addEventListener('click', () => {
      state.stake = b.dataset.stake === 'max' ? String(Math.floor(state.user.chips)) : b.dataset.stake;
      render();
    })
  );
  const place = slip.querySelector('#place');
  if (place) place.addEventListener('click', placeWager);
  const clear = slip.querySelector('#clear-slip');
  if (clear)
    clear.addEventListener('click', () => {
      state.slip = [];
      state.stake = '';
      render();
    });
}

/* ----------------------- Vista: mis apuestas --------------------- */
function renderMyBets(root) {
  const w = state.myWagers;
  const pending = w.filter((x) => x.status === 'pending').length;
  const won = w.filter((x) => x.status === 'won');
  const profit = w.reduce(
    (a, x) => a + (x.status === 'won' ? x.payout - x.stake : x.status === 'lost' ? -x.stake : 0),
    0
  );
  root.innerHTML = `
    <div class="section-title">Resumen</div>
    <div class="card card-pad" style="display:flex;gap:28px;flex-wrap:wrap;margin-bottom:20px">
      <div><div class="muted tiny">Apuestas</div><div class="num" style="font-size:24px">${w.length}</div></div>
      <div><div class="muted tiny">Pendientes</div><div class="num" style="font-size:24px;color:var(--gold)">${pending}</div></div>
      <div><div class="muted tiny">Ganadas</div><div class="num" style="font-size:24px;color:var(--accent)">${won.length}</div></div>
      <div><div class="muted tiny">Beneficio neto</div><div class="num ${profit >= 0 ? 'pos' : 'neg'}" style="font-size:24px">${profit >= 0 ? '+' : ''}${fmt(profit)} 🪙</div></div>
    </div>
    <div class="section-title">Historial</div>
    ${
      w.length
        ? w.map(wagerCardHTML).join('')
        : `<div class="empty"><div class="big">🎟️</div>Aún no has hecho ninguna apuesta.</div>`
    }`;
}

function wagerCardHTML(w) {
  const combo = w.selections.length > 1;
  const stTxt = { pending: 'Pendiente', won: 'Ganada', lost: 'Perdida', void: 'Anulada' }[w.status];
  const stColor = { pending: 'st-closed', won: 'st-settled', lost: 'st-cancelled', void: 'st-closed' }[w.status];
  return `
    <div class="wager">
      <div class="wager-head">
        <div>${combo ? `<span class="combo-tag">Combinada ×${w.selections.length}</span>` : '<span class="muted tiny">Apuesta simple</span>'}</div>
        <span class="status-badge ${stColor}">${stTxt}</span>
      </div>
      ${w.selections
        .map(
          (s) => `
        <div class="wager-leg">
          <span><span class="leg-dot dot-${s.legStatus}"></span>${esc(s.betTitle)} · <b style="color:var(--text)">${esc(s.optionLabel)}</b></span>
          <span class="num">×${s.odds}</span>
        </div>`
        )
        .join('')}
      <div class="wager-foot">
        <span class="muted">Apostado <b class="num" style="color:var(--text)">${fmt(w.stake)}</b> · Cuota <b class="num" style="color:var(--gold)">×${fmt(w.totalOdds)}</b></span>
        <span>${
          w.status === 'won'
            ? `<b class="pos num">+${fmt(w.payout)} 🪙</b>`
            : w.status === 'lost'
            ? `<b class="neg num">−${fmt(w.stake)} 🪙</b>`
            : w.status === 'void'
            ? `<b class="muted num">${fmt(w.payout)} 🪙 reembolso</b>`
            : `<span class="muted">posible <b class="num" style="color:var(--accent)">${fmt(w.stake * w.totalOdds)} 🪙</b></span>`
        }</span>
      </div>
    </div>`;
}

/* ---------------------- Vista: crear apuesta --------------------- */
const newBetDraft = {
  title: '',
  description: '',
  closesAt: '',
  multi: false,
  options: [
    { label: '', odds: '2.0' },
    { label: '', odds: '2.0' },
  ],
};

function renderNewBet(root) {
  root.innerHTML = `
    <div class="layout" style="grid-template-columns:1fr 360px">
      <div>
        <div class="section-title">Nueva apuesta</div>
        <div class="card card-pad">
          <div class="template-pills">
            <button class="pill" data-tpl="yesno">⚡ Sí / No</button>
            <button class="pill" data-tpl="three">🎲 3 opciones</button>
            <button class="pill" data-tpl="match">⚽ 1 · X · 2</button>
            <button class="pill" data-tpl="clear">🧹 Vaciar</button>
          </div>
          <div class="field">
            <label>Título de la apuesta</label>
            <input class="input" id="b-title" placeholder="¿Quién gana el FIFA esta noche?" value="${esc(newBetDraft.title)}" />
          </div>
          <div class="field">
            <label>Descripción (opcional)</label>
            <textarea class="textarea" id="b-desc" placeholder="Detalles, reglas, condiciones…">${esc(newBetDraft.description)}</textarea>
          </div>
          <div class="field">
            <label>Cierre de apuestas (opcional)</label>
            <input class="input" id="b-closes" type="datetime-local" value="${newBetDraft.closesAt}" />
          </div>
          <div class="field">
            <label>Opciones y cuotas</label>
            <div id="opt-list"></div>
            <button class="btn btn-sm btn-ghost" id="add-opt">+ Añadir opción</button>
          </div>
          <label class="house-toggle" style="margin:2px 0 14px">
            <input type="checkbox" id="b-multi" ${newBetDraft.multi ? 'checked' : ''} />
            <span>🎯 Permitir elegir <b style="color:var(--gold)">&nbsp;varias opciones&nbsp;</b> del mismo evento (las cuotas se multiplican; al liquidar podrás marcar varias ganadoras)</span>
          </label>
          <button class="btn btn-primary mt" id="create-bet">Publicar apuesta</button>
        </div>
      </div>
      <div>
        <div class="section-title">Vista previa</div>
        <div id="preview"></div>
        <div class="card card-pad tiny muted">
          💡 La <b>cuota</b> multiplica la apuesta. Cuota ×2.0 = duplicas si aciertas.
          Cuanto mayor la cuota, menos probable (según tú, la casa).
        </div>
      </div>
    </div>`;

  const renderOpts = () => {
    const list = root.querySelector('#opt-list');
    list.innerHTML = newBetDraft.options
      .map(
        (o, i) => `
        <div class="opt-row" data-i="${i}">
          <input class="input lbl" placeholder="Opción ${i + 1}" value="${esc(o.label)}" data-f="label" />
          <input class="input od" type="number" step="0.01" min="1.01" placeholder="cuota" value="${esc(o.odds)}" data-f="odds" />
          <button class="del" data-del="${i}" ${newBetDraft.options.length <= 2 ? 'style="visibility:hidden"' : ''}>×</button>
        </div>`
      )
      .join('');
    list.querySelectorAll('.opt-row').forEach((rowEl) => {
      const i = Number(rowEl.dataset.i);
      rowEl.querySelectorAll('[data-f]').forEach((inp) =>
        inp.addEventListener('input', () => {
          newBetDraft.options[i][inp.dataset.f] = inp.value;
          renderPreview();
        })
      );
      const del = rowEl.querySelector('[data-del]');
      if (del)
        del.addEventListener('click', () => {
          newBetDraft.options.splice(i, 1);
          renderOpts();
          renderPreview();
        });
    });
  };

  const renderPreview = () => {
    const prev = root.querySelector('#preview');
    const fakeBet = {
      id: 'preview',
      title: newBetDraft.title || 'Título de la apuesta',
      description: newBetDraft.description,
      status: 'open',
      multi: newBetDraft.multi,
      closesAt: newBetDraft.closesAt ? new Date(newBetDraft.closesAt).toISOString() : null,
      winningOptionIds: null,
      options: newBetDraft.options
        .filter((o) => o.label.trim())
        .map((o, i) => ({ id: 'p' + i, label: o.label, odds: Number(o.odds) || 1 })),
      stats: { totals: {}, count: 0 },
    };
    if (fakeBet.options.length === 0) fakeBet.options = [{ id: 'p', label: 'Añade opciones…', odds: 1 }];
    prev.innerHTML = betCardHTML(fakeBet);
  };

  // bindings
  root.querySelector('#b-title').addEventListener('input', (e) => {
    newBetDraft.title = e.target.value;
    renderPreview();
  });
  root.querySelector('#b-desc').addEventListener('input', (e) => {
    newBetDraft.description = e.target.value;
    renderPreview();
  });
  root.querySelector('#b-closes').addEventListener('input', (e) => {
    newBetDraft.closesAt = e.target.value;
  });
  root.querySelector('#b-multi').addEventListener('change', (e) => {
    newBetDraft.multi = e.target.checked;
    renderPreview();
  });
  root.querySelector('#add-opt').addEventListener('click', () => {
    newBetDraft.options.push({ label: '', odds: '2.0' });
    renderOpts();
  });
  root.querySelectorAll('[data-tpl]').forEach((b) =>
    b.addEventListener('click', () => {
      const t = b.dataset.tpl;
      if (t === 'yesno') newBetDraft.options = [{ label: 'Sí', odds: '1.8' }, { label: 'No', odds: '2.0' }];
      else if (t === 'three')
        newBetDraft.options = [{ label: 'Opción A', odds: '2.5' }, { label: 'Opción B', odds: '2.5' }, { label: 'Opción C', odds: '3.0' }];
      else if (t === 'match')
        newBetDraft.options = [{ label: 'Local (1)', odds: '2.1' }, { label: 'Empate (X)', odds: '3.2' }, { label: 'Visitante (2)', odds: '3.0' }];
      else newBetDraft.options = [{ label: '', odds: '2.0' }, { label: '', odds: '2.0' }];
      renderOpts();
      renderPreview();
    })
  );
  root.querySelector('#create-bet').addEventListener('click', async () => {
    const payload = {
      title: newBetDraft.title.trim(),
      description: newBetDraft.description.trim(),
      type: 'custom',
      multi: newBetDraft.multi,
      closesAt: newBetDraft.closesAt || null,
      options: newBetDraft.options
        .filter((o) => o.label.trim())
        .map((o) => ({ label: o.label.trim(), odds: Number(o.odds) })),
    };
    try {
      await api('/bets', { method: 'POST', body: payload });
      toast('¡Apuesta publicada! 🎉', 'gold');
      newBetDraft.title = '';
      newBetDraft.description = '';
      newBetDraft.closesAt = '';
      newBetDraft.multi = false;
      newBetDraft.options = [{ label: '', odds: '2.0' }, { label: '', odds: '2.0' }];
      state.view = 'manage';
      render();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  renderOpts();
  renderPreview();
}

/* ---------------------- Vista: gestionar (admin) ----------------- */
function renderManage(root) {
  const bets = state.bets;
  root.innerHTML = `
    <div class="section-title">Tus apuestas como casa</div>
    ${
      bets.length
        ? bets.map(manageCardHTML).join('')
        : `<div class="empty"><div class="big">🏠</div>Aún no has creado apuestas.<br/><button class="btn btn-primary" id="go-new" style="width:auto;display:inline-flex;margin-top:14px">Crear la primera</button></div>`
    }`;
  const goNew = root.querySelector('#go-new');
  if (goNew) goNew.addEventListener('click', () => ((state.view = 'new'), render()));

  root.querySelectorAll('[data-action]').forEach((b) =>
    b.addEventListener('click', async () => {
      const { action, id } = b.dataset;
      const bet = state.bets.find((x) => x.id === id);
      if (action === 'settle') return settleModal(bet);
      if (action === 'close') return adminAction(`/bets/${id}/close`).then(() => toast('Apuesta cerrada'));
      if (action === 'reopen') return adminAction(`/bets/${id}/reopen`).then(() => toast('Apuesta reabierta'));
      if (action === 'cancel') {
        if (confirm('¿Anular esta apuesta? Se reembolsarán todas las fichas apostadas.'))
          return adminAction(`/bets/${id}/cancel`).then(() => toast('Apuesta anulada y reembolsada'));
      }
      if (action === 'delete') {
        if (confirm('¿Borrar esta apuesta?'))
          return adminAction(`/bets/${id}`, 'DELETE').then(() => toast('Apuesta borrada'));
      }
    })
  );
}

function manageCardHTML(bet) {
  const totalStaked = Object.values(bet.stats.totals || {}).reduce((a, b) => a + b, 0);
  const winners = bet.winningOptionIds || [];
  const winLabel =
    bet.status === 'settled'
      ? bet.options.filter((o) => winners.includes(o.id)).map((o) => esc(o.label)).join(', ')
      : null;
  let actions = '';
  if (bet.status === 'open')
    actions = `
      <button class="btn btn-sm" data-action="close" data-id="${bet.id}">Cerrar</button>
      <button class="btn btn-sm btn-gold" data-action="settle" data-id="${bet.id}">Liquidar</button>
      <button class="btn btn-sm btn-danger" data-action="cancel" data-id="${bet.id}">Anular</button>`;
  else if (bet.status === 'closed')
    actions = `
      <button class="btn btn-sm" data-action="reopen" data-id="${bet.id}">Reabrir</button>
      <button class="btn btn-sm btn-gold" data-action="settle" data-id="${bet.id}">Liquidar</button>
      <button class="btn btn-sm btn-danger" data-action="cancel" data-id="${bet.id}">Anular</button>`;
  else
    actions = `<button class="btn btn-sm btn-danger" data-action="delete" data-id="${bet.id}">Borrar</button>`;

  return `
    <div class="card bet-card">
      <div class="bet-head">
        <div>
          <h3 class="bet-title">${esc(bet.title)}</h3>
          ${bet.description ? `<p class="bet-desc">${esc(bet.description)}</p>` : ''}
        </div>
        <span class="status-badge st-${bet.status}">${
    bet.status === 'open' ? 'abierta' : bet.status === 'closed' ? 'cerrada' : bet.status === 'settled' ? 'liquidada' : 'anulada'
  }</span>
      </div>
      <div class="bet-meta">
        <span>🪙 <b>${fmt(totalStaked)}</b> en juego</span>
        <span><b>${bet.stats.count}</b> apuestas</span>
        ${bet.multi ? `<span class="combo-tag" style="margin:0">🎯 multi-opción</span>` : ''}
        ${winLabel ? `<span style="color:var(--accent)">✓ Ganó: <b>${winLabel}</b></span>` : ''}
        ${bet.closesAt && bet.status === 'open' ? `<span>⏱ ${timeLeft(bet.closesAt)}</span>` : ''}
      </div>
      <div class="options" style="grid-template-columns:repeat(auto-fit,minmax(130px,1fr))">
        ${bet.options
          .map((o) => {
            const isWin = winners.includes(o.id);
            return `<div class="option ${isWin ? 'winner' : ''}" style="cursor:default">
              <span class="ol">${esc(o.label)} ${isWin ? '✓' : ''}</span><span class="oo">×${o.odds}</span></div>`;
          })
          .join('')}
      </div>
      <div style="display:flex;gap:8px;padding:0 18px 18px;flex-wrap:wrap">${actions}</div>
    </div>`;
}

/* ---------------------- Vista: jugadores (admin) ----------------- */
function renderPlayers(root) {
  const players = state.players.filter((p) => p.role !== 'admin');
  const admins = state.players.filter((p) => p.role === 'admin');
  const totalChips = state.players.reduce((a, p) => a + p.chips, 0);
  const pendingWagers = state.allWagers.filter((w) => w.status === 'pending');
  const exposure = pendingWagers.reduce((a, w) => a + (w.stake * w.totalOdds - w.stake), 0);

  root.innerHTML = `
    <div class="section-title">Resumen de la casa</div>
    <div class="card card-pad" style="display:flex;gap:28px;flex-wrap:wrap;margin-bottom:20px">
      <div><div class="muted tiny">Jugadores</div><div class="num" style="font-size:24px">${players.length}</div></div>
      <div><div class="muted tiny">Fichas en circulación</div><div class="num" style="font-size:24px;color:var(--accent)">${fmt(totalChips)} 🪙</div></div>
      <div><div class="muted tiny">Apuestas activas</div><div class="num" style="font-size:24px;color:var(--gold)">${pendingWagers.length}</div></div>
      <div><div class="muted tiny">Exposición (si todas ganan)</div><div class="num neg" style="font-size:24px">${fmt(exposure)} 🪙</div></div>
    </div>
    <div class="section-title">Jugadores</div>
    <div class="card card-pad" style="overflow-x:auto">
      <table class="table">
        <thead><tr><th>Jugador</th><th>Saldo</th><th>Apostado</th><th>Ganado</th><th>Apuestas</th><th></th></tr></thead>
        <tbody>
          ${
            players.length
              ? players
                  .map(
                    (p) => `
            <tr>
              <td><div style="display:flex;align-items:center;gap:10px">
                <div class="avatar" style="background:${avatarColor(p.username)};width:28px;height:28px;font-size:12px">${initials(p.username)}</div>
                ${esc(p.username)}</div></td>
              <td class="num pos">${fmt(p.chips)} 🪙</td>
              <td class="num">${fmt(p.staked)}</td>
              <td class="num">${fmt(p.won)}</td>
              <td class="num">${p.wagerCount}</td>
              <td><button class="btn btn-sm" data-chips="${p.id}">Ajustar fichas</button></td>
            </tr>`
                  )
                  .join('')
              : `<tr><td colspan="6" class="center muted" style="padding:30px">Todavía no hay jugadores registrados.</td></tr>`
          }
        </tbody>
      </table>
    </div>
    ${
      admins.length
        ? `<div class="section-title">Casa</div>
      <div class="card card-pad">${admins
        .map((a) => `<div style="display:flex;align-items:center;gap:10px"><div class="avatar" style="background:${avatarColor(a.username)};width:28px;height:28px;font-size:12px">${initials(a.username)}</div>${esc(a.username)} <span class="role-tag role-admin">casa</span> · <span class="num">${fmt(a.chips)} 🪙</span></div>`)
        .join('')}</div>`
        : ''
    }
    <div class="section-title">Últimas apuestas de jugadores</div>
    <div class="card card-pad">
      ${
        state.allWagers.length
          ? state.allWagers
              .slice(0, 15)
              .map(
                (w) => `
        <div class="wager-leg" style="border-bottom:1px solid var(--border-soft)">
          <span><b style="color:var(--text)">${esc(w.username)}</b> · ${w.selections.length > 1 ? `combinada ×${w.selections.length}` : esc(w.selections[0]?.optionLabel || '')} · <span class="num">×${fmt(w.totalOdds)}</span></span>
          <span class="num">${fmt(w.stake)} 🪙 → <span style="color:${w.status === 'won' ? 'var(--accent)' : w.status === 'lost' ? 'var(--red)' : 'var(--gold)'}">${w.status === 'pending' ? fmt(w.stake * w.totalOdds) + ' pos.' : w.status === 'won' ? '+' + fmt(w.payout) : w.status === 'lost' ? 'perdida' : 'reemb.'}</span></span>
        </div>`
              )
              .join('')
          : `<div class="center muted" style="padding:20px">Sin apuestas todavía.</div>`
      }
    </div>
    <div class="section-title">Copia de seguridad</div>
    <div class="card card-pad">
      <p class="tiny muted" style="margin-top:0;line-height:1.6">
        Exporta una copia <b>antes de actualizar la app</b> y restáurala después para no perder nada.
        El archivo contiene datos sensibles (contraseñas cifradas): guárdalo en privado.
      </p>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-primary" id="export-backup" style="width:auto">⬇️ Exportar copia</button>
        <button class="btn btn-ghost" id="import-backup" style="width:auto">⬆️ Restaurar copia…</button>
      </div>
    </div>`;

  root.querySelectorAll('[data-chips]').forEach((b) =>
    b.addEventListener('click', () => {
      const p = state.players.find((x) => x.id === b.dataset.chips);
      chipsModal(p);
    })
  );
  root.querySelector('#export-backup').addEventListener('click', exportBackup);
  root.querySelector('#import-backup').addEventListener('click', importModal);
}

/* ---------------------- Vista: ranking --------------------------- */
function renderRanking(root) {
  const r = state.ranking;
  const medals = ['🥇', '🥈', '🥉'];
  const leader = r[0];
  root.innerHTML = `
    <div class="section-title">Clasificación por saldo</div>
    ${
      r.length
        ? `<div class="card card-pad" style="overflow-x:auto">
        <table class="table">
          <thead><tr><th>#</th><th>Jugador</th><th>Saldo</th><th>Ganadas</th><th>Beneficio</th></tr></thead>
          <tbody>
            ${r
              .map((p, i) => {
                const me = p.id === state.user.id;
                return `<tr style="${me ? 'background:rgba(56,224,123,0.07)' : ''}">
                  <td class="num" style="font-size:17px;width:46px">${medals[i] || `<span class="muted">${i + 1}</span>`}</td>
                  <td><div style="display:flex;align-items:center;gap:10px">
                    <div class="avatar" style="background:${avatarColor(p.username)};width:30px;height:30px;font-size:12px">${initials(p.username)}</div>
                    <span style="font-weight:600">${esc(p.username)}${me ? ' <span class="tiny muted">(tú)</span>' : ''}</span>
                  </div></td>
                  <td class="num pos" style="font-size:15px">${fmt(p.chips)} 🪙</td>
                  <td class="num">${p.wonCount}</td>
                  <td class="num ${p.profit >= 0 ? 'pos' : 'neg'}">${p.profit >= 0 ? '+' : ''}${fmt(p.profit)}</td>
                </tr>`;
              })
              .join('')}
          </tbody>
        </table>
      </div>
      ${leader ? `<p class="center mt muted">👑 Líder actual: <b style="color:var(--gold)">${esc(leader.username)}</b> con ${fmt(leader.chips)} 🪙</p>` : ''}
      <p class="tiny muted center">El saldo de la casa no cuenta en la clasificación.</p>`
        : `<div class="empty"><div class="big">🏆</div>Aún no hay jugadores en el ranking.</div>`
    }`;
}

/* ---------------------- Vista: apuestas ganadas ------------------ */
function renderWins(root) {
  const w = state.wins;
  const totalPaid = w.reduce((a, x) => a + x.payout, 0);
  root.innerHTML = `
    <div class="section-title">Apuestas ganadas</div>
    ${
      w.length
        ? `<div class="card card-pad" style="display:flex;gap:28px;flex-wrap:wrap;margin-bottom:20px">
            <div><div class="muted tiny">Total de apuestas ganadas</div><div class="num" style="font-size:24px;color:var(--accent)">${w.length}</div></div>
            <div><div class="muted tiny">Fichas repartidas</div><div class="num" style="font-size:24px;color:var(--gold)">${fmt(totalPaid)} 🪙</div></div>
          </div>
          ${w.map(winCardHTML).join('')}`
        : `<div class="empty"><div class="big">🎉</div>Todavía no hay ninguna apuesta ganada.<br/>¡Que empiece la suerte!</div>`
    }`;

  root.querySelectorAll('[data-void]').forEach((b) =>
    b.addEventListener('click', async () => {
      const win = state.wins.find((x) => x.id === b.dataset.void);
      if (
        confirm(
          `¿Anular esta apuesta ganada de ${win?.username || 'este jugador'}?\n\n` +
            `Se le quitarán las ganancias y se le devolverá solo lo apostado (${fmt(win?.stake || 0)} 🪙).`
        )
      ) {
        await adminAction(`/wagers/${b.dataset.void}/void`, 'PATCH');
        toast('Apuesta anulada · importe devuelto al jugador', 'gold');
      }
    })
  );
}

function winCardHTML(w) {
  const combo = w.selections.length > 1;
  const isAdmin = state.user?.role === 'admin';
  return `
    <div class="wager">
      <div class="wager-head">
        <div style="display:flex;align-items:center;gap:10px">
          <div class="avatar" style="background:${avatarColor(w.username)};width:32px;height:32px;font-size:12px">${initials(w.username)}</div>
          <div>
            <div style="font-weight:600">${esc(w.username)}</div>
            <div class="tiny muted">${combo ? `Combinada ×${w.selections.length}` : 'Apuesta simple'}</div>
          </div>
        </div>
        <span class="status-badge st-settled">Ganada ✓</span>
      </div>
      ${w.selections
        .map(
          (s) => `
        <div class="wager-leg">
          <span><span class="leg-dot dot-won"></span>${esc(s.betTitle)} · <b style="color:var(--text)">${esc(s.optionLabel)}</b></span>
          <span class="num">×${s.odds}</span>
        </div>`
        )
        .join('')}
      <div class="wager-foot">
        <span class="muted">Apostó <b class="num" style="color:var(--text)">${fmt(w.stake)}</b> · Cuota <b class="num" style="color:var(--gold)">×${fmt(w.totalOdds)}</b></span>
        <span><b class="pos num">+${fmt(w.payout)} 🪙</b></span>
      </div>
      ${
        isAdmin
          ? `<div style="padding:0 18px 16px">
              <button class="btn btn-sm btn-danger" data-void="${w.id}">🚫 Anular (trampa) · devolver ${fmt(w.stake)} 🪙</button>
            </div>`
          : ''
      }
    </div>`;
}

/* ---------------------- Vista: la noche (MVP/cubatas) ------------ */
async function adjustNight(id, cat, delta) {
  try {
    await api(`/night/${id}/${cat}`, { method: 'POST', body: { delta } });
    loadNight(); // el socket también refresca a todos
  } catch (err) {
    toast(err.message, 'error');
  }
}
async function resetNight() {
  try {
    await api('/night/reset', { method: 'POST' });
    toast('Noche reiniciada · contadores a 0', 'gold');
    loadNight();
  } catch (err) {
    toast(err.message, 'error');
  }
}

function renderNight(root) {
  const isAdmin = state.user.role === 'admin';
  const players = state.night;
  const topMvp = players.reduce((m, x) => Math.max(m, x.stats.mvp || 0), 0);
  const topDrinks = players.reduce((m, x) => Math.max(m, x.drinks || 0), 0);

  root.innerHTML = `
    <div class="section-title">🌙 MVPs de la noche</div>
    <div class="card card-pad tiny muted" style="margin-bottom:16px;line-height:1.6">
      Registro de la noche, aparte de las apuestas: lleva la cuenta de 🍹 cubatas, 🥃 chupitos,
      🍺 cervezas y ⭐ MVP. Cada jugador edita sus propios contadores;
      ${isAdmin ? 'tú, como casa, puedes editar a cualquiera y repartir los ⭐ MVP.' : 'el ⭐ MVP lo reparte la casa.'}
      La casa no entra en el ranking.
    </div>
    ${
      isAdmin
        ? `<button class="btn btn-sm btn-danger" id="reset-night" style="margin-bottom:16px">🔄 Reiniciar la noche (todo a 0)</button>`
        : ''
    }
    ${
      players.length
        ? players.map((p, i) => nightCardHTML(p, i, { topMvp, topDrinks })).join('')
        : `<div class="empty"><div class="big">🌙</div>No hay jugadores registrados todavía.</div>`
    }`;

  root.querySelectorAll('[data-night]').forEach((b) =>
    b.addEventListener('click', () =>
      adjustNight(b.dataset.night, b.dataset.cat, Number(b.dataset.delta))
    )
  );
  const rn = root.querySelector('#reset-night');
  if (rn)
    rn.addEventListener('click', () => {
      if (confirm('¿Reiniciar todos los contadores de la noche a 0?')) resetNight();
    });
}

function nightCardHTML(p, idx, { topMvp, topDrinks }) {
  const isAdmin = state.user.role === 'admin';
  const me = state.user.id;
  const cats = state.nightCategories;
  const medal = ['🥇', '🥈', '🥉'][idx] || `${idx + 1}.`;
  const isMvpKing = (p.stats.mvp || 0) > 0 && (p.stats.mvp || 0) === topMvp;
  const isDrinkKing = (p.drinks || 0) > 0 && (p.drinks || 0) === topDrinks;
  return `
    <div class="card card-pad" style="margin-bottom:14px">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:14px">
        <span class="num" style="font-size:18px;width:34px">${medal}</span>
        <div class="avatar" style="background:${avatarColor(p.username)}">${initials(p.username)}</div>
        <div style="flex:1;min-width:0">
          <div style="font-weight:700;font-size:16px">
            ${esc(p.username)} ${isMvpKing ? '👑' : ''} ${isDrinkKing ? '🍹' : ''}
            ${p.id === me ? '<span class="tiny muted">(tú)</span>' : ''}
          </div>
          <div class="tiny muted">${p.drinks} copas en total${p.stats.mvp ? ` · ⭐ ${p.stats.mvp} MVP` : ''}</div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px">
        ${cats
          .map((c) => {
            const canEdit = (!c.adminOnly && (isAdmin || p.id === me)) || (c.adminOnly && isAdmin);
            const val = p.stats[c.key] || 0;
            return `
            <div class="option" style="cursor:default;flex-direction:column;align-items:stretch;gap:8px">
              <div style="display:flex;justify-content:space-between;align-items:center">
                <span class="ol">${c.emoji} ${esc(c.label)}</span>
                <span class="num" style="font-size:18px;color:${c.adminOnly ? 'var(--gold)' : 'var(--accent)'}">${val}</span>
              </div>
              ${
                canEdit
                  ? `<div style="display:flex;gap:6px">
                      <button class="btn btn-sm" style="flex:1" data-night="${p.id}" data-cat="${c.key}" data-delta="-1">−</button>
                      <button class="btn btn-sm" style="flex:1" data-night="${p.id}" data-cat="${c.key}" data-delta="1">+</button>
                    </div>`
                  : `<div class="tiny muted center">${c.adminOnly ? 'solo la casa' : 'solo cada uno'}</div>`
              }
            </div>`;
          })
          .join('')}
      </div>
    </div>`;
}

/* ----------------------------- Init ------------------------------ */
bootstrap();

// Refresca cuentas atrás cada minuto
setInterval(() => {
  if (state.user && (state.view === 'bets' || state.view === 'manage')) render();
}, 60000);
