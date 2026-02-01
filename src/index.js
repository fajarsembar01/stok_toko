import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import qrcodeTerminal from 'qrcode-terminal';
import QRCode from 'qrcode';
import P from 'pino';
import {
  makeWASocket,
  areJidsSameUser,
  DisconnectReason,
  fetchLatestBaileysVersion,
  isJidGroup,
  useMultiFileAuthState
} from '@whiskeysockets/baileys';
import { google } from 'googleapis';
import {
  DB_SUMMARY_VIEW,
  DB_TABLE,
  APP_SETTINGS_TABLE,
  OUTBOUND_MESSAGES_TABLE,
  PAYABLE_ENTRIES_TABLE,
  PAYABLE_PAYMENTS_TABLE,
  PRODUCTS_TABLE,
  STORES_TABLE,
  createPool,
  ensureDatabase,
  normalizeItemKey
} from './db.js';
import { applyPayment, createPayableEntry, getPayableBalance } from './payables.js';

const REQUIRED_ENV = [
  'GOOGLE_SHEET_ID',
  'GOOGLE_SHEET_NAME',
  'GOOGLE_SERVICE_ACCOUNT_FILE'
];

for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`Missing env: ${key}`);
    process.exit(1);
  }
}

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const TRANSACTIONS_SHEET_NAME =
  process.env.TRANSACTIONS_SHEET_NAME || process.env.GOOGLE_SHEET_NAME;
const SUMMARY_SHEET_NAME = process.env.SUMMARY_SHEET_NAME || 'Summary';
const SHEET_RANGE =
  process.env.GOOGLE_SHEET_RANGE || `${TRANSACTIONS_SHEET_NAME}!A:J`;
const SERVICE_ACCOUNT_FILE = process.env.GOOGLE_SERVICE_ACCOUNT_FILE;
const COMMAND = process.env.BOT_COMMAND || '!sheet';
const ALLOW_GROUPS = process.env.ALLOW_GROUPS === 'true';
const ALLOW_SELF = process.env.ALLOW_SELF === 'true';
const AUTH_DIR = process.env.WHATSAPP_AUTH_DIR || './auth_info';
const AUTH_DIR_PATH = path.resolve(process.cwd(), AUTH_DIR);
const LOG_LEVEL = process.env.LOG_LEVEL || 'info';
const AI_PROVIDER = process.env.AI_PROVIDER || 'heuristic';
const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || '';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-1.5-flash';
const GROQ_API_KEY = process.env.GROQ_API_KEY || '';
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.1-8b-instant';
const ADMIN_WA_NUMBER = String(process.env.ADMIN_WA_NUMBER || '').trim();
const DEFAULT_STORE_SLUG = (process.env.DEFAULT_STORE_SLUG || 'dewi').toLowerCase();
const STORE_CACHE_TTL_MS = Number(process.env.STORE_CACHE_TTL_MS || 60000);
const SETTINGS_CACHE_TTL_MS = Number(process.env.SETTINGS_CACHE_TTL_MS || 15000);
const AI_GROUP_ALLOWLIST_ENV = String(process.env.AI_GROUP_ALLOWLIST || '').trim();
const WA_STATUS_FILE = path.join(AUTH_DIR_PATH, 'wa_status.json');
const WA_RESET_FILE = path.join(AUTH_DIR_PATH, 'wa_reset.json');
const QR_FILE = path.resolve(process.cwd(), 'qr.png');

const COMMAND_ALIASES = {
  sheet: [COMMAND, '!sheet'],
  in: ['!in', '!masuk', '!beli', '!buy'],
  out: ['!out', '!keluar', '!jual', '!sale'],
  damage: ['!damage', '!rusak', '!reject'],
  pay: ['!bayar', '!pay', '!modal'],
  stock: ['!stock', '!stok'],
  help: ['!help', '!format'],
  ai: ['!ai', '!catat'],
  groupid: ['!groupid', '!gid']
};

if (!fs.existsSync(SERVICE_ACCOUNT_FILE)) {
  console.error(`Service account file not found: ${SERVICE_ACCOUNT_FILE}`);
  process.exit(1);
}

const logger = P({ level: LOG_LEVEL });
const dbPool = createPool();
const numberFormat = new Intl.NumberFormat('id-ID');
let outboundInterval = null;
let sockReady = false;
let controlInterval = null;
let activeSock = null;
let forceRelogin = false;
let resetInProgress = false;
const settingsCache = {
  adminWaNumber: ADMIN_WA_NUMBER,
  adminFetchedAt: 0,
  aiGroupAllowlist: [],
  aiGroupFetchedAt: 0
};

async function writeQrPng(qrText) {
  try {
    await QRCode.toFile(QR_FILE, qrText, { width: 360 });
    console.log('QR saved to qr.png');
  } catch (err) {
    logger.warn({ err }, 'Failed to write qr.png');
  }
}

async function clearQrFile() {
  try {
    await fs.promises.unlink(QR_FILE);
  } catch (err) {
    if (err?.code !== 'ENOENT') {
      logger.warn({ err }, 'Failed to remove qr.png');
    }
  }
}

async function writeWaStatus(status, extra = {}) {
  try {
    await fs.promises.mkdir(AUTH_DIR_PATH, { recursive: true });
    const payload = {
      status,
      updated_at: new Date().toISOString(),
      ...extra
    };
    await fs.promises.writeFile(WA_STATUS_FILE, JSON.stringify(payload));
  } catch (err) {
    logger.warn({ err }, 'Failed to write WA status');
  }
}

function extractWaNumber(jid) {
  const raw = String(jid || '');
  if (!raw) return '';
  const withoutDomain = raw.split('@')[0] || raw;
  const withoutDevice = withoutDomain.split(':')[0] || withoutDomain;
  return normalizePhoneNumber(withoutDevice);
}

async function getAdminWaNumber() {
  if (!dbPool) return ADMIN_WA_NUMBER;
  const now = Date.now();
  if (
    settingsCache.adminFetchedAt &&
    now - settingsCache.adminFetchedAt < SETTINGS_CACHE_TTL_MS
  ) {
    return settingsCache.adminWaNumber || ADMIN_WA_NUMBER;
  }

  try {
    const res = await dbPool.query(
      `SELECT value FROM ${APP_SETTINGS_TABLE} WHERE key = $1 LIMIT 1`,
      ['admin_wa_number']
    );
    const value = String(res.rows?.[0]?.value || '').trim();
    settingsCache.adminWaNumber = value || ADMIN_WA_NUMBER || '';
    settingsCache.adminFetchedAt = now;
    return settingsCache.adminWaNumber;
  } catch (err) {
    logger.warn({ err }, 'Failed to read admin WA setting');
    return ADMIN_WA_NUMBER || '';
  }
}

async function getAiGroupAllowlist() {
  if (!dbPool) {
    return parseGroupAllowlist(AI_GROUP_ALLOWLIST_ENV);
  }

  const now = Date.now();
  if (
    settingsCache.aiGroupFetchedAt &&
    now - settingsCache.aiGroupFetchedAt < SETTINGS_CACHE_TTL_MS
  ) {
    return settingsCache.aiGroupAllowlist || [];
  }

  try {
    const res = await dbPool.query(
      `SELECT value FROM ${APP_SETTINGS_TABLE} WHERE key = $1 LIMIT 1`,
      ['ai_group_allowlist']
    );
    const value = String(res.rows?.[0]?.value || '').trim();
    const parsed = parseGroupAllowlist(value);
    settingsCache.aiGroupAllowlist = parsed;
    settingsCache.aiGroupFetchedAt = now;
    return parsed;
  } catch (err) {
    logger.warn({ err }, 'Failed to read AI group allowlist');
    return [];
  }
}

