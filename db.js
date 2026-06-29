// Persistencia sencilla en un archivo JSON (sin dependencias nativas).
// Carga todo en memoria y guarda de forma atómica (write temp + rename).
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, 'data.json');

const defaultData = () => ({
  meta: {
    jwtSecret: process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex'),
    houseCode: process.env.HOUSE_CODE || 'CASA2026',
    startingChips: 1000,
  },
  users: [],
  bets: [],
  wagers: [],
});

let data;

function load() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    data = JSON.parse(raw);
    // Asegura claves que pudieran faltar tras una actualización
    const d = defaultData();
    data.meta = { ...d.meta, ...data.meta };
    data.users ??= [];
    data.bets ??= [];
    data.wagers ??= [];
    // En producción (Railway) las variables de entorno mandan sobre lo guardado,
    // así el secreto de sesión y el código de la casa son estables entre reinicios.
    if (process.env.JWT_SECRET) data.meta.jwtSecret = process.env.JWT_SECRET;
    if (process.env.HOUSE_CODE) data.meta.houseCode = process.env.HOUSE_CODE;
  } catch {
    data = defaultData();
    save();
  }
}

let saveTimer = null;
function save() {
  // Escritura atómica: tmp + rename
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, DATA_FILE);
}

// Guardado diferido para no escribir disco en cada micro-cambio
function persist() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 50);
}

load();

export const db = {
  get data() {
    return data;
  },
  persist,
  saveNow: save,
  id: () => crypto.randomUUID(),
};
