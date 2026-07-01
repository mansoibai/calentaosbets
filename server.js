import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { Server as SocketServer } from 'socket.io';
import { db } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
// El secreto de sesión se lee SIEMPRE desde los datos (no se captura una sola vez).
// Así, al restaurar una copia de seguridad, los tokens antiguos siguen siendo
// válidos y nadie tiene que volver a iniciar sesión.
const jwtSecret = () => db.data.meta.jwtSecret;

const app = express();
const server = http.createServer(app);
const io = new SocketServer(server);

// Límite amplio: una copia de seguridad completa puede superar los 100 KB por defecto.
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

/* ----------------------------- Utilidades ----------------------------- */

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    username: u.username,
    role: u.role,
    chips: round2(u.chips),
    createdAt: u.createdAt,
  };
}

function findUser(id) {
  return db.data.users.find((u) => u.id === id);
}

function signToken(user) {
  return jwt.sign({ id: user.id }, jwtSecret(), { expiresIn: '30d' });
}

// Middleware de autenticación
function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'No autenticado' });
  try {
    const payload = jwt.verify(token, jwtSecret());
    const user = findUser(payload.id);
    if (!user) return res.status(401).json({ error: 'Usuario no encontrado' });
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: 'Sesión inválida' });
  }
}

function adminOnly(req, res, next) {
  if (req.user.role !== 'admin')
    return res.status(403).json({ error: 'Solo la casa puede hacer esto' });
  next();
}

/* --------------------------- Tiempo real (sockets) -------------------- */

io.on('connection', (socket) => {
  socket.on('auth', (token) => {
    try {
      const payload = jwt.verify(token, jwtSecret());
      socket.join(`user:${payload.id}`);
      const user = findUser(payload.id);
      if (user?.role === 'admin') socket.join('admins');
    } catch {
      /* token inválido: el socket simplemente no se une a salas privadas */
    }
  });
});

// Notifica a todos que la lista de apuestas cambió
function emitBets() {
  io.emit('bets:changed');
}
// Notifica a un usuario que su saldo / apuestas cambiaron
function emitUser(userId) {
  io.to(`user:${userId}`).emit('me:changed');
}
// Notifica a los admins que algo de jugadores cambió
function emitAdmins() {
  io.to('admins').emit('admin:changed');
}
// Notifica a TODOS que el ranking / apuestas ganadas pueden haber cambiado
function emitFeed() {
  io.emit('feed:changed');
}
// Notifica a TODOS que el registro de la noche (MVP, cubatas...) cambió
function emitNight() {
  io.emit('night:changed');
}

/* ------------------------------ Auth API ------------------------------ */

app.post('/api/register', async (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  const houseCode = String(req.body.houseCode || '').trim();

  if (username.length < 2)
    return res.status(400).json({ error: 'El nombre debe tener al menos 2 caracteres' });
  if (password.length < 4)
    return res.status(400).json({ error: 'La contraseña debe tener al menos 4 caracteres' });
  if (db.data.users.some((u) => u.username.toLowerCase() === username.toLowerCase()))
    return res.status(409).json({ error: 'Ese nombre ya está en uso' });

  // Es admin (la "casa") si introduce el código correcto o si es el primer usuario
  const isFirstUser = db.data.users.length === 0;
  const wantsHouse = houseCode.length > 0;
  let role = 'player';
  if (wantsHouse) {
    if (houseCode !== db.data.meta.houseCode)
      return res.status(403).json({ error: 'Código de la casa incorrecto' });
    role = 'admin';
  } else if (isFirstUser) {
    role = 'admin';
  }

  const user = {
    id: db.id(),
    username,
    passwordHash: await bcrypt.hash(password, 10),
    role,
    chips: role === 'admin' ? 100000 : db.data.meta.startingChips,
    createdAt: new Date().toISOString(),
  };
  db.data.users.push(user);
  db.persist();
  emitAdmins();
  res.json({ token: signToken(user), user: publicUser(user) });
});

app.post('/api/login', async (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  const user = db.data.users.find(
    (u) => u.username.toLowerCase() === username.toLowerCase()
  );
  if (!user || !(await bcrypt.compare(password, user.passwordHash)))
    return res.status(401).json({ error: 'Nombre o contraseña incorrectos' });
  res.json({ token: signToken(user), user: publicUser(user) });
});