async function checkResetRequest() {
  if (!activeSock || resetInProgress) return;
  let raw = '';
  try {
    raw = await fs.promises.readFile(WA_RESET_FILE, 'utf8');
  } catch (err) {
    if (err?.code !== 'ENOENT') {
      logger.warn({ err }, 'Failed to read WA reset request');
    }
    return;
  }

  let command = null;
  try {
    command = JSON.parse(raw);
  } catch (err) {
    command = null;
  }

  try {
    await fs.promises.unlink(WA_RESET_FILE);
  } catch (err) {
    if (err?.code !== 'ENOENT') {
      logger.warn({ err }, 'Failed to clear WA reset request');
    }
  }

  if (!command || command.action !== 'reset') return;

  resetInProgress = true;
  forceRelogin = true;
  sockReady = false;
  await writeWaStatus('resetting', {
    requested_at: command.requested_at || new Date().toISOString()
  });

  try {
    await fs.promises.rm(AUTH_DIR_PATH, { recursive: true, force: true });
  } catch (err) {
    logger.warn({ err }, 'Failed to clear WA auth data');
  }

  try {
    await activeSock.logout();
  } catch (err) {
    logger.warn({ err }, 'Failed to logout WA session');
  } finally {
    resetInProgress = false;
  }

  setTimeout(() => {
    if (!sockReady) {
      void startSock();
    }
  }, 1500);
}

const auth = new google.auth.GoogleAuth({
  keyFile: SERVICE_ACCOUNT_FILE,
  scopes: ['https://www.googleapis.com/auth/spreadsheets']
});
const sheets = google.sheets({ version: 'v4', auth });

function formatNumber(value) {
  const num = Number(value);
  if (Number.isNaN(num)) return '0';
  return numberFormat.format(num);
}

function formatRupiah(value) {
  return `Rp ${formatNumber(value)}`;
}

function toNumber(value) {
  if (typeof value === 'number') return value;
  const raw = String(value || '').trim();
  if (!raw) return Number.NaN;
  const cleaned = raw.replace(/[^0-9.,-]/g, '');
  if (!cleaned) return Number.NaN;
  const normalized = cleaned
    .replace(/(\d)[.,](?=\d{3}(?:[.,]|$))/g, '$1')
    .replace(',', '.');
  return Number(normalized);
}

function normalizePhoneNumber(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('62')) return digits;
  if (digits.startsWith('0')) return `62${digits.slice(1)}`;
  if (digits.startsWith('8')) return `62${digits}`;
  return digits;
}

function normalizeGroupJid(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  if (raw.includes('@')) return raw;
  if (/^[0-9-]+$/.test(raw)) return `${raw}@g.us`;
  return raw;
}

function parseGroupAllowlist(input) {
  if (!input) return [];
  let rawList = [];

  if (Array.isArray(input)) {
    rawList = input;
  } else if (typeof input === 'string') {
    const trimmed = input.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        rawList = parsed;
      } else {
        rawList = trimmed.split(/[\n,;]/g);
      }
    } catch (err) {
      rawList = trimmed.split(/[\n,;]/g);
    }
  } else {
    rawList = [input];
  }

  const normalized = rawList
    .map((value) => normalizeGroupJid(value))
    .filter(Boolean);
  return Array.from(new Set(normalized));
}

function toWhatsappJid(value) {
  const normalized = normalizePhoneNumber(value);
  if (!normalized) return null;
  return `${normalized}@s.whatsapp.net`;
}

let storeCache = null;
let storeCacheAt = 0;

async function loadStoreCache(force = false) {
  if (!dbPool) return null;
  const now = Date.now();
  if (!force && storeCache && now - storeCacheAt < STORE_CACHE_TTL_MS) {
    return storeCache;
  }

  const res = await dbPool.query(
    `
    SELECT id, name, slug, wa_trigger
    FROM ${STORES_TABLE}
    WHERE is_active = true
    ORDER BY id ASC
    `
  );

  const byTrigger = new Map();
  const bySlug = new Map();
  const byId = new Map();

  for (const row of res.rows || []) {
    const slug = String(row.slug || '').toLowerCase();
    const trigger = String(row.wa_trigger || row.slug || row.name || '')
      .trim()
      .toLowerCase();
    if (trigger) byTrigger.set(trigger, row);
    if (slug) bySlug.set(slug, row);
    byId.set(Number(row.id), row);
  }

  storeCache = { byTrigger, bySlug, byId, rows: res.rows || [] };
  storeCacheAt = now;
  return storeCache;
}

async function getStoreByTrigger(trigger) {
  if (!trigger || !dbPool) return null;
  try {
    const cache = await loadStoreCache();
    const key = String(trigger || '').trim().toLowerCase();
    if (cache?.byTrigger?.has(key)) return cache.byTrigger.get(key);
    if (cache?.bySlug?.has(key)) return cache.bySlug.get(key);
    const refreshed = await loadStoreCache(true);
    if (refreshed?.byTrigger?.has(key)) return refreshed.byTrigger.get(key);
    if (refreshed?.bySlug?.has(key)) return refreshed.bySlug.get(key);
  } catch (err) {
    logger.warn({ err }, 'Failed to load store by trigger');
  }
  return null;
}

async function getDefaultStore() {
  if (!dbPool) return null;
  try {
    const cache = await loadStoreCache();
    if (cache?.bySlug?.has(DEFAULT_STORE_SLUG)) {
      return cache.bySlug.get(DEFAULT_STORE_SLUG);
    }
    return cache?.rows?.[0] || null;
  } catch (err) {
    logger.warn({ err }, 'Failed to load default store');
  }
  return null;
}

async function processOutboundQueue(sock) {
  if (!dbPool || !sockReady) return;

  const adminNumber = await getAdminWaNumber();
  const fallbackJid = toWhatsappJid(adminNumber) || sock?.user?.id || null;
  if (!fallbackJid) return;

  try {
    const result = await dbPool.query(
      `
      SELECT id, target_jid, message, attempts
      FROM ${OUTBOUND_MESSAGES_TABLE}
      WHERE status = 'pending'
      ORDER BY created_at ASC, id ASC
      LIMIT 5
      `
    );

    for (const row of result.rows || []) {
      const target = row.target_jid || fallbackJid;
      try {
        await sock.sendMessage(target, { text: row.message });
        await dbPool.query(
          `
          UPDATE ${OUTBOUND_MESSAGES_TABLE}
          SET status = 'sent',
              sent_at = now(),
              attempts = attempts + 1
          WHERE id = $1
          `,
          [row.id]
        );
      } catch (err) {
        const attempts = Number(row.attempts || 0) + 1;
        const status = attempts >= 3 ? 'failed' : 'pending';
        await dbPool.query(
          `
          UPDATE ${OUTBOUND_MESSAGES_TABLE}
          SET status = $2,
              attempts = attempts + 1,
              last_error = $3
          WHERE id = $1
          `,
          [row.id, status, String(err?.message || err)]
        );
      }
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to process outbound queue');
  }
}

function extractNumbers(text) {
  return text.match(/\d[\d.,]*/g) || [];
}

function resolveCommand(firstWord) {
  const lower = firstWord.toLowerCase();
  for (const [type, aliases] of Object.entries(COMMAND_ALIASES)) {
    if (aliases.map((alias) => alias.toLowerCase()).includes(lower)) {
      return type;
    }
  }
  return null;
}

function parseCsvPayload(payload) {
  const parts = payload
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length < 2) return null;

  const [itemRaw, qtyRaw, priceRaw, sellRaw, ...noteParts] = parts;
  const item = itemRaw.trim();
  const qty = toNumber(qtyRaw);
  if (!item || Number.isNaN(qty)) return null;

  const price = priceRaw ? toNumber(priceRaw) : null;
  const sellPrice = sellRaw ? toNumber(sellRaw) : null;
  const note = noteParts.join(', ');

  return { item, qty, price, sellPrice, note };
}

function findFirstKeyword(text, keywords) {
  let firstIndex = -1;
  for (const keyword of keywords) {
    const regex = new RegExp(`\\b${keyword}\\b`, 'i');
    const match = regex.exec(text);
    if (match) {
      const idx = match.index;
      if (firstIndex === -1 || idx < firstIndex) firstIndex = idx;
    }
  }
  return firstIndex;
}

function inferTypeFromText(payload) {
  const lower = payload.toLowerCase();
  const scrubbed = lower
    .replace(/harga\s*beli\s*[0-9][0-9.,]*/g, ' ')
    .replace(/harga\s*jual\s*[0-9][0-9.,]*/g, ' ')
    .replace(/harga\s*[0-9][0-9.,]*/g, ' ')
    .replace(/harga\s*beli/g, ' ')
    .replace(/harga\s*jual/g, ' ');

  const inKeywords = ['masuk', 'beli', 'purchase', 'buy', 'restock'];
  const outKeywords = ['terjual', 'jual', 'dijual', 'keluar', 'sold', 'sale'];
  const damageKeywords = [
    'rusak',
    'damage',
    'pecah',
    'expired',
    'kadaluarsa',
    'hilang'
  ];

  const inIndex = findFirstKeyword(scrubbed, inKeywords);
  const outIndex = findFirstKeyword(scrubbed, outKeywords);
  const damageIndex = findFirstKeyword(scrubbed, damageKeywords);

  const candidates = [
    { type: 'IN', index: inIndex },
    { type: 'OUT', index: outIndex },
    { type: 'DAMAGE', index: damageIndex }
  ].filter((entry) => entry.index !== -1);

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.index - b.index);
  return candidates[0].type;
}

function parseNaturalLanguage(payload) {
  const trimmed = payload.trim();
  if (!trimmed) return null;

  const type = inferTypeFromText(trimmed);
  if (!type) return null;

  let buyPrice = null;
  let sellPrice = null;
  let genericPrice = null;

  const buyMatch = trimmed.match(/harga\s*beli\s*([0-9][0-9.,]*)/i);
  const sellMatch = trimmed.match(/harga\s*jual\s*([0-9][0-9.,]*)/i);
  if (buyMatch) buyPrice = toNumber(buyMatch[1]);
  if (sellMatch) sellPrice = toNumber(sellMatch[1]);

  const genericMatch = trimmed.match(/harga\s*([0-9][0-9.,]*)/i);
  if (genericMatch) genericPrice = toNumber(genericMatch[1]);

  let payloadForQty = trimmed;
  if (buyMatch) payloadForQty = payloadForQty.replace(buyMatch[0], ' ');
  if (sellMatch) payloadForQty = payloadForQty.replace(sellMatch[0], ' ');
  if (genericMatch && !buyMatch && !sellMatch) {
    payloadForQty = payloadForQty.replace(genericMatch[0], ' ');
  }

  const numbers = extractNumbers(payloadForQty);
  if (numbers.length === 0) return null;

  const qty = toNumber(numbers[0]);
  if (Number.isNaN(qty)) return null;

  let item = trimmed;
  item = item.replace(/harga\s*beli\s*[0-9][0-9.,]*/gi, ' ');
  item = item.replace(/harga\s*jual\s*[0-9][0-9.,]*/gi, ' ');
  item = item.replace(/harga\s*[0-9][0-9.,]*/gi, ' ');
  item = item.replace(/[0-9][0-9.,]*/g, ' ');

  const keywords = [
    'barang',
    'item',
    'produk',
    'terjual',
    'jual',
    'keluar',
    'masuk',
    'beli',
    'rusak',
    'damage',
    'expired',
    'kadaluarsa',
    'pecah',
    'hilang',
    'harga',
    'harga beli',
    'harga jual',
    'rp',
    'rupiah',
    'pcs',
    'pc',
    'unit',
    'buah',
    'qty',
    'jumlah',
    'seharga',
    'dengan',
    'per'
  ];

  for (const word of keywords) {
    item = item.replace(new RegExp(`\\b${word}\\b`, 'gi'), ' ');
  }

  item = item.replace(/[^a-zA-Z0-9\s._-]/g, ' ');
  item = item.replace(/\s+/g, ' ').trim();
  if (!item) return null;

  return {
    type,
    item,
    qty,
    buyPrice,
    sellPrice,
    price: genericPrice,
    note: trimmed
  };
}

function normalizeAiResult(parsed) {
  if (!parsed || typeof parsed !== 'object') return null;
  const type = String(parsed.type || parsed.action || '').toUpperCase();
  if (!['IN', 'OUT', 'DAMAGE'].includes(type)) return null;

  const item = String(parsed.item || parsed.barang || '').trim();
  const qty = toNumber(parsed.qty ?? parsed.jumlah ?? parsed.quantity);
  if (!item || Number.isNaN(qty)) return null;

  const rawBuy =
    parsed.buy_price ?? parsed.buyPrice ?? parsed.harga_beli ?? parsed.hargaBeli;
  const rawSell =
    parsed.sell_price ?? parsed.sellPrice ?? parsed.harga_jual ?? parsed.hargaJual;
  const rawPrice = parsed.price ?? parsed.harga;

  const buyPrice = rawBuy != null ? toNumber(rawBuy) : null;
  const sellPrice = rawSell != null ? toNumber(rawSell) : null;
  const price = rawPrice != null ? toNumber(rawPrice) : null;

  const note = parsed.note ? String(parsed.note) : '';
  return { type, item, qty, buyPrice, sellPrice, price, note };
}

function buildParserPrompt(payload) {
  return [
    'Anda parser transaksi keluar/masuk barang.',
    'Output JSON dengan schema:',
    '{"type":"IN|OUT|DAMAGE","item":"nama","qty":angka,"buy_price":angka|null,"sell_price":angka|null,"note":""}',
    'Gunakan type DAMAGE untuk barang rusak/kadaluarsa/hilang.',
    'Jika tidak jelas, output JSON dengan type kosong.',
    'Hanya output JSON tanpa teks lain.',
    `Kalimat: ${payload}`
  ].join('\n');
}