app.get('/api/me', auth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

/* ------------------------------ Bets API ------------------------------ */

function publicBet(bet) {
  const stats = wagerStatsForBet(bet.id);
  return { ...bet, stats };
}

// Cuánto se ha apostado a cada opción (informativo)
function wagerStatsForBet(betId) {
  const totals = {};
  let count = 0;
  for (const w of db.data.wagers) {
    for (const sel of w.selections) {
      if (sel.betId === betId) {
        totals[sel.optionId] = (totals[sel.optionId] || 0) + w.stake / w.selections.length;
        count++;
      }
    }
  }
  return { totals, count };
}

function isBetOpen(bet) {
  if (bet.status !== 'open') return false;
  if (bet.closesAt && new Date(bet.closesAt).getTime() < Date.now()) return false;
  return true;
}

app.get('/api/bets', auth, (req, res) => {
  const bets = [...db.data.bets].sort(
    (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
  );
  res.json({ bets: bets.map(publicBet) });
});

app.post('/api/bets', auth, adminOnly, (req, res) => {
  const title = String(req.body.title || '').trim();
  const description = String(req.body.description || '').trim();
  const type = ['simple', 'yesno', 'custom'].includes(req.body.type)
    ? req.body.type
    : 'custom';
  const closesAt = req.body.closesAt ? new Date(req.body.closesAt).toISOString() : null;
  const rawOptions = Array.isArray(req.body.options) ? req.body.options : [];

  if (title.length < 3)
    return res.status(400).json({ error: 'El título debe tener al menos 3 caracteres' });

  const options = rawOptions
    .map((o) => ({
      id: db.id(),
      label: String(o.label || '').trim(),
      odds: Number(o.odds),
    }))
    .filter((o) => o.label.length > 0 && o.odds >= 1.01 && Number.isFinite(o.odds));

  if (options.length < 2)
    return res.status(400).json({ error: 'Hace falta al menos 2 opciones con cuota válida (≥1.01)' });

  const bet = {
    id: db.id(),
    title,
    description,
    type,
    multi: !!req.body.multi, // permite elegir varias opciones del mismo evento (se multiplican)
    flash: !!req.body.flash, // apuesta "del momento": sale destacada y fijada arriba del mercado
    options,
    status: 'open',
    closesAt,
    winningOptionIds: null, // array de opciones ganadoras al liquidar
    createdAt: new Date().toISOString(),
    createdBy: req.user.id,
  };
  db.data.bets.push(bet);
  db.persist();
  emitBets();
  res.json({ bet: publicBet(bet) });
});

app.patch('/api/bets/:id/close', auth, adminOnly, (req, res) => {
  const bet = db.data.bets.find((b) => b.id === req.params.id);
  if (!bet) return res.status(404).json({ error: 'Apuesta no encontrada' });
  if (bet.status === 'open') bet.status = 'closed';
  db.persist();
  emitBets();
  res.json({ bet: publicBet(bet) });
});

app.patch('/api/bets/:id/reopen', auth, adminOnly, (req, res) => {
  const bet = db.data.bets.find((b) => b.id === req.params.id);
  if (!bet) return res.status(404).json({ error: 'Apuesta no encontrada' });
  if (bet.status === 'closed') bet.status = 'open';
  db.persist();
  emitBets();
  res.json({ bet: publicBet(bet) });
});

// ¿Es esta opción una de las ganadoras de la apuesta?
function optionIsWinner(bet, optionId) {
  if (Array.isArray(bet.winningOptionIds)) return bet.winningOptionIds.includes(optionId);
  return bet.winningOptionId === optionId; // compatibilidad con datos antiguos
}

// Liquidar: la casa elige la(s) opción(es) ganadora(s)
app.patch('/api/bets/:id/settle', auth, adminOnly, (req, res) => {
  const bet = db.data.bets.find((b) => b.id === req.params.id);
  if (!bet) return res.status(404).json({ error: 'Apuesta no encontrada' });
  if (bet.status === 'settled')
    return res.status(400).json({ error: 'Esta apuesta ya está liquidada' });

  // Acepta una sola opción (winningOptionId) o varias (winningOptionIds)
  let winners = Array.isArray(req.body.winningOptionIds)
    ? req.body.winningOptionIds
    : req.body.winningOptionId
    ? [req.body.winningOptionId]
    : [];
  winners = [...new Set(winners)].filter((id) => bet.options.some((o) => o.id === id));

  if (winners.length === 0)
    return res.status(400).json({ error: 'Elige al menos una opción ganadora' });

  bet.status = 'settled';
  bet.winningOptionIds = winners;
  delete bet.winningOptionId;
  db.persist();
  resettleAll();
  emitBets();
  res.json({ bet: publicBet(bet) });
});

// Cancelar/anular: se reembolsan las apuestas afectadas (cuota de esa pata = 1.0)
app.patch('/api/bets/:id/cancel', auth, adminOnly, (req, res) => {
  const bet = db.data.bets.find((b) => b.id === req.params.id);
  if (!bet) return res.status(404).json({ error: 'Apuesta no encontrada' });
  bet.status = 'cancelled';
  bet.winningOptionIds = null;
  delete bet.winningOptionId;
  db.persist();
  resettleAll();
  emitBets();
  res.json({ bet: publicBet(bet) });
});

app.delete('/api/bets/:id', auth, adminOnly, (req, res) => {
  const bet = db.data.bets.find((b) => b.id === req.params.id);
  if (!bet) return res.status(404).json({ error: 'Apuesta no encontrada' });
  const used = db.data.wagers.some((w) => w.selections.some((s) => s.betId === bet.id));
  if (used)
    return res
      .status(400)
      .json({ error: 'No se puede borrar: tiene apuestas. Usa "Anular" para reembolsar.' });
  db.data.bets = db.data.bets.filter((b) => b.id !== bet.id);
  db.persist();
  emitBets();
  res.json({ ok: true });
});

/* ----------------------------- Wagers API ----------------------------- */

function publicWager(w) {
  // Apuesta anulada manualmente por la casa (p.ej. trampa): patas anuladas y cuota 1.
  const adminVoid = w.status === 'void' && w.voidedByAdmin;
  // Enriquecemos con info legible de cada selección
  const selections = w.selections.map((s) => {
    const bet = db.data.bets.find((b) => b.id === s.betId);
    const option = bet?.options.find((o) => o.id === s.optionId);
    let legStatus = 'pending';
    if (adminVoid) {
      legStatus = 'void';
    } else if (bet) {
      if (bet.status === 'cancelled') legStatus = 'void';
      else if (bet.status === 'settled')
        legStatus = optionIsWinner(bet, s.optionId) ? 'won' : 'lost';
    }
    return {
      betId: s.betId,
      optionId: s.optionId,
      odds: s.odds,
      betTitle: bet?.title || '(eliminada)',
      optionLabel: option?.label || '(opción eliminada)',
      legStatus,
    };
  });
  return { ...w, selections, totalOdds: adminVoid ? 1 : round2(combinedOdds(w)) };
}

function combinedOdds(w) {
  // Producto de cuotas; las patas anuladas cuentan como 1.0
  return w.selections.reduce((acc, s) => {
    const bet = db.data.bets.find((b) => b.id === s.betId);
    const odds = bet && bet.status === 'cancelled' ? 1 : s.odds;
    return acc * odds;
  }, 1);
}

app.post('/api/wagers', auth, (req, res) => {
  const stake = Number(req.body.stake);
  const rawSelections = Array.isArray(req.body.selections) ? req.body.selections : [];

  if (!Number.isFinite(stake) || stake <= 0)
    return res.status(400).json({ error: 'Importe inválido' });
  if (stake > req.user.chips)
    return res.status(400).json({ error: 'No tienes fichas suficientes' });
  if (rawSelections.length === 0)
    return res.status(400).json({ error: 'Selecciona al menos una opción' });

  // Reglas: en apuestas normales, una sola opción por evento.
  // En apuestas "multi", se pueden elegir varias opciones del mismo evento (se multiplican),
  // pero nunca la misma opción dos veces.
  const betIds = new Set();
  const optionKeys = new Set();
  const selections = [];
  for (const sel of rawSelections) {
    const bet = db.data.bets.find((b) => b.id === sel.betId);
    if (!bet) return res.status(400).json({ error: 'Una de las apuestas no existe' });
    if (!isBetOpen(bet))
      return res.status(400).json({ error: `"${bet.title}" ya no admite apuestas` });
    if (betIds.has(bet.id) && !bet.multi)
      return res
        .status(400)
        .json({ error: `No puedes combinar dos opciones del mismo evento ("${bet.title}")` });
    const option = bet.options.find((o) => o.id === sel.optionId);
    if (!option) return res.status(400).json({ error: 'Opción inválida' });
    const key = bet.id + ':' + option.id;
    if (optionKeys.has(key))
      return res.status(400).json({ error: 'Has repetido la misma opción' });
    betIds.add(bet.id);
    optionKeys.add(key);
    selections.push({ betId: bet.id, optionId: option.id, odds: option.odds });
  }

  const wager = {
    id: db.id(),
    userId: req.user.id,
    stake: round2(stake),
    selections,
    status: 'pending', // pending | won | lost | void
    payout: 0,
    createdAt: new Date().toISOString(),
    settledAt: null,
  };

  req.user.chips = round2(req.user.chips - wager.stake);
  db.data.wagers.push(wager);
  db.persist();
  emitUser(req.user.id);
  emitAdmins();
  emitFeed();
  res.json({ wager: publicWager(wager), chips: req.user.chips });
});

app.get('/api/wagers/me', auth, (req, res) => {
  const mine = db.data.wagers
    .filter((w) => w.userId === req.user.id)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map(publicWager);
  res.json({ wagers: mine });
});

app.get('/api/wagers', auth, adminOnly, (req, res) => {
  const all = db.data.wagers
    .slice()
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map((w) => ({ ...publicWager(w), username: findUser(w.userId)?.username || '?' }));
  res.json({ wagers: all });
});

// Ranking de jugadores por saldo (de mayor a menor). NO incluye a la casa/admin.
app.get('/api/ranking', auth, (req, res) => {
  const players = db.data.users
    .filter((u) => u.role !== 'admin')
    .map((u) => {
      const wagers = db.data.wagers.filter((w) => w.userId === u.id);
      const wonWagers = wagers.filter((w) => w.status === 'won');
      const profit = round2(
        wagers.reduce(
          (a, w) =>
            a + (w.status === 'won' ? w.payout - w.stake : w.status === 'lost' ? -w.stake : 0),
          0
        )
      );
      return {
        id: u.id,
        username: u.username,
        chips: round2(u.chips),
        wonCount: wonWagers.length,
        wagerCount: wagers.length,
        profit,
      };
    })
    .sort((a, b) => b.chips - a.chips);
  res.json({ ranking: players });
});

// Apuestas GANADAS de todos los jugadores (solo las ganadas), más recientes primero.
app.get('/api/wins', auth, (req, res) => {
  const wins = db.data.wagers
    .filter((w) => w.status === 'won')
    .sort((a, b) => new Date(b.settledAt || b.createdAt) - new Date(a.settledAt || a.createdAt))
    .map((w) => ({ ...publicWager(w), username: findUser(w.userId)?.username || '?' }));
  res.json({ wins });
});

// La casa anula una apuesta YA GANADA (p.ej. si detecta trampas).
// Se le quitan las ganancias al jugador y se le devuelve SOLO el importe apostado
// (cuota efectiva 1). El ticket queda como "anulado por la casa".
app.patch('/api/wagers/:id/void', auth, adminOnly, (req, res) => {
  const w = db.data.wagers.find((x) => x.id === req.params.id);
  if (!w) return res.status(404).json({ error: 'Apuesta no encontrada' });
  if (w.status !== 'won')
    return res.status(400).json({ error: 'Solo se pueden anular apuestas ya ganadas' });

  const user = findUser(w.userId);
  if (user) {
    // Deshace el pago de la ganancia y reembolsa el importe apostado.
    user.chips = round2(Math.max(0, user.chips - w.payout + w.stake));
    emitUser(user.id);
  }
  w.status = 'void';
  w.payout = round2(w.stake); // reembolso íntegro del importe apostado
  w.voidedByAdmin = true;
  w.settledAt = new Date().toISOString();
  db.persist();
  emitAdmins();
  emitFeed();
  res.json({ wager: publicWager(w) });
});

/* --------------- Registro de la noche (MVP, cubatas...) --------------- */
// Sección independiente de las apuestas: contadores divertidos por jugador.
const NIGHT_CATEGORIES = [
  { key: 'mvp', label: 'MVP', emoji: '⭐', adminOnly: true, drink: false },
  { key: 'cubatas', label: 'Cubatas', emoji: '🍹', adminOnly: false, drink: true },
  { key: 'chupitos', label: 'Chupitos', emoji: '🥃', adminOnly: false, drink: true },
  { key: 'cervezas', label: 'Cervezas', emoji: '🍺', adminOnly: false, drink: true },
];

// Garantiza que el usuario tenga el objeto de stats con todas las categorías
function ensureNight(u) {
  if (!u.nightStats || typeof u.nightStats !== 'object') u.nightStats = {};
  for (const c of NIGHT_CATEGORIES)
    if (typeof u.nightStats[c.key] !== 'number') u.nightStats[c.key] = 0;
  return u.nightStats;
}

// Ranking de la noche (jugadores, sin admin), ordenado por copas totales y MVP.
app.get('/api/night', auth, (req, res) => {
  const players = db.data.users
    .filter((u) => u.role !== 'admin')
    .map((u) => {
      const st = ensureNight(u);
      const drinks = NIGHT_CATEGORIES.filter((c) => c.drink).reduce(
        (a, c) => a + (st[c.key] || 0),
        0
      );
      return { id: u.id, username: u.username, stats: { ...st }, drinks };
    })
    .sort((a, b) => b.drinks - a.drinks || (b.stats.mvp || 0) - (a.stats.mvp || 0));
  res.json({ categories: NIGHT_CATEGORIES, players });
});

// Sumar/restar 1 a un contador. Cada uno edita lo suyo; el MVP solo lo da la casa.
app.post('/api/night/:id/:cat', auth, (req, res) => {
  const cat = NIGHT_CATEGORIES.find((c) => c.key === req.params.cat);
  if (!cat) return res.status(400).json({ error: 'Categoría inválida' });
  const target = findUser(req.params.id);
  if (!target) return res.status(404).json({ error: 'Usuario no encontrado' });
  if (target.role === 'admin')
    return res.status(400).json({ error: 'La casa no entra en el registro de la noche' });

  const isAdmin = req.user.role === 'admin';
  if (cat.adminOnly && !isAdmin)
    return res.status(403).json({ error: `Solo la casa puede dar ${cat.label}` });
  if (!cat.adminOnly && !isAdmin && req.user.id !== target.id)
    return res.status(403).json({ error: 'Solo puedes editar tus propios contadores' });

  const delta = Number(req.body.delta);
  if (delta !== 1 && delta !== -1) return res.status(400).json({ error: 'Cambio inválido' });

  const st = ensureNight(target);
  st[cat.key] = Math.max(0, (st[cat.key] || 0) + delta);
  db.persist();
  emitNight();
  res.json({ ok: true });
});

// La casa reinicia la noche (pone todos los contadores a 0)
app.post('/api/night/reset', auth, adminOnly, (req, res) => {
  for (const u of db.data.users)
    if (u.role !== 'admin') {
      u.nightStats = {};
      ensureNight(u);
    }
  db.persist();
  emitNight();
  res.json({ ok: true });
});

/* ------------------------- Liquidación de apuestas -------------------- */

// Recalcula todas las apuestas pendientes y paga/reembolsa lo que proceda.
function resettleAll() {
  for (const w of db.data.wagers) {
    if (w.status !== 'pending') continue;

    const legs = w.selections.map((s) => {
      const bet = db.data.bets.find((b) => b.id === s.betId);
      if (!bet) return { state: 'void', odds: 1 }; // evento borrado -> reembolso de esa pata
      if (bet.status === 'cancelled') return { state: 'void', odds: 1 };
      if (bet.status === 'settled')
        return optionIsWinner(bet, s.optionId)
          ? { state: 'won', odds: s.odds }
          : { state: 'lost', odds: s.odds };
      return { state: 'pending', odds: s.odds };
    });

    // Si alguna pata perdió, la combinada está perdida (no hace falta esperar al resto)
    if (legs.some((l) => l.state === 'lost')) {
      w.status = 'lost';
      w.payout = 0;
      w.settledAt = new Date().toISOString();
      continue;
    }
    // Si todavía hay patas pendientes, esperamos
    if (legs.some((l) => l.state === 'pending')) continue;

    // Todas resueltas y ninguna perdida: ganadas y/o anuladas
    const allVoid = legs.every((l) => l.state === 'void');
    const totalOdds = legs.reduce((acc, l) => acc * l.odds, 1);
    if (allVoid) {
      w.status = 'void';
      w.payout = round2(w.stake); // reembolso íntegro
    } else {
      w.status = 'won';
      w.payout = round2(w.stake * totalOdds);
    }
    w.settledAt = new Date().toISOString();

    const user = findUser(w.userId);
    if (user) {
      user.chips = round2(user.chips + w.payout);
      emitUser(user.id);
    }
  }
  db.persist();
  emitAdmins();
  emitFeed();
}

/* ------------------------------ Users API ----------------------------- */

app.get('/api/users', auth, adminOnly, (req, res) => {
  const users = db.data.users.map((u) => {
    const wagers = db.data.wagers.filter((w) => w.userId === u.id);
    const staked = round2(wagers.reduce((a, w) => a + w.stake, 0));
    const won = round2(
      wagers.filter((w) => w.status === 'won').reduce((a, w) => a + w.payout, 0)
    );
    return { ...publicUser(u), staked, won, wagerCount: wagers.length };
  });
  res.json({ users });
});

// La casa ajusta fichas (positivo = dar, negativo = quitar)
app.post('/api/users/:id/chips', auth, adminOnly, (req, res) => {
  const user = findUser(req.params.id);
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
  const amount = Number(req.body.amount);
  if (!Number.isFinite(amount)) return res.status(400).json({ error: 'Cantidad inválida' });
  user.chips = round2(Math.max(0, user.chips + amount));
  db.persist();
  emitUser(user.id);
  emitAdmins();
  emitFeed();
  res.json({ user: publicUser(user) });
});

/* ----------------------- Copia de seguridad --------------------------- */

// Exportar: descarga TODOS los datos (usuarios con su hash, apuestas, saldos,
// historial y registro de la noche). Solo la casa. Es un archivo sensible.
app.get('/api/export', auth, adminOnly, (req, res) => {
  res.json(db.data);
});

// Importar: reemplaza TODOS los datos por los de una copia. No requiere sesión
// (así funciona tras un despliegue, cuando la app está vacía); se autoriza con
// el código de la casa. Nadie pierde nada: se restaura todo tal cual.
app.post('/api/import', (req, res) => {
  const houseCode = String(req.body.houseCode || '').trim();
  const incoming = req.body.data;

  if (houseCode !== db.data.meta.houseCode)
    return res.status(403).json({ error: 'Código de la casa incorrecto' });

  const valid =
    incoming &&
    typeof incoming === 'object' &&
    incoming.meta &&
    typeof incoming.meta === 'object' &&
    Array.isArray(incoming.users) &&
    Array.isArray(incoming.bets) &&
    Array.isArray(incoming.wagers);
  if (!valid)
    return res.status(400).json({ error: 'El archivo de copia no es válido' });

  db.replaceAll(incoming);
  // Avisa a todos los clientes conectados para que recarguen todo.
  emitBets();
  emitFeed();
  emitNight();
  io.emit('admin:changed');
  res.json({ ok: true, users: db.data.users.length, bets: db.data.bets.length });
});

/* ------------------------------- Arranque ----------------------------- */

// Cualquier ruta no-API devuelve el index (SPA)
app.get(/^\/(?!api|socket\.io).*/, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

server.listen(PORT, () => {
  console.log(`\n  🎲 Calentaos Bets corriendo en  http://localhost:${PORT}`);
  console.log(`  🏠 Código de la casa (admin): ${db.data.meta.houseCode}`);
  console.log(`  💾 Datos en:                  data.json\n`);
});