async function parseWithGemini(payload) {
  if (AI_PROVIDER !== 'gemini' || !GEMINI_API_KEY) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  const prompt = buildParserPrompt(payload);
  const model = GEMINI_MODEL || 'gemini-1.5-flash';

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
        model
      )}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 200 }
        }),
        signal: controller.signal
      }
    );

    if (!res.ok) {
      throw new Error(`Gemini HTTP ${res.status}`);
    }

    const data = await res.json();
    const parts = data.candidates?.[0]?.content?.parts || [];
    const responseText = parts.map((part) => part.text || '').join(' ').trim();
    if (!responseText) return null;

    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]);
    return normalizeAiResult(parsed);
  } catch (err) {
    logger.warn({ err }, 'Gemini parse failed, fallback to heuristic');
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function parseWithGroq(payload) {
  if (AI_PROVIDER !== 'groq' || !GROQ_API_KEY) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  const prompt = buildParserPrompt(payload);
  const model = GROQ_MODEL || 'llama-3.1-8b-instant';

  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
        max_tokens: 200
      }),
      signal: controller.signal
    });

    if (!res.ok) {
      throw new Error(`Groq HTTP ${res.status}`);
    }

    const data = await res.json();
    const responseText = String(data.choices?.[0]?.message?.content || '').trim();
    if (!responseText) return null;

    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]);
    return normalizeAiResult(parsed);
  } catch (err) {
    logger.warn({ err }, 'Groq parse failed, fallback to heuristic');
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function parseWithOllama(payload) {
  if (AI_PROVIDER !== 'ollama' || !OLLAMA_MODEL) return null;

  const prompt = buildParserPrompt(payload);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch(`${OLLAMA_HOST}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: OLLAMA_MODEL, prompt, stream: false }),
      signal: controller.signal
    });

    if (!res.ok) {
      throw new Error(`Ollama HTTP ${res.status}`);
    }

    const data = await res.json();
    const responseText = String(data.response || '').trim();
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]);
    return normalizeAiResult(parsed);
  } catch (err) {
    logger.warn({ err }, 'AI parse failed, fallback to heuristic');
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function parseAiPayload(payload) {
  let fromAi = null;

  if (AI_PROVIDER === 'gemini') {
    fromAi = await parseWithGemini(payload);
  } else if (AI_PROVIDER === 'groq') {
    fromAi = await parseWithGroq(payload);
  } else if (AI_PROVIDER === 'ollama') {
    fromAi = await parseWithOllama(payload);
  }

  if (fromAi) return fromAi;
  return parseNaturalLanguage(payload);
}

function parseFlexiblePayload(payload) {
  return parseCsvPayload(payload) || parseNaturalLanguage(payload);
}

function parsePaymentPayload(payload) {
  const numbers = extractNumbers(payload);
  if (numbers.length === 0) return null;
  const amount = toNumber(numbers[0]);
  if (Number.isNaN(amount) || amount <= 0) return null;

  const note = payload
    .replace(numbers[0], ' ')
    .replace(/bayar/gi, ' ')
    .replace(/modal/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return { amount, note };
}

function resolveTransaction(parsed, typeHint) {
  if (!parsed) return null;
  const type = String(typeHint || parsed.type || '').toUpperCase();
  if (!['IN', 'OUT', 'DAMAGE'].includes(type)) return null;

  const item = String(parsed.item || '').trim();
  const qty = toNumber(parsed.qty);
  if (!item || Number.isNaN(qty)) return null;

  const genericPrice = parsed.price != null ? toNumber(parsed.price) : null;
  const rawBuy = parsed.buyPrice != null ? toNumber(parsed.buyPrice) : null;
  const rawSell = parsed.sellPrice != null ? toNumber(parsed.sellPrice) : null;

  let buyPrice = !Number.isNaN(rawBuy) ? rawBuy : null;
  let sellPrice = !Number.isNaN(rawSell) ? rawSell : null;

  if (genericPrice != null && !Number.isNaN(genericPrice)) {
    if (type === 'IN' && buyPrice == null) buyPrice = genericPrice;
    if (type === 'OUT' && sellPrice == null) sellPrice = genericPrice;
  }

  return {
    type,
    item,
    qty,
    buyPrice,
    sellPrice,
    note: parsed.note
  };
}

async function getLastBuyPrice(item, storeId) {
  if (!dbPool) return null;

  try {
    const nameKey = normalizeItemKey(item);
    if (nameKey) {
      const productRes = await dbPool.query(
        `
        SELECT default_buy_price, last_buy_price
        FROM ${PRODUCTS_TABLE}
        WHERE name_key = $1 AND ($2::bigint IS NULL OR store_id = $2)
        `,
        [nameKey, storeId || null]
      );
      const lastBuy = toNumber(productRes.rows?.[0]?.last_buy_price);
      if (!Number.isNaN(lastBuy) && lastBuy > 0) return lastBuy;
      const defaultBuy = toNumber(productRes.rows?.[0]?.default_buy_price);
      if (!Number.isNaN(defaultBuy) && defaultBuy > 0) return defaultBuy;
    }

    const res = await dbPool.query(
      `
      SELECT buy_price
      FROM ${DB_TABLE}
      WHERE LOWER(REGEXP_REPLACE(TRIM(item), '\\s+', ' ', 'g')) = $1
        AND buy_price IS NOT NULL
        AND ($2::bigint IS NULL OR store_id = $2)
      ORDER BY id DESC
      LIMIT 1
      `,
      [normalizeItemKey(item), storeId || null]
    );
    const value = res.rows?.[0]?.buy_price;
    const buyPrice = toNumber(value);
    if (!Number.isNaN(buyPrice) && buyPrice > 0) return buyPrice;
  } catch (err) {
    logger.warn({ err }, 'Failed to read buy price from DB');
  }

  return null;
}

async function getLastSellPrice(item, storeId) {
  if (dbPool) {
    try {
      const nameKey = normalizeItemKey(item);
      if (nameKey) {
        const productRes = await dbPool.query(
          `
          SELECT default_sell_price, last_sell_price
          FROM ${PRODUCTS_TABLE}
          WHERE name_key = $1 AND ($2::bigint IS NULL OR store_id = $2)
          `,
          [nameKey, storeId || null]
        );
        const defaultSell = toNumber(productRes.rows?.[0]?.default_sell_price);
        if (!Number.isNaN(defaultSell) && defaultSell > 0) return defaultSell;
        const lastSell = toNumber(productRes.rows?.[0]?.last_sell_price);
        if (!Number.isNaN(lastSell) && lastSell > 0) return lastSell;
      }

      const res = await dbPool.query(
        `
        SELECT sell_price
        FROM ${DB_TABLE}
        WHERE LOWER(REGEXP_REPLACE(TRIM(item), '\\s+', ' ', 'g')) = $1
          AND sell_price IS NOT NULL
          AND ($2::bigint IS NULL OR store_id = $2)
        ORDER BY id DESC
        LIMIT 1
        `,
        [nameKey, storeId || null]
      );
      const value = res.rows?.[0]?.sell_price;
      const sellPrice = toNumber(value);
      if (!Number.isNaN(sellPrice) && sellPrice > 0) return sellPrice;
    } catch (err) {
      logger.warn({ err }, 'Failed to read sell price from DB, fallback to sheet');
    }
  }

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${TRANSACTIONS_SHEET_NAME}!C2:J`
  });

  const rows = res.data.values || [];
  const target = item.trim().toLowerCase();

  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const row = rows[i];
    const rowItem = String(row?.[0] || '').trim().toLowerCase();
    if (rowItem !== target) continue;

    const sellPrice = toNumber(row?.[7]);
    if (!Number.isNaN(sellPrice) && sellPrice > 0) return sellPrice;
  }

  return null;
}

async function saveTransactionFromParsed(parsed, typeHint, sender, raw, storeId) {
  const resolved = resolveTransaction(parsed, typeHint);
  if (!resolved) return { error: 'invalid' };

  if (resolved.type === 'IN') {
    if (resolved.buyPrice == null || Number.isNaN(resolved.buyPrice)) {
      return { error: 'missing_buy', item: resolved.item };
    }

    const unitPrice = resolved.buyPrice;
    const costPrice = resolved.buyPrice;
    const costTotal = resolved.qty * costPrice;
    const { total } = await appendTransaction({
      type: resolved.type,
      item: resolved.item,
      qty: resolved.qty,
      unitPrice,
      buyPrice: resolved.buyPrice,
      sellPrice: resolved.sellPrice,
      costPrice,
      costTotal,
      note: resolved.note,
      sender,
      raw,
      storeId
    });

    return { ...resolved, unitPrice, total, usedFallback: false };
  }

  if (resolved.type === 'DAMAGE') {
    const unitPrice = 0;
    const { total } = await appendTransaction({
      type: resolved.type,
      item: resolved.item,
      qty: resolved.qty,
      unitPrice,
      buyPrice: null,
      sellPrice: null,
      costPrice: null,
      costTotal: null,
      note: resolved.note,
      sender,
      raw,
      storeId
    });

    return { ...resolved, unitPrice, total, usedFallback: false };
  }

  let sellPrice = resolved.sellPrice;
  let usedFallback = false;
  if (sellPrice == null || Number.isNaN(sellPrice)) {
    sellPrice = await getLastSellPrice(resolved.item, storeId);
    usedFallback = true;
  }

  if (sellPrice == null || Number.isNaN(sellPrice)) {
    return { error: 'missing_sell', item: resolved.item };
  }

  let costPrice = null;
  if (dbPool) {
    costPrice = await getLastBuyPrice(resolved.item, storeId);
    if (costPrice == null || Number.isNaN(costPrice)) {
      return { error: 'missing_cost', item: resolved.item };
    }
  }

  const unitPrice = sellPrice;
  const costTotal =
    costPrice != null && !Number.isNaN(costPrice)
      ? resolved.qty * costPrice
      : null;
  const { total } = await appendTransaction({
    type: resolved.type,
    item: resolved.item,
    qty: resolved.qty,
    unitPrice,
    buyPrice: null,
    sellPrice,
    costPrice,
    costTotal,
    note: resolved.note,
    sender,
    raw,
    storeId
  });

  return {
    ...resolved,
    sellPrice,
    unitPrice,
    total,
    usedFallback,
    costPrice
  };
}

function formatSection(title, lines) {
  const filtered = (lines || [])
    .map((line) => (line == null ? '' : String(line)).trim())
    .filter(Boolean);
  if (filtered.length === 0) return title;
  return [title, ...filtered.map((line) => `- ${line}`)].join('\n');
}

function joinSections(sections) {
  return (sections || []).filter(Boolean).join('\n\n');
}

function buildTransactionReply(result) {
  if (!result) return '';
  if (result.type === 'IN') {
    const lines = [
      `Item: ${result.item}`,
      `Qty: ${formatNumber(result.qty)}`,
      `Harga beli: ${formatRupiah(result.buyPrice)}`
    ];
    if (result.sellPrice != null) {
      lines.push(`Harga jual: ${formatRupiah(result.sellPrice)}`);
    }
    lines.push(`Total: ${formatRupiah(result.total)}`);
    return formatSection('OK MASUK', lines);
  }
  if (result.type === 'DAMAGE') {
    return formatSection('OK RUSAK', [
      `Item: ${result.item}`,
      `Qty: ${formatNumber(result.qty)}`,
      'Status: Modal tidak ditagihkan'
    ]);
  }

  const label = result.usedFallback ? 'Harga jual (default)' : 'Harga jual';
  return formatSection('OK KELUAR', [
    `Item: ${result.item}`,
    `Qty: ${formatNumber(result.qty)}`,
    `${label}: ${formatRupiah(result.sellPrice)}`,
    `Total: ${formatRupiah(result.total)}`
  ]);
}

function buildStockReply(item, summary) {
  return formatSection('RINGKASAN STOK', [
    `Item: ${item}`,
    `Masuk: ${formatNumber(summary.inQty)}`,
    `Keluar: ${formatNumber(summary.outQty)}`,
    `Stok: ${formatNumber(summary.stock)}`,
    `Penjualan: ${formatRupiah(summary.revenue)}`,
    `Pembelian: ${formatRupiah(summary.cost)}`,
    `Profit: ${formatRupiah(summary.profit)}`
  ]);
}

function buildPaymentReply(payment, result, balanceValue) {
  const appliedAmount = payment.amount - (result?.remaining || 0);
  const summaryLines = [
    `Nominal: ${formatRupiah(payment.amount)}`,
    `Terpakai: ${formatRupiah(appliedAmount)}`
  ];

  if ((result?.remaining || 0) > 0) {
    summaryLines.push(`Sisa jadi kredit: ${formatRupiah(result.remaining)}`);
  }

  if (balanceValue < 0) {
    summaryLines.push(`Sisa utang: ${formatRupiah(Math.abs(balanceValue))}`);
  } else if (balanceValue > 0) {
    summaryLines.push(`Saldo kredit: ${formatRupiah(balanceValue)}`);
  } else {
    summaryLines.push('Status: Utang modal sudah lunas');
  }

  const allocations = result?.allocations || [];
  const allocationLines = [];
  if (allocations.length > 0) {
    const maxLines = 10;
    const shown = allocations.slice(0, maxLines);
    for (const entry of shown) {
      const qtyPaid = entry.costPrice > 0 ? entry.amount / entry.costPrice : 0;
      allocationLines.push(
        `${entry.item} x${formatNumber(qtyPaid)} @ ${formatRupiah(
          entry.costPrice
        )} = ${formatRupiah(entry.amount)}`
      );
    }
    if (allocations.length > maxLines) {
      allocationLines.push(`... dan ${allocations.length - maxLines} item lagi`);
    }
  } else {
    allocationLines.push('Tidak ada utang, semua jadi kredit.');
  }

  return joinSections([
    formatSection('OK BAYAR MODAL', summaryLines),
    formatSection('RINCIAN ALOKASI', allocationLines)
  ]);
}

function buildMissingPriceReply(error, exampleTrigger, item) {
  if (error === 'missing_buy') {
    return formatSection('DATA BELUM LENGKAP', [
      'Harga beli belum ada.',
      `Contoh: ${exampleTrigger} tissu masuk 10 buah harga beli 2000 harga jual 3000`
    ]);
  }
  if (error === 'missing_sell') {
    return formatSection('DATA BELUM LENGKAP', [
      `Harga jual untuk ${item} belum ada.`,
      `Contoh: ${exampleTrigger} ${item} masuk 10 harga beli 2000 harga jual 3000`
    ]);
  }
  if (error === 'missing_cost') {
    return formatSection('DATA BELUM LENGKAP', [
      `Harga beli untuk ${item} belum ada.`,
      `Contoh: ${exampleTrigger} ${item} masuk 10 harga beli 2000 harga jual 3000`
    ]);
  }
  return '';
}

function helpText() {
  const triggerLabels = getStoreTriggerLabels().map(formatTriggerLabel);
  const triggerHint =
    triggerLabels.length > 0
      ? `Trigger tersedia: ${triggerLabels.join(', ')}`
      : 'Trigger tersedia: Dewi, Dina';
  const primaryTrigger = triggerLabels[0] || 'Dewi';
  const secondaryTrigger =
    triggerLabels[1] && triggerLabels[1] !== primaryTrigger ? triggerLabels[1] : null;

  const storeFormatLines = [
    `${primaryTrigger} barang masuk qty harga beli X harga jual Y`,
    `${primaryTrigger} barang terjual qty`,
    `${primaryTrigger} barang rusak qty`,
    `${primaryTrigger} bayar modal 50000`
  ];
  if (secondaryTrigger) {
    storeFormatLines.push(
      `${secondaryTrigger} barang masuk qty harga beli X harga jual Y`,
      `${secondaryTrigger} barang terjual qty`,
      `${secondaryTrigger} barang rusak qty`,
      `${secondaryTrigger} bayar modal 50000`
    );
  }

  return joinSections([
    formatSection('FORMAT PERINTAH', [
      '!in barang, qty, harga_beli[, harga_jual, catatan]',
      '!out barang, qty[, harga_jual, catatan]',
      '!damage barang, qty',
      '!stock barang',
      'bayar modal 50000',
      'admin: !groupid (khusus grup)'
    ]),
    formatSection('MODE TRIGGER TOKO', [triggerHint, ...storeFormatLines]),
    formatSection('CONTOH', [
      '!in Beras 5kg, 2, 60000',
      '!in Beras 5kg, 2, 60000, 75000',
      '!out Beras 5kg, 1',
      '!damage Beras 5kg, 1',
      'bayar modal 50000',
      `${primaryTrigger} tissu masuk 10 buah harga beli 2000 harga jual 3000`,
      `${primaryTrigger} tissu terjual 1`,
      `${primaryTrigger} tissu rusak 1`,
      secondaryTrigger
        ? `${secondaryTrigger} pupuk masuk 5 karung harga beli 10000 harga jual 15000`
        : null,
      secondaryTrigger ? `${secondaryTrigger} pupuk terjual 1` : null
    ])
  ]);
}

function formatTriggerLabel(label) {
  const text = String(label || '').trim();
  if (!text) return '';
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function getStoreTriggerLabels() {
  const labels = [];
  for (const store of storeCache?.rows || []) {
    const label = String(store.wa_trigger || store.slug || store.name || '').trim();
    if (label) labels.push(label);
  }
  if (labels.length === 0) {
    labels.push(DEFAULT_STORE_SLUG || 'dewi');
  }
  const unique = [];
  const seen = new Set();
  for (const label of labels) {
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(label);
  }
  return unique;
}

function getExampleTriggerLabel() {
  const labels = getStoreTriggerLabels();
  return formatTriggerLabel(labels[0] || 'Dewi');
}

async function getOrCreateProduct(item, buyPrice, sellPrice, storeId) {
  if (!dbPool) return { id: null, nameKey: null };

  const name = String(item || '').trim();
  const nameKey = normalizeItemKey(name);
  if (!name || !nameKey) return { id: null, nameKey: null };

  let resolvedStoreId = storeId;
  if (!resolvedStoreId) {
    const store = await getDefaultStore();
    resolvedStoreId = store?.id || null;
  }

  if (!resolvedStoreId) {
    return { id: null, nameKey: null };
  }

  try {
    const res = await dbPool.query(
      `
        INSERT INTO ${PRODUCTS_TABLE}
          (name, name_key, store_id, default_buy_price, default_sell_price, last_buy_price, last_sell_price, payable_mode, is_active, updated_at)
        VALUES ($1,$2,$3,$4,$5,$4,$5,'credit',true,now())
        ON CONFLICT (store_id, name_key) DO UPDATE
        SET name = EXCLUDED.name,
            default_buy_price = CASE
              WHEN EXCLUDED.default_buy_price IS NULL THEN ${PRODUCTS_TABLE}.default_buy_price
              ELSE EXCLUDED.default_buy_price
            END,
            default_sell_price = CASE
              WHEN EXCLUDED.default_sell_price IS NULL THEN ${PRODUCTS_TABLE}.default_sell_price
              ELSE EXCLUDED.default_sell_price
            END,
            last_buy_price = CASE
              WHEN EXCLUDED.last_buy_price IS NULL THEN ${PRODUCTS_TABLE}.last_buy_price
              ELSE EXCLUDED.last_buy_price
            END,
            last_sell_price = CASE
              WHEN EXCLUDED.last_sell_price IS NULL THEN ${PRODUCTS_TABLE}.last_sell_price
              ELSE EXCLUDED.last_sell_price
            END,
            is_active = true,
            updated_at = now()
        RETURNING id, default_sell_price, last_sell_price, payable_mode, store_id
      `,
      [name, nameKey, resolvedStoreId, buyPrice ?? null, sellPrice ?? null]
    );

    const row = res.rows?.[0] || {};
    return {
      id: row.id ?? null,
      nameKey,
      defaultSellPrice: toNumber(row.default_sell_price),
      lastSellPrice: toNumber(row.last_sell_price),
      payableMode: String(row.payable_mode || 'credit'),
      storeId: row.store_id ?? resolvedStoreId
    };
  } catch (err) {
    logger.warn({ err }, 'Failed to upsert product');
    return { id: null, nameKey };
  }
}

async function insertTransactionDb({
  type,
  productId,
  storeId,
  item,
  qty,
  unitPrice,
  total,
  buyPrice,
  sellPrice,
  costPrice,
  costTotal,
  note,
  sender,
  raw
}) {
  if (!dbPool) return;

  const res = await dbPool.query(
    `
      INSERT INTO ${DB_TABLE}
        (type, product_id, store_id, item, qty, unit_price, total, buy_price, sell_price, cost_price, cost_total, note, sender, raw)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      RETURNING id
    `,
    [
      type,
      productId,
      storeId ?? null,
      item,
      qty,
      unitPrice,
      total,
      buyPrice,
      sellPrice,
      costPrice,
      costTotal,
      note,
      sender,
      raw
    ]
  );

  return res.rows?.[0]?.id ?? null;
}

async function appendRow(values) {
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: SHEET_RANGE,
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [values]
    }
  });
}

async function ensureSheetTabs() {
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: SHEET_ID
  });

  const existing = new Set(
    (meta.data.sheets || []).map((sheet) => sheet.properties?.title)
  );

  const requests = [];
  if (!existing.has(TRANSACTIONS_SHEET_NAME)) {
    requests.push({
      addSheet: { properties: { title: TRANSACTIONS_SHEET_NAME } }
    });
  }

  if (!existing.has(SUMMARY_SHEET_NAME)) {
    requests.push({
      addSheet: { properties: { title: SUMMARY_SHEET_NAME } }
    });
  }

  if (requests.length === 0) return;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: { requests }
  });
}

async function ensureTransactionsHeader() {
  const header = [
    'Timestamp',
    'Type',
    'Item',
    'Qty',
    'UnitPrice',
    'Total',
    'Note',
    'Sender',
    'Raw',
    'SellPrice'
  ];

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${TRANSACTIONS_SHEET_NAME}!A1:J1`
  });

  const existing = res.data.values?.[0] || [];
  const hasSellPrice = existing.some(
    (value) => String(value).toLowerCase() === 'sellprice'
  );
  if (existing.length > 0 && hasSellPrice) return;

  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${TRANSACTIONS_SHEET_NAME}!A1:J1`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [header] }
  });
}

async function ensureSummaryLayout() {
  const header = ['Item', 'StockIn', 'StockOut', 'Stock', 'Revenue', 'Cost', 'Profit'];
  const formulas = [
    `=IFERROR(SORT(UNIQUE(FILTER(${TRANSACTIONS_SHEET_NAME}!C2:C; LEN(${TRANSACTIONS_SHEET_NAME}!C2:C))));\"\")`,
    `=ARRAYFORMULA(IF(A2:A=\"\";;SUMIFS(${TRANSACTIONS_SHEET_NAME}!D:D;${TRANSACTIONS_SHEET_NAME}!B:B;\"IN\";${TRANSACTIONS_SHEET_NAME}!C:C;A2:A)))`,
    `=ARRAYFORMULA(IF(A2:A=\"\";;SUMIFS(${TRANSACTIONS_SHEET_NAME}!D:D;${TRANSACTIONS_SHEET_NAME}!B:B;\"OUT\";${TRANSACTIONS_SHEET_NAME}!C:C;A2:A)+SUMIFS(${TRANSACTIONS_SHEET_NAME}!D:D;${TRANSACTIONS_SHEET_NAME}!B:B;\"DAMAGE\";${TRANSACTIONS_SHEET_NAME}!C:C;A2:A)))`,
    `=ARRAYFORMULA(IF(A2:A=\"\";;B2:B-C2:C))`,
    `=ARRAYFORMULA(IF(A2:A=\"\";;SUMIFS(${TRANSACTIONS_SHEET_NAME}!F:F;${TRANSACTIONS_SHEET_NAME}!B:B;\"OUT\";${TRANSACTIONS_SHEET_NAME}!C:C;A2:A)))`,
    `=ARRAYFORMULA(IF(A2:A=\"\";;SUMIFS(${TRANSACTIONS_SHEET_NAME}!F:F;${TRANSACTIONS_SHEET_NAME}!B:B;\"IN\";${TRANSACTIONS_SHEET_NAME}!C:C;A2:A)))`,
    `=ARRAYFORMULA(IF(A2:A=\"\";;E2:E-F2:F))`
  ];

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${SUMMARY_SHEET_NAME}!A1:G2`
  });

  const existingHeader = res.data.values?.[0] || [];
  const existingFormulas = res.data.values?.[1] || [];

  const hasError = existingFormulas.some((cell) => {
    const text = String(cell);
    return text.includes('#ERROR') || text.includes('#N/A');
  });
  const needsDamage =
    !String(existingFormulas[2] || '').toUpperCase().includes('DAMAGE');
  if (
    existingHeader.length > 0 &&
    existingFormulas.length > 0 &&
    !hasError &&
    !needsDamage
  )
    return;

  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${SUMMARY_SHEET_NAME}!A1:G2`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [header, formulas] }
  });
}

async function ensureSheetLayout() {
  await ensureSheetTabs();
  await ensureTransactionsHeader();
  await ensureSummaryLayout();
}

async function appendTransaction({
  type,
  item,
  qty,
  unitPrice,
  buyPrice,
  sellPrice,
  costPrice,
  costTotal,
  note,
  sender,
  raw,
  storeId
}) {
  const total = qty * unitPrice;
  const timestamp = new Date().toISOString();

  const product = await getOrCreateProduct(item, buyPrice, sellPrice, storeId);
  const row = [
    timestamp,
    type,
    item,
    qty,
    unitPrice,
    total,
    note || '',
    sender || '',
    raw || '',
    sellPrice ?? ''
  ];

  const transactionId = await insertTransactionDb({
    type,
    productId: product.id,
    storeId: product.storeId ?? storeId ?? null,
    item,
    qty,
    unitPrice,
    total,
    buyPrice,
    sellPrice,
    costPrice,
    costTotal,
    note: note || '',
    sender: sender || '',
    raw: raw || ''
  });

  if (
    dbPool &&
    transactionId &&
    type === 'OUT' &&
    costPrice != null &&
    costTotal != null &&
    !Number.isNaN(costPrice) &&
    !Number.isNaN(costTotal) &&
    String(product.payableMode || 'credit') !== 'cash'
  ) {
    try {
      await createPayableEntry(dbPool, {
        transactionId,
        productId: product.id,
        item,
        qty,
        costPrice,
        amount: costTotal,
        storeId: product.storeId ?? storeId ?? null
      });
    } catch (err) {
      logger.warn({ err }, 'Failed to create payable entry');
    }
  }

  await appendRow(row);
  return { total };
}

async function getSummaryRow(item, storeId) {
  if (dbPool) {
    try {
      const nameKey = normalizeItemKey(item);
      const res = await dbPool.query(
        `
          SELECT item, stock_in, stock_out, stock, revenue, cost, profit
          FROM ${DB_SUMMARY_VIEW}
          WHERE name_key = $1
            AND ($2::bigint IS NULL OR store_id = $2)
          LIMIT 1
        `,
        [nameKey, storeId || null]
      );

      const row = res.rows?.[0];
      if (row) {
        return [
          row.item,
          row.stock_in,
          row.stock_out,
          row.stock,
          row.revenue,
          row.cost,
          row.profit
        ];
      }
    } catch (err) {
      logger.warn({ err }, 'Failed to read summary from DB, fallback to sheet');
    }
  }

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${SUMMARY_SHEET_NAME}!A:G`
  });

  const rows = res.data.values || [];
  const target = item.toLowerCase();
  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i];
    const name = String(row[0] || '').toLowerCase();
    if (name === target) return row;
  }

  return null;
}

function unwrapMessage(message) {
  return (
    message?.ephemeralMessage?.message ||
    message?.viewOnceMessage?.message ||
    message
  );
}

function getMessageText(message) {
  const content = unwrapMessage(message?.message);
  if (!content) return '';
  return (
    content.conversation ||
    content.extendedTextMessage?.text ||
    content.imageMessage?.caption ||
    content.videoMessage?.caption ||
    ''
  );
}

function getSenderId(msg) {
  const jid = msg.key.participant || msg.key.remoteJid || '';
  return jid.split('@')[0];
}

function getSenderJid(msg) {
  return msg.key.participant || msg.key.remoteJid || '';
}

function getSenderWaNumber(msg) {
  const jid = getSenderJid(msg);
  return extractWaNumber(jid);
}

async function startSock() {
  await ensureDatabase(dbPool);
  await ensureSheetLayout();
  await writeWaStatus('starting');

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR_PATH);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    logger,
    printQRInTerminal: false
  });
  activeSock = sock;

  if (!controlInterval) {
    controlInterval = setInterval(() => {
      void checkResetRequest();
    }, 4000);
  }

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      qrcodeTerminal.generate(qr, { small: true });
      void writeQrPng(qr);
      await writeWaStatus('qr');
    }

    if (connection === 'open') {
      console.log('WhatsApp connected');
      sockReady = true;
      if (outboundInterval) clearInterval(outboundInterval);
      outboundInterval = setInterval(() => {
        void processOutboundQueue(sock);
      }, 5000);

      const jid = sock?.user?.id || null;
      const waNumber = extractWaNumber(jid);
      await writeWaStatus('connected', {
        jid,
        wa_number: waNumber || null
      });
      await clearQrFile();
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const isLoggedOut = statusCode === DisconnectReason.loggedOut;
      if (isLoggedOut) {
        forceRelogin = true;
      }
      const shouldReconnect = forceRelogin || !isLoggedOut;
      console.log(`Connection closed. Reconnect: ${shouldReconnect}`);
      sockReady = false;
      if (outboundInterval) {
        clearInterval(outboundInterval);
        outboundInterval = null;
      }

      if (forceRelogin) {
        forceRelogin = false;
        try {
          await fs.promises.rm(AUTH_DIR_PATH, { recursive: true, force: true });
        } catch (err) {
          logger.warn({ err }, 'Failed to clear WA auth data');
        }
      }

      await writeWaStatus(isLoggedOut ? 'logged_out' : 'disconnected', {
        reason: statusCode || null
      });

      if (shouldReconnect) startSock();
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    const msg = messages[0];
    if (!msg || !msg.message) return;

    const remoteJid = msg.key.remoteJid;
    if (!remoteJid || remoteJid === 'status@broadcast') return;
    const isGroup = isJidGroup(remoteJid);

    const text = getMessageText(msg);
    if (!text) return;

    const trimmed = text.trim();
    if (!trimmed) return;

    const isGroupIdCommand = /^!(groupid|gid)\b/i.test(trimmed);

    if (msg.key.fromMe) {
      if (!ALLOW_SELF) return;
      const selfJid = sock?.user?.id;
      const isSelfChat = selfJid && areJidsSameUser(remoteJid, selfJid);
      if (!isSelfChat && !(isGroup && isGroupIdCommand)) return;
    }

    if (!ALLOW_GROUPS && isGroup && !isGroupIdCommand) return;

    let commandType = null;
    let firstWord = '';
    let payload = '';
    let workingText = trimmed;

    let storeContext = null;
    const potentialStore = workingText.split(/\s+/)[0];
    const storeCandidate = await getStoreByTrigger(potentialStore);
    if (storeCandidate) {
      storeContext = storeCandidate;
      workingText = workingText.slice(potentialStore.length).trim();
      if (!workingText) {
        await sock.sendMessage(remoteJid, { text: helpText() }, { quoted: msg });
        return;
      }
    }

    if (/^bayar\s+modal(?:$|[\s:,-])/i.test(workingText)) {
      commandType = 'pay';
      const match = workingText.match(/^bayar\s+modal/i);
      payload = workingText.slice(match?.[0]?.length || 0).trim();
      payload = payload.replace(/^[:,-]\s*/, '');
    } else if (/^ai(?:$|[\s:,-])/i.test(workingText)) {
      commandType = 'ai';
      firstWord = workingText.split(/\s+/)[0];
      payload = workingText.slice(firstWord.length).trim();
      payload = payload.replace(/^[:,-]\s*/, '');
    } else if (workingText.startsWith('!')) {
      firstWord = workingText.split(/\s+/)[0];
      commandType = resolveCommand(firstWord);
      if (!commandType) return;
      payload = workingText.slice(firstWord.length).trim();
    } else if (storeContext) {
      commandType = 'ai';
      payload = workingText;
    } else {
      return;
    }

    if (!storeContext) {
      storeContext = await getDefaultStore();
    }

    const exampleTrigger = formatTriggerLabel(
      storeContext?.wa_trigger ||
        storeContext?.slug ||
        storeContext?.name ||
        getExampleTriggerLabel()
    );
    const payloadLower = payload.toLowerCase();

    if (
      commandType === 'help' ||
      payloadLower === 'help' ||
      payloadLower === 'format' ||
      payloadLower === '?'
    ) {
      await sock.sendMessage(remoteJid, { text: helpText() }, { quoted: msg });
      return;
    }

    try {
      if (commandType === 'groupid') {
        if (!isGroup) {
          await sock.sendMessage(
            remoteJid,
            { text: formatSection('INFO', ['Perintah ini hanya bisa dipakai di grup.']) },
            { quoted: msg }
          );
          return;
        }

          const adminNumber = await getAdminWaNumber();
          const senderNumber = msg.key.fromMe
            ? extractWaNumber(sock?.user?.id)
            : getSenderWaNumber(msg);
          if (adminNumber && senderNumber !== normalizePhoneNumber(adminNumber)) {
            await sock.sendMessage(
              remoteJid,
              { text: formatSection('AKSES DITOLAK', ['Perintah ini khusus admin.']) },
              { quoted: msg }
            );
          return;
        }

        const groupId = normalizeGroupJid(remoteJid);
        await sock.sendMessage(
          remoteJid,
          { text: formatSection('ID GRUP', [`${groupId}`]) },
          { quoted: msg }
        );
        return;
      }

      if (commandType === 'ai') {
        const allowlist = await getAiGroupAllowlist();
        if (allowlist.length > 0) {
          const groupId = normalizeGroupJid(remoteJid);
          if (isGroup) {
            if (!allowlist.includes(groupId)) {
              return;
            }
          } else {
            return;
          }
        }
      }

      if (commandType === 'stock') {
        if (!payload) {
          await sock.sendMessage(remoteJid, { text: helpText() }, { quoted: msg });
          return;
        }

        const item = payload.trim();
        const row = await getSummaryRow(item, storeContext?.id);
        if (!row) {
          await sock.sendMessage(
            remoteJid,
            {
              text: formatSection('DATA TIDAK DITEMUKAN', [`Item: ${item}`])
            },
            { quoted: msg }
          );
          return;
        }

        const inQty = toNumber(row[1]) || 0;
        const outQty = toNumber(row[2]) || 0;
        const stock = toNumber(row[3]) || 0;
        const revenue = toNumber(row[4]) || 0;
        const cost = toNumber(row[5]) || 0;
        const profit = toNumber(row[6]) || 0;

        const reply = buildStockReply(item, {
          inQty,
          outQty,
          stock,
          revenue,
          cost,
          profit
        });

        await sock.sendMessage(remoteJid, { text: reply }, { quoted: msg });
        return;
      }

      if (commandType === 'pay') {
        if (!dbPool) {
          await sock.sendMessage(
            remoteJid,
            { text: 'Fitur bayar modal butuh PostgreSQL aktif.' },
            { quoted: msg }
          );
          return;
        }

        const payment = parsePaymentPayload(payload || trimmed);
        if (!payment) {
          await sock.sendMessage(remoteJid, { text: helpText() }, { quoted: msg });
          return;
        }

        const sender = getSenderId(msg);
        const result = await applyPayment(dbPool, {
          amount: payment.amount,
          sender,
          raw: trimmed,
          note: payment.note,
          storeId: storeContext?.id
        });

        const balance = await getPayableBalance(dbPool, storeContext?.id);
        const balanceValue = balance?.balance || 0;

        const reply = buildPaymentReply(payment, result, balanceValue);
        await sock.sendMessage(remoteJid, { text: reply }, { quoted: msg });
        return;
      }

      if (commandType === 'ai') {
        if (!payload) {
          await sock.sendMessage(remoteJid, { text: helpText() }, { quoted: msg });
          return;
        }

        const parsed = await parseAiPayload(payload);
        if (!parsed) {
          await sock.sendMessage(remoteJid, { text: helpText() }, { quoted: msg });
          return;
        }

        const sender = getSenderId(msg);
        const typeHint = inferTypeFromText(payload);
        const result = await saveTransactionFromParsed(
          parsed,
          typeHint,
          sender,
          trimmed,
          storeContext?.id
        );
        if (result.error) {
          const missingReply = buildMissingPriceReply(
            result.error,
            exampleTrigger,
            String(result.item || 'barang')
          );
          if (missingReply) {
            await sock.sendMessage(remoteJid, { text: missingReply }, { quoted: msg });
            return;
          }
          await sock.sendMessage(remoteJid, { text: helpText() }, { quoted: msg });
          return;
        }

        const reply = buildTransactionReply(result);
        await sock.sendMessage(remoteJid, { text: reply }, { quoted: msg });
        return;
      }

      let type = null;
      let content = payload;

      if (commandType === 'in') type = 'IN';
      if (commandType === 'out') type = 'OUT';
      if (commandType === 'damage') type = 'DAMAGE';

      if (commandType === 'sheet') {
        if (!payload) {
          await sock.sendMessage(remoteJid, { text: helpText() }, { quoted: msg });
          return;
        }

        if (payloadLower.startsWith('out ')) {
          type = 'OUT';
          content = payload.slice(4).trim();
        } else if (payloadLower.startsWith('in ')) {
          type = 'IN';
          content = payload.slice(3).trim();
        } else if (payloadLower.startsWith('jual ')) {
          type = 'OUT';
          content = payload.slice(5).trim();
        } else if (payloadLower.startsWith('keluar ')) {
          type = 'OUT';
          content = payload.slice(7).trim();
        } else if (payloadLower.startsWith('beli ')) {
          type = 'IN';
          content = payload.slice(5).trim();
        } else if (payloadLower.startsWith('masuk ')) {
          type = 'IN';
          content = payload.slice(6).trim();
        } else if (payloadLower.startsWith('rusak ')) {
          type = 'DAMAGE';
          content = payload.slice(6).trim();
        } else {
          type = null;
          content = payload;
        }
      }

      const parsed = parseCsvPayload(content) || parseNaturalLanguage(content);
      if (!parsed) {
        await sock.sendMessage(remoteJid, { text: helpText() }, { quoted: msg });
        return;
      }

      if (!type && parsed.type && ['IN', 'OUT'].includes(parsed.type)) {
        type = parsed.type;
      }

      if (!type) {
        type = 'IN';
      }

      const sender = getSenderId(msg);
      const result = await saveTransactionFromParsed(
        parsed,
        type,
        sender,
        trimmed,
        storeContext?.id
      );

      if (result.error) {
        const missingReply = buildMissingPriceReply(
          result.error,
          exampleTrigger,
          String(result.item || 'barang')
        );
        if (missingReply) {
          await sock.sendMessage(remoteJid, { text: missingReply }, { quoted: msg });
          return;
        }
        await sock.sendMessage(remoteJid, { text: helpText() }, { quoted: msg });
        return;
      }

      const reply = buildTransactionReply(result);
      await sock.sendMessage(remoteJid, { text: reply }, { quoted: msg });
    } catch (err) {
      logger.error({ err }, 'Failed to handle message');
      try {
        await sock.sendMessage(
          remoteJid,
          { text: 'Gagal simpan ke Google Sheet. Cek config dan izin.' },
          { quoted: msg }
        );
      } catch (sendErr) {
        logger.warn({ err: sendErr }, 'Failed to send error reply');
      }
    }
  });
}

startSock().catch((err) => {
  logger.error({ err }, 'Fatal error');
  process.exit(1);
});
