import 'dotenv/config';
import path from 'path';
import crypto from 'crypto';
import fs from 'fs/promises';
import express from 'express';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import bcrypt from 'bcryptjs';
import { fileURLToPath } from 'url';
import {
  DB_TABLE,
  DB_SUMMARY_VIEW,
  AUDIT_LOGS_TABLE,
  BUYER_ORDERS_TABLE,
  BUYER_ORDER_ITEMS_TABLE,
  OUTBOUND_MESSAGES_TABLE,
  APP_SETTINGS_TABLE,
  PAYABLE_PAYMENTS_TABLE,
  PAYABLE_SUMMARY_VIEW,
  PRODUCTS_TABLE,
  STORES_TABLE,
  USERS_TABLE,
  createPool,
  ensureDatabase,
  normalizeItemKey
} from './db.js';
import { applyPayment, createPayableEntry, getPayableBalance } from './payables.js';

const app = express();
const port = Number(process.env.WEB_PORT || 3333);
const dbPool = createPool();
const sessionSecret = process.env.WEB_SESSION_SECRET || 'dev-secret';
const sessionDays = Number(process.env.WEB_SESSION_DAYS || 7);
const adminUser = process.env.WEB_ADMIN_USER || 'admin';
const adminPassword = process.env.WEB_ADMIN_PASSWORD || '';
const adminWaNumberEnv = String(process.env.ADMIN_WA_NUMBER || '').trim();
const defaultStoreSlug = (process.env.DEFAULT_STORE_SLUG || 'dewi').toLowerCase();
const publicBaseDomain = String(process.env.PUBLIC_BASE_DOMAIN || '').toLowerCase();
const waAuthDir = process.env.WHATSAPP_AUTH_DIR || './auth_info';
const waAuthPath = path.resolve(process.cwd(), waAuthDir);
const waStatusPath = path.join(waAuthPath, 'wa_status.json');
const waResetPath = path.join(waAuthPath, 'wa_reset.json');
const waQrPath = path.resolve(process.cwd(), 'qr.png');
const rupiah = new Intl.NumberFormat('id-ID', {
  style: 'currency',
  currency: 'IDR',
  maximumFractionDigits: 0
});

if (!dbPool) {
  console.error('Missing DATABASE_URL for web dashboard.');
  process.exit(1);
}

await ensureDatabase(dbPool);

async function ensureAdminUser() {
  if (!adminPassword) {
    console.warn('WEB_ADMIN_PASSWORD belum diisi. Login web tidak aktif.');
    return;
  }

  const existing = await dbPool.query(
    `SELECT id FROM ${USERS_TABLE} WHERE username = $1`,
    [adminUser]
  );
  if (existing.rowCount > 0) return;

  const hash = await bcrypt.hash(adminPassword, 10);
  await dbPool.query(
    `INSERT INTO ${USERS_TABLE} (username, password_hash, role) VALUES ($1,$2,'admin')`,
    [adminUser, hash]
  );
}

await ensureAdminUser();

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '..', 'web');
const pagesDir = path.join(publicDir, 'pages');
const uploadsDir = path.join(publicDir, 'uploads');
const productUploadsDir = path.join(uploadsDir, 'products');
const MAX_IMAGE_BYTES = 100 * 1024;
const IMAGE_EXTENSIONS = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp'
};

await fs.mkdir(productUploadsDir, { recursive: true });

const PgSession = connectPgSimple(session);
app.use(
  session({
    store: new PgSession({
      pool: dbPool,
      tableName: 'web_sessions',
      createTableIfMissing: true
    }),
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: Number.isFinite(sessionDays) ? sessionDays * 86400000 : 604800000
    }
  })
);

app.use('/css', express.static(path.join(publicDir, 'css')));
app.use('/js', express.static(path.join(publicDir, 'js')));
app.use('/uploads', express.static(path.join(publicDir, 'uploads')));

function parseImageDataUrl(dataUrl) {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/i.exec(String(dataUrl || '').trim());
  if (!match) return null;
  const mime = match[1].toLowerCase();
  const ext = IMAGE_EXTENSIONS[mime];
  if (!ext) return null;
  const buffer = Buffer.from(match[2], 'base64');
  return { buffer, ext };
}

async function saveProductImage(dataUrl) {
  const parsed = parseImageDataUrl(dataUrl);
  if (!parsed) {
    const err = new Error('invalid_image');
    err.code = 'invalid_image';
    throw err;
  }
  if (parsed.buffer.length > MAX_IMAGE_BYTES) {
    const err = new Error('image_too_large');
    err.code = 'image_too_large';
    throw err;
  }

  const filename = `product-${Date.now()}-${crypto.randomUUID()}.${parsed.ext}`;
  const filePath = path.join(productUploadsDir, filename);
  await fs.writeFile(filePath, parsed.buffer);
  return `/uploads/products/${filename}`;
}

async function removeLocalImage(imageUrl) {
  if (!imageUrl || typeof imageUrl !== 'string') return;
  if (!imageUrl.startsWith('/uploads/')) return;
  const relativePath = imageUrl.replace(/^\/+/, '');
  const filePath = path.join(publicDir, relativePath);
  try {
    await fs.unlink(filePath);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error('Failed to remove image', err);
    }
  }
}

function requirePageAuth(req, res, next) {
  if (req.session?.user) return next();
  res.redirect('/login');
}

function requireStoreSelection(req, res, next) {
  if (!req.session?.user) {
    res.redirect('/login');
    return;
  }
  if (getSessionStoreId(req)) {
    next();
    return;
  }
  res.redirect('/select-store');
}

function requireApiAuth(req, res, next) {
  if (req.session?.user) return next();
  res.status(401).json({ error: 'unauthorized' });
}

async function requireAdmin(req, res, next) {
  const user = req.session?.user;
  if (!user?.id) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  if (user.role === 'admin') {
    next();
    return;
  }

  try {
    const result = await dbPool.query(
      `SELECT role FROM ${USERS_TABLE} WHERE id = $1`,
      [user.id]
    );
    const role = result.rows?.[0]?.role;
    if (role === 'admin') {
      req.session.user.role = role;
      next();
      return;
    }
    res.status(403).json({ error: 'forbidden' });
  } catch (err) {
    console.error('Role check failed', err);
    res.status(500).json({ error: 'role_check_failed' });
  }
}

async function requireAdminPage(req, res, next) {
  const user = req.session?.user;
  if (!user?.id) {
    res.redirect('/login');
    return;
  }

  if (user.role === 'admin') {
    next();
    return;
  }

  try {
    const result = await dbPool.query(
      `SELECT role FROM ${USERS_TABLE} WHERE id = $1`,
      [user.id]
    );
    const role = result.rows?.[0]?.role;
    if (role === 'admin') {
      req.session.user.role = role;
      next();
      return;
    }
    res.redirect('/dashboard');
  } catch (err) {
    console.error('Role check failed', err);
    res.redirect('/dashboard');
  }
}

async function recordAudit({
  userId,
  action,
  entity,
  entityId,
  beforeData,
  afterData,
  req
}) {
  try {
    await dbPool.query(
      `
      INSERT INTO ${AUDIT_LOGS_TABLE}
        (user_id, action, entity, entity_id, before_data, after_data, ip_address)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      `,
      [
        userId,
        action,
        entity,
        entityId ? String(entityId) : null,
        beforeData ? JSON.stringify(beforeData) : null,
        afterData ? JSON.stringify(afterData) : null,
        req?.ip || null
      ]
    );
  } catch (err) {
    console.error('Failed to write audit log', err);
  }
}

async function getSettingValue(key) {
  try {
    const result = await dbPool.query(
      `SELECT value FROM ${APP_SETTINGS_TABLE} WHERE key = $1 LIMIT 1`,
      [key]
    );
    return String(result.rows?.[0]?.value || '').trim() || null;
  } catch (err) {
    return null;
  }
}

async function setSettingValue(key, value) {
  if (value === null || value === undefined || value === '') {
    await dbPool.query(
      `DELETE FROM ${APP_SETTINGS_TABLE} WHERE key = $1`,
      [key]
    );
    return;
  }

  await dbPool.query(
    `
    INSERT INTO ${APP_SETTINGS_TABLE} (key, value, updated_at)
    VALUES ($1,$2,now())
    ON CONFLICT (key) DO UPDATE
    SET value = EXCLUDED.value,
        updated_at = now()
    `,
    [key, value]
  );
}

async function getAdminWaSetting() {
  const stored = await getSettingValue('admin_wa_number');
  if (stored) {
    return { value: stored, source: 'db' };
  }
  if (adminWaNumberEnv) {
    return { value: adminWaNumberEnv, source: 'env' };
  }
  return { value: '', source: 'unset' };
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

async function readWaStatus() {
  try {
    const raw = await fs.readFile(waStatusPath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    return null;
  }
}

async function getQrInfo() {
  try {
    const stat = await fs.stat(waQrPath);
    return { exists: true, updated_at: stat.mtime?.toISOString() || null };
  } catch (err) {
    return { exists: false, updated_at: null };
  }
}

app.get('/', (req, res) => {
  const storeKey = getStoreKeyFromHost(req);
  if (storeKey) {
    res.sendFile(path.join(pagesDir, 'buyer.html'));
    return;
  }
  if (req.session?.user) {
    res.redirect('/dashboard');
    return;
  }
  res.redirect('/login');
});

app.get('/select-store', requirePageAuth, (req, res) => {
  res.sendFile(path.join(pagesDir, 'select-store.html'));
});

app.get('/dashboard', requirePageAuth, requireStoreSelection, (req, res) => {
  res.sendFile(path.join(pagesDir, 'dashboard.html'));
});

app.get('/products', requirePageAuth, requireStoreSelection, (req, res) => {
  res.sendFile(path.join(pagesDir, 'products.html'));
});

app.get('/transactions', requirePageAuth, requireStoreSelection, (req, res) => {
  res.sendFile(path.join(pagesDir, 'transactions.html'));
});

app.get('/receipts', requirePageAuth, requireStoreSelection, (req, res) => {
  res.sendFile(path.join(pagesDir, 'receipts.html'));
});

app.get('/payables', requirePageAuth, requireStoreSelection, (req, res) => {
  res.sendFile(path.join(pagesDir, 'payables.html'));
});

app.get('/logs', requirePageAuth, requireStoreSelection, (req, res) => {
  res.sendFile(path.join(pagesDir, 'logs.html'));
});

app.get('/users', requirePageAuth, requireStoreSelection, requireAdminPage, (req, res) => {
  res.sendFile(path.join(pagesDir, 'users.html'));
});

app.get('/stores', requirePageAuth, requireStoreSelection, requireAdminPage, (req, res) => {
  res.sendFile(path.join(pagesDir, 'stores.html'));
});

app.get(
  '/ai-settings',
  requirePageAuth,
  requireStoreSelection,
  requireAdminPage,
  (req, res) => {
    res.sendFile(path.join(pagesDir, 'ai-settings.html'));
  }
);

app.get('/order', (req, res) => {
  res.sendFile(path.join(pagesDir, 'buyer.html'));
});

app.get('/order/:slug', (req, res) => {
  res.sendFile(path.join(pagesDir, 'buyer.html'));
});

app.get('/buy', (req, res) => {
  res.sendFile(path.join(pagesDir, 'buyer.html'));
});

app.get('/buy/:slug', (req, res) => {
  res.sendFile(path.join(pagesDir, 'buyer.html'));
});

app.get('/index.html', requirePageAuth, (req, res) => {
  res.redirect('/dashboard');
});

app.get('/login', (req, res) => {
  res.sendFile(path.join(pagesDir, 'login.html'));
});

app.post('/api/login', async (req, res) => {
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');
  if (!username || !password) {
    res.status(400).json({ error: 'missing_credentials' });
    return;
  }

  try {
    const result = await dbPool.query(
      `SELECT id, username, password_hash, role, is_active, default_store_id FROM ${USERS_TABLE} WHERE username = $1`,
      [username]
    );
    const user = result.rows?.[0];
    if (!user) {
      res.status(401).json({ error: 'invalid_credentials' });
      return;
    }

    if (user.is_active === false) {
      res.status(403).json({ error: 'account_disabled' });
      return;
    }

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      res.status(401).json({ error: 'invalid_credentials' });
      return;
    }

    req.session.user = { id: user.id, username: user.username, role: user.role };
    req.session.activeStoreId = null;
    const defaultStoreId = Number(user.default_store_id);
    if (Number.isFinite(defaultStoreId) && defaultStoreId > 0) {
      const activeDefaultId = await getActiveStoreIdById(defaultStoreId);
      if (activeDefaultId) {
        req.session.activeStoreId = activeDefaultId;
      }
    }
    await dbPool.query(
      `UPDATE ${USERS_TABLE} SET last_login_at = now() WHERE id = $1`,
      [user.id]
    );
    const needsStore = !getSessionStoreId(req);
    const redirect = needsStore ? '/select-store' : '/dashboard';
    res.json({
      ok: true,
      user: { username: user.username, role: user.role },
      redirect
    });
  } catch (err) {
    console.error('Login failed', err);
    res.status(500).json({ error: 'login_failed' });
  }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

app.get('/api/me', requireApiAuth, async (req, res) => {
  const sessionUser = req.session.user;
  if (!sessionUser?.id) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  if (!sessionUser.role) {
    try {
      const result = await dbPool.query(
        `SELECT role, is_active FROM ${USERS_TABLE} WHERE id = $1`,
        [sessionUser.id]
      );
      const row = result.rows?.[0];
      if (row?.role) {
        sessionUser.role = row.role;
      }
      if (row?.is_active === false) {
        res.status(403).json({ error: 'account_disabled' });
        return;
      }
    } catch (err) {
      console.error('Failed to load user role', err);
    }
  }

  const activeStoreId = getSessionStoreId(req);
  const activeStore = activeStoreId ? await getStoreById(activeStoreId) : null;
  res.json({ user: sessionUser, activeStore });
});

app.get('/api/store/active', requireApiAuth, async (req, res) => {
  const activeStoreId = getSessionStoreId(req);
  const store = activeStoreId ? await getStoreById(activeStoreId) : null;
  res.json({ store });
});

app.post('/api/store/active', requireApiAuth, async (req, res) => {
  const storeIdRaw = Number(req.body?.store_id ?? req.body?.storeId);
  if (!Number.isFinite(storeIdRaw) || storeIdRaw <= 0) {
    res.status(400).json({ error: 'invalid_store' });
    return;
  }

  try {
    const result = await dbPool.query(
      `
      SELECT id, name, slug, wa_trigger, is_active
      FROM ${STORES_TABLE}
      WHERE id = $1
      LIMIT 1
      `,
      [storeIdRaw]
    );
    const store = result.rows?.[0];
    if (!store || store.is_active === false) {
      res.status(404).json({ error: 'store_not_found' });
      return;
    }

    req.session.activeStoreId = store.id;
    res.json({ ok: true, store });
  } catch (err) {
    console.error('Failed to set active store', err);
    res.status(500).json({ error: 'failed_to_set_store' });
  }
});

app.get('/api/public/products', async (req, res) => {
  try {
    const store = await resolvePublicStore(req);
    if (!store) {
      res.status(404).json({ error: 'store_not_found' });
      return;
    }
    const storeId = store.id;
    const result = await dbPool.query(
      `
      SELECT
        p.id,
        p.name,
        p.unit,
        COALESCE(p.default_sell_price, p.last_sell_price) AS sell_price,
        COALESCE(s.stock, 0) AS stock
      FROM ${PRODUCTS_TABLE} p
      LEFT JOIN ${DB_SUMMARY_VIEW} s ON s.product_id = p.id
      WHERE p.is_active = true AND p.store_id = $1
      ORDER BY p.name ASC
      `
      ,
      [storeId]
    );

    const data = (result.rows || []).filter((row) => row.sell_price != null);
    res.json({ data, store });
  } catch (err) {
    console.error('Failed to load public products', err);
    res.status(500).json({ error: 'failed_to_load' });
  }
});

app.post('/api/public/orders', async (req, res) => {
  const block = String(req.body?.block || '').trim().toUpperCase();
  const houseNumber = String(req.body?.house_number || '').trim();
  const buyerWaRaw = String(req.body?.buyer_wa || '').trim();
  const buyerWa = normalizePhoneNumber(buyerWaRaw);
  const items = Array.isArray(req.body?.items) ? req.body.items : [];

  if (!block || !houseNumber || !buyerWa || items.length === 0) {
    res.status(400).json({ error: 'missing_fields' });
    return;
  }

  const qtyMap = new Map();
  for (const item of items) {
    const productId = Number(item?.product_id ?? item?.id);
    const qtyRaw = toNumber(item?.qty);
    const qty = Number.isNaN(qtyRaw) ? 0 : Math.floor(qtyRaw);
    if (!Number.isFinite(productId) || productId <= 0) continue;
    if (!Number.isFinite(qty) || qty <= 0) continue;
    qtyMap.set(productId, (qtyMap.get(productId) || 0) + qty);
  }

  if (qtyMap.size === 0) {
    res.status(400).json({ error: 'invalid_items' });
    return;
  }

  const productIds = Array.from(qtyMap.keys());

  try {
    const store = await resolvePublicStore(req);
    if (!store) {
      res.status(404).json({ error: 'store_not_found' });
      return;
    }
    const storeId = store.id;
    const storeName = store.name || null;
    const productsRes = await dbPool.query(
      `
      SELECT
        p.id,
        p.name,
        p.unit,
        p.is_active,
        COALESCE(p.default_sell_price, p.last_sell_price) AS sell_price
      FROM ${PRODUCTS_TABLE} p
      WHERE p.id = ANY($1) AND p.store_id = $2
      `,
      [productIds, storeId]
    );

    const products = productsRes.rows || [];
    const productMap = new Map(products.map((row) => [Number(row.id), row]));

    const orderItems = [];
    let subtotal = 0;

    for (const [productId, qty] of qtyMap.entries()) {
      const product = productMap.get(productId);
      if (!product || !product.is_active || product.sell_price == null) {
        res.status(400).json({ error: 'invalid_items' });
        return;
      }

      const unitPrice = Number(product.sell_price);
      if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
        res.status(400).json({ error: 'invalid_items' });
        return;
      }

      const lineTotal = unitPrice * qty;
      subtotal += lineTotal;
      orderItems.push({
        product_id: productId,
        item_name: product.name,
        qty,
        unit_price: unitPrice,
        total: lineTotal
      });
    }

    if (subtotal <= 0) {
      res.status(400).json({ error: 'invalid_items' });
      return;
    }

    const shippingFee = subtotal >= 20000 ? 0 : 1000;
    const total = subtotal + shippingFee;
    const adminSetting = await getAdminWaSetting();
    const adminJid = toWhatsappJid(adminSetting.value);

    const client = await dbPool.connect();
    try {
      await client.query('BEGIN');

      const orderRes = await client.query(
        `
        INSERT INTO ${BUYER_ORDERS_TABLE}
          (store_id, buyer_wa, address_block, address_number, subtotal, shipping_fee, total, status, items_count)
        VALUES ($1,$2,$3,$4,$5,$6,$7,'new',$8)
        RETURNING id
        `,
        [storeId, buyerWa, block, houseNumber, subtotal, shippingFee, total, orderItems.length]
      );

      const orderId = orderRes.rows?.[0]?.id;

      for (const item of orderItems) {
        await client.query(
          `
          INSERT INTO ${BUYER_ORDER_ITEMS_TABLE}
            (order_id, product_id, item_name, qty, unit_price, total)
          VALUES ($1,$2,$3,$4,$5,$6)
          `,
          [orderId, item.product_id, item.item_name, item.qty, item.unit_price, item.total]
        );
      }

      const message = buildOrderMessage(
        {
          id: orderId,
          store_name: storeName,
          buyer_wa: buyerWa,
          address_block: block,
          address_number: houseNumber,
          subtotal,
          shipping_fee: shippingFee,
          total
        },
        orderItems
      );

      await client.query(
        `
        INSERT INTO ${OUTBOUND_MESSAGES_TABLE} (target_jid, message)
        VALUES ($1,$2)
        `,
        [adminJid, message]
      );

      await client.query('COMMIT');
      res.json({ ok: true, orderId });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Failed to create order', err);
    res.status(500).json({ error: 'failed_to_create' });
  }
});

app.use('/api', requireApiAuth);
app.use('/api/users', requireAdmin);

app.get('/api/ai-settings', requireAdmin, async (req, res) => {
  try {
    const setting = await getAdminWaSetting();
    const allowlistRaw = await getSettingValue('ai_group_allowlist');
    const allowlist = parseGroupAllowlist(allowlistRaw);
    res.json({
      admin_wa_number: setting.value || '',
      source: setting.source,
      ai_group_allowlist: allowlist,
      ai_group_allowlist_text: allowlist.join('\n')
    });
  } catch (err) {
    res.status(500).json({ error: 'failed_to_load' });
  }
});

app.put('/api/ai-settings', requireAdmin, async (req, res) => {
  const adminRaw = String(req.body?.admin_wa_number || '').trim();
  const normalized = normalizePhoneNumber(adminRaw);
  const nextValue = normalized || null;
  const allowlistRaw = String(req.body?.ai_group_allowlist || '').trim();
  const allowlist = parseGroupAllowlist(allowlistRaw);
  const allowlistValue = allowlist.length ? JSON.stringify(allowlist) : null;

  try {
    const beforeAdmin = await getSettingValue('admin_wa_number');
    const beforeAllowlist = parseGroupAllowlist(
      await getSettingValue('ai_group_allowlist')
    );
    await setSettingValue('admin_wa_number', nextValue);
    await setSettingValue('ai_group_allowlist', allowlistValue);

    await recordAudit({
      userId: req.session.user?.id,
      action: 'UPDATE',
      entity: 'setting',
      entityId: 'ai_settings',
      beforeData: {
        admin_wa_number: beforeAdmin,
        ai_group_allowlist: beforeAllowlist
      },
      afterData: {
        admin_wa_number: nextValue,
        ai_group_allowlist: allowlist
      },
      req
    });

    res.json({
      admin_wa_number: nextValue || '',
      ai_group_allowlist: allowlist
    });
  } catch (err) {
    console.error('Failed to update AI settings', err);
    res.status(500).json({ error: 'failed_to_update' });
  }
});

app.get('/api/wa/status', requireAdmin, async (req, res) => {
  try {
    const [status, qrInfo] = await Promise.all([readWaStatus(), getQrInfo()]);
    const resolvedStatus =
      status?.status || (qrInfo.exists ? 'qr' : 'unknown');
    res.json({
      status: resolvedStatus,
      updated_at: status?.updated_at || null,
      wa_number: status?.wa_number || null,
      jid: status?.jid || null,
      reason: status?.reason || null,
      qr_available: qrInfo.exists,
      qr_updated_at: qrInfo.updated_at
    });
  } catch (err) {
    res.status(500).json({ error: 'failed_to_load' });
  }
});

app.get('/api/wa/qr', requireAdmin, async (req, res) => {
  try {
    await fs.access(waQrPath);
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(waQrPath);
  } catch (err) {
    res.status(404).json({ error: 'qr_not_found' });
  }
});

app.post('/api/wa/reset', requireAdmin, async (req, res) => {
  try {
    await fs.mkdir(waAuthPath, { recursive: true });
    const payload = {
      action: 'reset',
      requested_at: new Date().toISOString(),
      requested_by: req.session.user?.username || 'web'
    };
    await fs.writeFile(waResetPath, JSON.stringify(payload));

    await recordAudit({
      userId: req.session.user?.id,
      action: 'UPDATE',
      entity: 'wa_session',
      entityId: 'reset',
      afterData: payload,
      req
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('Failed to request WA reset', err);
    res.status(500).json({ error: 'failed_to_reset' });
  }
});

app.get('/api/product-categories', async (req, res) => {
  const storeId = await resolveStoreId(req);
  const params = [];
  const where = ["category IS NOT NULL", "category <> ''"];

  if (storeId) {
    params.push(storeId);
    where.push(`store_id = $${params.length}`);
  }

  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  try {
    const result = await dbPool.query(
      `
      SELECT DISTINCT category
      FROM ${PRODUCTS_TABLE}
      ${whereClause}
      ORDER BY category ASC
      `,
      params
    );

    res.json({ data: (result.rows || []).map((row) => row.category) });
  } catch (err) {
    console.error('Failed to load product categories', err);
    res.status(500).json({ error: 'failed_to_load' });
  }
});

function toNumber(value) {
  if (typeof value === 'number') return value;
  const raw = String(value || '').trim();
  if (!raw) return Number.NaN;
  const cleaned = raw.replace(/[^0-9.,-]/g, '');
  if (!cleaned || cleaned === '-' || cleaned === ',' || cleaned === '.') {
    return Number.NaN;
  }

  const negative = cleaned.startsWith('-');
  const unsigned = cleaned.replace(/-/g, '');
  const hasSeparator = /[.,]/.test(unsigned);

  let normalized = unsigned;
  if (hasSeparator) {
    const lastDot = unsigned.lastIndexOf('.');
    const lastComma = unsigned.lastIndexOf(',');
    const lastSep = Math.max(lastDot, lastComma);
    const decimals = unsigned.slice(lastSep + 1);
    if (decimals.length > 0 && decimals.length <= 2) {
      const integerPart = unsigned.slice(0, lastSep).replace(/[.,]/g, '');
      normalized = `${integerPart}.${decimals}`;
    } else {
      normalized = unsigned.replace(/[.,]/g, '');
    }
  }

  const num = Number(normalized);
  if (Number.isNaN(num)) return Number.NaN;
  return negative ? -Math.abs(num) : num;
}

function coerceNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const num = toNumber(value);
  return Number.isNaN(num) ? null : num;
}

function parseBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
}

function toRole(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback;
  const role = String(value).trim().toLowerCase();
  if (role === 'admin' || role === 'staff') return role;
  return null;
}

async function resolveUserDefaultStoreId(input) {
  if (input === null || input === undefined || input === '') {
    return { value: null };
  }
  const storeId = Number(input);
  if (!Number.isFinite(storeId) || storeId <= 0) {
    return { error: 'invalid_store' };
  }

  try {
    const result = await dbPool.query(
      `
      SELECT id, is_active
      FROM ${STORES_TABLE}
      WHERE id = $1
      LIMIT 1
      `,
      [storeId]
    );
    const store = result.rows?.[0];
    if (!store) return { error: 'store_not_found' };
    if (store.is_active === false) return { error: 'store_inactive' };
    return { value: store.id };
  } catch (err) {
    console.error('Failed to resolve default store', err);
    return { error: 'store_lookup_failed' };
  }
}

function toPayableMode(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback;
  const mode = String(value).trim().toLowerCase();
  if (mode === 'credit' || mode === 'utang' || mode === 'hutang') return 'credit';
  if (mode === 'cash' || mode === 'lunas' || mode === 'paid') return 'cash';
  return null;
}

function toTransactionType(value) {
  if (value === null || value === undefined || value === '') return null;
  const raw = String(value).trim().toLowerCase();
  if (!raw) return null;
  if (['in', 'masuk', 'beli', 'restock'].includes(raw)) return 'IN';
  if (['out', 'keluar', 'terjual', 'jual', 'sale', 'sold'].includes(raw)) return 'OUT';
  if (['damage', 'rusak', 'retur', 'waste'].includes(raw)) return 'DAMAGE';
  const upper = raw.toUpperCase();
  if (['IN', 'OUT', 'DAMAGE'].includes(upper)) return upper;
  return null;
}

function normalizeDateOnly(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const parsed = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  if (parsed.toISOString().slice(0, 10) !== raw) return null;
  return raw;
}

function normalizeIsoDatetime(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function isValidDateRange(fromIso, toIso) {
  if (!fromIso || !toIso) return false;
  const fromDate = new Date(fromIso);
  const toDate = new Date(toIso);
  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
    return false;
  }
  return fromDate.getTime() < toDate.getTime();
}

function pickPrice(...values) {
  for (const value of values) {
    const num = toNumber(value);
    if (!Number.isNaN(num) && num > 0) return num;
  }
  return null;
}

let cachedDefaultStoreId = null;
let cachedDefaultStoreAt = 0;
const DEFAULT_STORE_CACHE_TTL_MS = 60000;

function getSessionStoreId(req) {
  const raw = Number(req.session?.activeStoreId);
  return Number.isFinite(raw) ? raw : null;
}

async function getActiveStoreIdById(storeId) {
  if (!storeId) return null;
  try {
    const result = await dbPool.query(
      `
      SELECT id
      FROM ${STORES_TABLE}
      WHERE id = $1 AND is_active = true
      LIMIT 1
      `,
      [storeId]
    );
    return result.rows?.[0]?.id || null;
  } catch (err) {
    console.error('Failed to load active store', err);
    return null;
  }
}

async function getStoreById(storeId) {
  if (!storeId) return null;
  try {
    const result = await dbPool.query(
      `
      SELECT id, name, slug, wa_trigger
      FROM ${STORES_TABLE}
      WHERE id = $1
      LIMIT 1
      `,
      [storeId]
    );
    return result.rows?.[0] || null;
  } catch (err) {
    console.error('Failed to load store', err);
    return null;
  }
}

async function getDefaultStoreId() {
  const now = Date.now();
  if (
    cachedDefaultStoreId &&
    now - cachedDefaultStoreAt < DEFAULT_STORE_CACHE_TTL_MS
  ) {
    return cachedDefaultStoreId;
  }
  try {
    const result = await dbPool.query(
      `SELECT id FROM ${STORES_TABLE} WHERE slug = $1 LIMIT 1`,
      [defaultStoreSlug]
    );
    cachedDefaultStoreId = result.rows?.[0]?.id || null;
    cachedDefaultStoreAt = now;
    return cachedDefaultStoreId;
  } catch (err) {
    console.error('Failed to load default store', err);
    return null;
  }
}

async function resolveStoreId(req) {
  const storeIdRaw = Number(
    req.query?.storeId ?? req.body?.store_id ?? req.body?.storeId
  );
  if (Number.isFinite(storeIdRaw) && storeIdRaw > 0) return storeIdRaw;

  const sessionStoreId = getSessionStoreId(req);
  if (sessionStoreId) return sessionStoreId;

  return await getDefaultStoreId();
}

function getStoreKeyFromHost(req) {
  const host = String(req.hostname || req.headers?.host || '').toLowerCase();
  if (!host) return '';

  const cleanHost = host.split(':')[0];
  const isLocal =
    cleanHost === 'localhost' ||
    cleanHost === '127.0.0.1' ||
    cleanHost === '[::1]';
  if (isLocal) return '';

  if (publicBaseDomain) {
    if (cleanHost === publicBaseDomain) return '';
    if (cleanHost.endsWith(`.${publicBaseDomain}`)) {
      const sub = cleanHost.slice(0, -publicBaseDomain.length - 1);
      return sub.split('.').filter(Boolean).join('.');
    }
  }

  const parts = cleanHost.split('.').filter(Boolean);
  if (parts.length >= 3) return parts[0];
  return '';
}

async function resolvePublicStore(req) {
  const storeIdRaw = Number(
    req.query?.storeId ?? req.body?.store_id ?? req.body?.storeId
  );
  const hostStoreKey = getStoreKeyFromHost(req);
  const storeKeyRaw = String(
    req.query?.store ?? req.body?.store ?? hostStoreKey ?? ''
  ).trim();
  const storeKey = storeKeyRaw.toLowerCase();
  const storeSlug = storeKeyRaw ? slugify(storeKeyRaw) : '';

  let store = null;

  if (Number.isFinite(storeIdRaw) && storeIdRaw > 0) {
    const res = await dbPool.query(
      `
      SELECT id, name, slug
      FROM ${STORES_TABLE}
      WHERE id = $1 AND is_active = true
      `,
      [storeIdRaw]
    );
    store = res.rows?.[0] || null;
  }

  if (!store && storeKey) {
    const res = await dbPool.query(
      `
      SELECT id, name, slug
      FROM ${STORES_TABLE}
      WHERE (slug = $1 OR wa_trigger = $1) AND is_active = true
      LIMIT 1
      `,
      [storeKey]
    );
    store = res.rows?.[0] || null;
  }

  if (!store && storeSlug && storeSlug !== storeKey) {
    const res = await dbPool.query(
      `
      SELECT id, name, slug
      FROM ${STORES_TABLE}
      WHERE (slug = $1 OR wa_trigger = $1) AND is_active = true
      LIMIT 1
      `,
      [storeSlug]
    );
    store = res.rows?.[0] || null;
  }

  if (!store) {
    const defaultStoreId = await getDefaultStoreId();
    if (defaultStoreId) {
      const res = await dbPool.query(
        `SELECT id, name, slug FROM ${STORES_TABLE} WHERE id = $1 LIMIT 1`,
        [defaultStoreId]
      );
      store = res.rows?.[0] || null;
    }
  }

  return store;
}

function slugify(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\\s-]/g, '')
    .replace(/\\s+/g, '-')
    .replace(/-+/g, '-');
}

function normalizePhoneNumber(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('62')) return digits;
  if (digits.startsWith('0')) return `62${digits.slice(1)}`;
  if (digits.startsWith('8')) return `62${digits}`;
  return digits;
}

function toWhatsappJid(value) {
  const normalized = normalizePhoneNumber(value);
  if (!normalized) return null;
  return `${normalized}@s.whatsapp.net`;
}

function formatCurrency(value) {
  const amount = Number(value) || 0;
  return rupiah.format(amount);
}

function buildOrderMessage(order, items) {
  const lines = [
    `Pesanan baru #${order.id}`,
    order.store_name ? `Toko: ${order.store_name}` : null,
    `Alamat: Griya Permata Hijau Blok ${order.address_block} No ${order.address_number}`,
    `WA: ${order.buyer_wa}`,
    '',
    'Rincian:'
  ].filter(Boolean);

  items.forEach((item, index) => {
    lines.push(
      `${index + 1}. ${item.item_name} x${item.qty} @ ${formatCurrency(
        item.unit_price
      )} = ${formatCurrency(item.total)}`
    );
  });

  lines.push('');
  lines.push(`Subtotal: ${formatCurrency(order.subtotal)}`);
  if (order.shipping_fee > 0) {
    lines.push(`Ongkir: ${formatCurrency(order.shipping_fee)}`);
  } else {
    lines.push('Ongkir: Gratis');
  }
  lines.push(`Total: ${formatCurrency(order.total)}`);

  return lines.join('\n');
}

function sanitizeUserRow(row) {
  if (!row) return null;
  const { password_hash, ...rest } = row;
  return rest;
}

app.get('/api/health', async (req, res) => {
  try {
    await dbPool.query('SELECT 1');
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false });
  }
});

app.get('/api/stores', async (req, res) => {
  const includeInactive = req.query.includeInactive === 'true';
  const params = [];
  const where = includeInactive ? '' : 'WHERE is_active = true';

  try {
    const result = await dbPool.query(
      `
      SELECT id, name, slug, category, description, wa_trigger, is_active, created_at, updated_at
      FROM ${STORES_TABLE}
      ${where}
      ORDER BY is_active DESC, name ASC
      `,
      params
    );
    res.json({ data: result.rows });
  } catch (err) {
    console.error('Failed to load stores', err);
    res.status(500).json({ error: 'failed_to_load' });
  }
});

app.post('/api/stores', requireAdmin, async (req, res) => {
  const name = String(req.body?.name || '').trim();
  const slug = slugify(req.body?.slug || name);
  const category = String(req.body?.category || '').trim() || null;
  const description = String(req.body?.description || '').trim() || null;
  const waTrigger = String(req.body?.wa_trigger || '').trim().toLowerCase() || null;

  if (!name || !slug) {
    res.status(400).json({ error: 'missing_fields' });
    return;
  }

  try {
    const result = await dbPool.query(
      `
      INSERT INTO ${STORES_TABLE}
        (name, slug, category, description, wa_trigger, is_active, updated_at)
      VALUES ($1,$2,$3,$4,$5,true,now())
      RETURNING id, name, slug, category, description, wa_trigger, is_active
      `,
      [name, slug, category, description, waTrigger]
    );
    const store = result.rows?.[0];
    await recordAudit({
      userId: req.session.user?.id,
      action: 'CREATE',
      entity: 'store',
      entityId: store?.id,
      afterData: store,
      req
    });
    res.json({ id: store?.id });
  } catch (err) {
    if (String(err?.message || '').includes('duplicate key')) {
      res.status(409).json({ error: 'duplicate_store' });
      return;
    }
    console.error('Failed to create store', err);
    res.status(500).json({ error: 'failed_to_create' });
  }
});

app.put('/api/stores/:id', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: 'invalid_id' });
    return;
  }

  const name = req.body?.name != null ? String(req.body.name).trim() : null;
  const slug = req.body?.slug != null ? slugify(req.body.slug) : null;
  const category = req.body?.category != null ? String(req.body.category).trim() : null;
  const description = req.body?.description != null ? String(req.body.description).trim() : null;
  const waTrigger =
    req.body?.wa_trigger != null ? String(req.body.wa_trigger).trim().toLowerCase() : null;
  const isActive = parseBoolean(req.body?.is_active);

  try {
    const beforeRes = await dbPool.query(
      `SELECT * FROM ${STORES_TABLE} WHERE id = $1`,
      [id]
    );
    const before = beforeRes.rows?.[0];
    if (!before) {
      res.status(404).json({ error: 'not_found' });
      return;
    }

    const result = await dbPool.query(
      `
      UPDATE ${STORES_TABLE}
      SET name = COALESCE($2, name),
          slug = COALESCE($3, slug),
          category = COALESCE($4, category),
          description = COALESCE($5, description),
          wa_trigger = COALESCE($6, wa_trigger),
          is_active = COALESCE($7, is_active),
          updated_at = now()
      WHERE id = $1
      RETURNING id, name, slug, category, description, wa_trigger, is_active
      `,
      [id, name, slug, category, description, waTrigger, isActive]
    );

    const after = result.rows?.[0];
    await recordAudit({
      userId: req.session.user?.id,
      action: 'UPDATE',
      entity: 'store',
      entityId: id,
      beforeData: before,
      afterData: after,
      req
    });

    res.json({ id: after?.id });
  } catch (err) {
    if (String(err?.message || '').includes('duplicate key')) {
      res.status(409).json({ error: 'duplicate_store' });
      return;
    }
    console.error('Failed to update store', err);
    res.status(500).json({ error: 'failed_to_update' });
  }
});

app.delete('/api/stores/:id', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: 'invalid_id' });
    return;
  }

  try {
    const beforeRes = await dbPool.query(
      `SELECT * FROM ${STORES_TABLE} WHERE id = $1`,
      [id]
    );
    const before = beforeRes.rows?.[0];
    if (!before) {
      res.status(404).json({ error: 'not_found' });
      return;
    }

    const result = await dbPool.query(
      `
      UPDATE ${STORES_TABLE}
      SET is_active = false,
          updated_at = now()
      WHERE id = $1
      RETURNING id, name, slug, category, description, wa_trigger, is_active
      `,
      [id]
    );

    const after = result.rows?.[0];
    await recordAudit({
      userId: req.session.user?.id,
      action: 'DELETE',
      entity: 'store',
      entityId: id,
      beforeData: before,
      afterData: after,
      req
    });

    res.json({ id: after?.id });
  } catch (err) {
    console.error('Failed to deactivate store', err);
    res.status(500).json({ error: 'failed_to_delete' });
  }
});

  app.get('/api/products', async (req, res) => {
    const includeInactive = req.query.includeInactive === 'true';
    const search = String(req.query.search || '').trim();
    const category = String(req.query.category || '').trim();
    const storeId = await resolveStoreId(req);

  const params = [];
  const where = [];

  if (!includeInactive) {
    where.push('p.is_active = true');
  }

  if (storeId) {
    params.push(storeId);
    where.push(`p.store_id = $${params.length}`);
  }

  if (search) {
    params.push(`%${search}%`);
    where.push(`p.name ILIKE $${params.length}`);
  }

  if (category) {
    params.push(category);
    where.push(`LOWER(TRIM(p.category)) = LOWER(TRIM($${params.length}))`);
  }

  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  try {
    const result = await dbPool.query(
      `
        SELECT
          p.id,
          p.name,
          p.unit,
          p.category,
          p.image_url,
          p.note,
          p.is_active,
          p.default_buy_price,
          p.default_sell_price,
        p.last_buy_price,
        p.last_sell_price,
        p.store_id,
        p.payable_mode,
        COALESCE(s.stock_in, 0) AS stock_in,
        COALESCE(s.stock_out, 0) AS stock_out,
        COALESCE(s.stock, 0) AS stock,
        COALESCE(s.revenue, 0) AS revenue,
        COALESCE(s.cost, 0) AS cost,
        COALESCE(s.profit, 0) AS profit
      FROM ${PRODUCTS_TABLE} p
      LEFT JOIN ${DB_SUMMARY_VIEW} s ON s.product_id = p.id
      ${whereClause}
      ORDER BY p.is_active DESC, p.updated_at DESC, p.name ASC
      `,
      params
    );

    res.json({ data: result.rows });
  } catch (err) {
    console.error('Failed to load products', err);
    res.status(500).json({ error: 'failed_to_load' });
  }
});

app.post('/api/products', async (req, res) => {
  const name = String(req.body?.name || '').trim();
  const unit = String(req.body?.unit || '').trim() || null;
  const category = String(req.body?.category || '').trim() || null;
  const imageData = String(req.body?.image_data || '').trim();
  const imageUrlRaw = String(req.body?.image_url || '').trim();
  let imageUrl = imageUrlRaw || null;
  const note = String(req.body?.note || '').trim() || null;
  const defaultBuyPrice = coerceNumber(req.body?.default_buy_price);
  const defaultSellPrice = coerceNumber(req.body?.default_sell_price);
  const payableMode = toPayableMode(req.body?.payable_mode, 'credit');
  const initialStockRaw = String(req.body?.initial_stock ?? '').trim();
  const hasInitialStockInput = initialStockRaw !== '';
  const initialStock = hasInitialStockInput ? coerceNumber(initialStockRaw) : null;
  const storeId = await resolveStoreId(req);

  if (!name) {
    res.status(400).json({ error: 'missing_name' });
    return;
  }

  if (!storeId) {
    res.status(400).json({ error: 'missing_store' });
    return;
  }

  if (!payableMode) {
    res.status(400).json({ error: 'invalid_payable_mode' });
    return;
  }

  if (hasInitialStockInput && (initialStock === null || initialStock < 0)) {
    res.status(400).json({ error: 'invalid_initial_stock' });
    return;
  }

  const nameKey = normalizeItemKey(name);
  const shouldRecordInitialStock = Number.isFinite(initialStock) && initialStock > 0;

  try {
    if (imageData) {
      imageUrl = await saveProductImage(imageData);
    }

    const client = await dbPool.connect();
    let product = null;
    let initialStockRecorded = false;
    let initialStockTransactionId = null;

    try {
      await client.query('BEGIN');

      const result = await client.query(
        `
        INSERT INTO ${PRODUCTS_TABLE}
          (name, name_key, store_id, unit, category, image_url, default_buy_price, default_sell_price, payable_mode, note, is_active, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true,now())
        ON CONFLICT (store_id, name_key) DO UPDATE
        SET name = EXCLUDED.name,
            unit = COALESCE(EXCLUDED.unit, ${PRODUCTS_TABLE}.unit),
            category = COALESCE(EXCLUDED.category, ${PRODUCTS_TABLE}.category),
            image_url = COALESCE(EXCLUDED.image_url, ${PRODUCTS_TABLE}.image_url),
            default_buy_price = COALESCE(EXCLUDED.default_buy_price, ${PRODUCTS_TABLE}.default_buy_price),
            default_sell_price = COALESCE(EXCLUDED.default_sell_price, ${PRODUCTS_TABLE}.default_sell_price),
            payable_mode = COALESCE(EXCLUDED.payable_mode, ${PRODUCTS_TABLE}.payable_mode),
            note = COALESCE(EXCLUDED.note, ${PRODUCTS_TABLE}.note),
            is_active = true,
            updated_at = now()
        RETURNING *, (xmax = 0) AS inserted
        `,
        [
          name,
          nameKey,
          storeId,
          unit,
          category,
          imageUrl,
          defaultBuyPrice,
          defaultSellPrice,
          payableMode,
          note
        ]
      );

      product = result.rows?.[0] || null;
      if (!product) {
        throw new Error('product_failed');
      }

      if (shouldRecordInitialStock) {
        const buyPriceForInitialStock = pickPrice(
          defaultBuyPrice,
          product.last_buy_price,
          product.default_buy_price
        );
        if (
          buyPriceForInitialStock == null ||
          Number.isNaN(buyPriceForInitialStock) ||
          buyPriceForInitialStock <= 0
        ) {
          const missingBuyError = new Error('missing_buy_for_initial_stock');
          missingBuyError.statusCode = 400;
          throw missingBuyError;
        }

        const sellPriceForInitialStock = pickPrice(
          defaultSellPrice,
          product.last_sell_price,
          product.default_sell_price
        );
        const totalInitialStock = buyPriceForInitialStock * initialStock;
        const initialStockNote = note ? `Stok awal: ${note}` : 'Stok awal produk';

        const txResult = await client.query(
          `
          INSERT INTO ${DB_TABLE}
            (type, product_id, store_id, item, qty, unit_price, total,
             buy_price, sell_price, cost_price, cost_total, note, sender, raw)
          VALUES ('IN',$1,$2,$3,$4,$5,$6,$5,$7,$5,$6,$8,$9,'web')
          RETURNING id
          `,
          [
            product.id,
            product.store_id ?? storeId ?? null,
            product.name,
            initialStock,
            buyPriceForInitialStock,
            totalInitialStock,
            sellPriceForInitialStock,
            initialStockNote,
            req.session.user?.username || 'web'
          ]
        );
        initialStockTransactionId = txResult.rows?.[0]?.id || null;

        await client.query(
          `
          UPDATE ${PRODUCTS_TABLE}
          SET last_buy_price = COALESCE($2, last_buy_price),
              default_buy_price = COALESCE(default_buy_price, $2),
              last_sell_price = COALESCE($3, last_sell_price),
              default_sell_price = COALESCE(default_sell_price, $3),
              updated_at = now()
          WHERE id = $1
          `,
          [product.id, buyPriceForInitialStock, sellPriceForInitialStock]
        );

        initialStockRecorded = true;
      }

      await client.query('COMMIT');
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackErr) {
        console.error('Rollback failed while creating product', rollbackErr);
      }
      throw err;
    } finally {
      client.release();
    }

    if (product) {
      await recordAudit({
        userId: req.session.user?.id,
        action: 'CREATE',
        entity: 'product',
        entityId: product.id,
        afterData: product,
        req
      });
    }

    if (initialStockTransactionId) {
      await recordAudit({
        userId: req.session.user?.id,
        action: 'CREATE',
        entity: 'transaction',
        entityId: initialStockTransactionId,
        afterData: {
          type: 'IN',
          product_id: product?.id,
          item: product?.name,
          qty: initialStock,
          note: 'Stok awal produk',
          store_id: product?.store_id ?? storeId
        },
        req
      });
    }

    res.json({
      id: product?.id,
      initial_stock_recorded: initialStockRecorded
    });
  } catch (err) {
    if (err.code === 'image_too_large') {
      res.status(400).json({ error: 'image_too_large' });
      return;
    }
    if (err.code === 'invalid_image') {
      res.status(400).json({ error: 'invalid_image' });
      return;
    }
    if (err.statusCode === 400 && err.message === 'missing_buy_for_initial_stock') {
      res.status(400).json({ error: 'missing_buy_for_initial_stock' });
      return;
    }
    console.error('Failed to create product', err);
    res.status(500).json({ error: 'failed_to_create' });
  }
});

app.put('/api/products/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: 'invalid_id' });
    return;
  }

    const name = req.body?.name ? String(req.body.name).trim() : null;
    const nameKey = name ? normalizeItemKey(name) : null;
    const storeIdRaw = req.body?.store_id != null ? Number(req.body.store_id) : null;
    const storeId = storeIdRaw != null && Number.isFinite(storeIdRaw)
      ? storeIdRaw
      : storeIdRaw === null
        ? null
        : Number.NaN;
    const unit = req.body?.unit != null ? String(req.body.unit).trim() : null;
    const category = req.body?.category != null ? String(req.body.category).trim() : null;
    const imageData = String(req.body?.image_data || '').trim();
    const imageRemove = parseBoolean(req.body?.image_remove) === true;
    const imageUrlProvided = Object.prototype.hasOwnProperty.call(req.body || {}, 'image_url');
    const imageUrlRaw = imageUrlProvided ? String(req.body.image_url || '').trim() : null;
    const note = req.body?.note != null ? String(req.body.note).trim() : null;
    const defaultBuyPrice = coerceNumber(req.body?.default_buy_price);
    const defaultSellPrice = coerceNumber(req.body?.default_sell_price);
    const isActive = parseBoolean(req.body?.is_active);
    const payableMode = toPayableMode(req.body?.payable_mode, null);

  if (Number.isNaN(storeId)) {
    res.status(400).json({ error: 'invalid_store' });
    return;
  }

  try {
    const beforeRes = await dbPool.query(
      `SELECT * FROM ${PRODUCTS_TABLE} WHERE id = $1`,
      [id]
    );
    const before = beforeRes.rows?.[0];
    if (!before) {
      res.status(404).json({ error: 'not_found' });
      return;
    }

    let shouldUpdateImage = false;
    let nextImageUrl = null;

    if (imageRemove) {
      shouldUpdateImage = true;
      nextImageUrl = null;
    } else if (imageData) {
      shouldUpdateImage = true;
      nextImageUrl = await saveProductImage(imageData);
    } else if (imageUrlProvided) {
      shouldUpdateImage = true;
      nextImageUrl = imageUrlRaw || null;
    }

    const result = await dbPool.query(
      `
        UPDATE ${PRODUCTS_TABLE}
        SET name = COALESCE($2, name),
            name_key = COALESCE($3, name_key),
            store_id = COALESCE($4, store_id),
            unit = COALESCE($5, unit),
            category = COALESCE($6, category),
            default_buy_price = COALESCE($7, default_buy_price),
            default_sell_price = COALESCE($8, default_sell_price),
            payable_mode = COALESCE($9, payable_mode),
            note = COALESCE($10, note),
            image_url = CASE
              WHEN $11 THEN $12
              ELSE image_url
            END,
            is_active = COALESCE($13, is_active),
            updated_at = now()
        WHERE id = $1
        RETURNING *
        `,
        [
          id,
          name,
          nameKey,
          storeId,
          unit,
          category,
          defaultBuyPrice,
          defaultSellPrice,
          payableMode,
          note,
          shouldUpdateImage,
          nextImageUrl,
          isActive
      ]
    );
    const after = result.rows?.[0];

    if (shouldUpdateImage && before?.image_url && before.image_url !== nextImageUrl) {
      await removeLocalImage(before.image_url);
    }

    await recordAudit({
      userId: req.session.user?.id,
      action: 'UPDATE',
      entity: 'product',
      entityId: id,
      beforeData: before,
      afterData: after,
      req
    });

    res.json({ id: after?.id });
  } catch (err) {
    if (err.code === 'image_too_large') {
      res.status(400).json({ error: 'image_too_large' });
      return;
    }
    if (err.code === 'invalid_image') {
      res.status(400).json({ error: 'invalid_image' });
      return;
    }
    if (String(err?.message || '').includes('duplicate key')) {
      res.status(409).json({ error: 'duplicate_name' });
      return;
    }

    console.error('Failed to update product', err);
    res.status(500).json({ error: 'failed_to_update' });
  }
});

app.delete('/api/products/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: 'invalid_id' });
    return;
  }

  try {
    const beforeRes = await dbPool.query(
      `SELECT * FROM ${PRODUCTS_TABLE} WHERE id = $1`,
      [id]
    );
    const before = beforeRes.rows?.[0];
    if (!before) {
      res.status(404).json({ error: 'not_found' });
      return;
    }

    const result = await dbPool.query(
      `
      UPDATE ${PRODUCTS_TABLE}
      SET is_active = false,
          updated_at = now()
      WHERE id = $1
      RETURNING *
      `,
      [id]
    );

    const after = result.rows?.[0];
    await recordAudit({
      userId: req.session.user?.id,
      action: 'DELETE',
      entity: 'product',
      entityId: id,
      beforeData: before,
      afterData: after,
      req
    });

    res.json({ id: after?.id });
  } catch (err) {
    console.error('Failed to deactivate product', err);
    res.status(500).json({ error: 'failed_to_delete' });
  }
});

app.get('/api/transactions', async (req, res) => {
  const limitRaw = Number(req.query.limit || 100);
  const limit = Number.isFinite(limitRaw)
    ? Math.min(Math.max(limitRaw, 1), 200)
    : 100;
  const search = String(req.query.search || '').trim();
  const typeFilter = toTransactionType(req.query.type);
  const rangeFrom = normalizeIsoDatetime(req.query.from);
  const rangeTo = normalizeIsoDatetime(req.query.to);
  const dateFilter = normalizeDateOnly(req.query.date);
  const storeId = await resolveStoreId(req);

  const params = [];
  const where = [];

  if (storeId) {
    params.push(storeId);
    where.push(`t.store_id = $${params.length}`);
  }

  if (typeFilter) {
    params.push(typeFilter);
    where.push(`t.type = $${params.length}`);
  }

  if (search) {
    params.push(`%${search}%`);
    where.push(`t.item ILIKE $${params.length}`);
  }

  if (isValidDateRange(rangeFrom, rangeTo)) {
    params.push(rangeFrom, rangeTo);
    const fromIndex = params.length - 1;
    const toIndex = params.length;
    where.push(
      `t.created_at >= $${fromIndex}::timestamptz AND t.created_at < $${toIndex}::timestamptz`
    );
  } else if (dateFilter) {
    params.push(dateFilter);
    const dateIndex = params.length;
    where.push(
      `t.created_at >= $${dateIndex}::date AND t.created_at < $${dateIndex}::date + interval '1 day'`
    );
  }

  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  params.push(limit);

  try {
    const result = await dbPool.query(
      `
      SELECT
        t.id,
        t.created_at,
        t.type,
        t.item,
        t.qty,
        t.unit_price,
        t.total,
        t.buy_price,
        t.sell_price,
        t.cost_price,
        t.cost_total,
        t.note,
        t.sender,
        p.unit,
        p.payable_mode
      FROM ${DB_TABLE} t
      LEFT JOIN ${PRODUCTS_TABLE} p ON p.id = t.product_id
      ${whereClause}
      ORDER BY t.created_at DESC, t.id DESC
      LIMIT $${params.length}
      `,
      params
    );

    res.json({ data: result.rows });
  } catch (err) {
    console.error('Failed to load transactions', err);
    res.status(500).json({ error: 'failed_to_load' });
  }
});

app.post('/api/transactions', async (req, res) => {
  const type = toTransactionType(req.body?.type);
  const qty = toNumber(req.body?.qty);
  const note = String(req.body?.note || '').trim() || null;
  const buyPriceInput = coerceNumber(req.body?.buy_price);
  const sellPriceInput = coerceNumber(req.body?.sell_price);
  const productIdRaw = Number(req.body?.product_id ?? req.body?.productId);
  const itemRaw = String(req.body?.item || req.body?.name || '').trim();
  let storeId = await resolveStoreId(req);

  if (!type) {
    res.status(400).json({ error: 'invalid_type' });
    return;
  }

  if (!Number.isFinite(qty) || qty <= 0) {
    res.status(400).json({ error: 'invalid_qty' });
    return;
  }

  if (!storeId) {
    res.status(400).json({ error: 'missing_store' });
    return;
  }

  if (!productIdRaw && !itemRaw) {
    res.status(400).json({ error: 'missing_item' });
    return;
  }

  if (type === 'IN' && (buyPriceInput === null || buyPriceInput <= 0)) {
    res.status(400).json({ error: 'missing_buy' });
    return;
  }

  let product = null;
  let itemName = itemRaw;
  let productId = null;

  try {
    if (Number.isFinite(productIdRaw) && productIdRaw > 0) {
      const productRes = await dbPool.query(
        `
        SELECT id, name, store_id, default_buy_price, default_sell_price,
               last_buy_price, last_sell_price, payable_mode, is_active
        FROM ${PRODUCTS_TABLE}
        WHERE id = $1
        LIMIT 1
        `,
        [productIdRaw]
      );
      product = productRes.rows?.[0] || null;
      if (!product) {
        res.status(404).json({ error: 'product_not_found' });
        return;
      }
      const productStoreId = Number(product.store_id);
      const hasProductStore =
        Number.isFinite(productStoreId) && productStoreId > 0;
      if (hasProductStore && storeId && productStoreId !== storeId) {
        res.status(400).json({ error: 'store_mismatch' });
        return;
      }
      storeId = hasProductStore ? productStoreId : storeId;
      itemName = product.name;
      productId = product.id;
    } else {
      const nameKey = normalizeItemKey(itemName);
      if (!nameKey) {
        res.status(400).json({ error: 'missing_item' });
        return;
      }

      const existingRes = await dbPool.query(
        `
        SELECT id, name, store_id, default_buy_price, default_sell_price,
               last_buy_price, last_sell_price, payable_mode, is_active
        FROM ${PRODUCTS_TABLE}
        WHERE store_id = $1 AND name_key = $2
        LIMIT 1
        `,
        [storeId, nameKey]
      );
      product = existingRes.rows?.[0] || null;

      if (!product) {
        if (type === 'OUT' && (sellPriceInput === null || sellPriceInput <= 0)) {
          res.status(400).json({ error: 'missing_sell' });
          return;
        }

        const insertRes = await dbPool.query(
          `
          INSERT INTO ${PRODUCTS_TABLE}
            (name, name_key, store_id, default_buy_price, default_sell_price,
             last_buy_price, last_sell_price, payable_mode, is_active, updated_at)
          VALUES ($1,$2,$3,$4,$5,$4,$5,'credit',true,now())
          RETURNING id, name, store_id, default_buy_price, default_sell_price,
                    last_buy_price, last_sell_price, payable_mode, is_active
          `,
          [itemName, nameKey, storeId, buyPriceInput, sellPriceInput]
        );
        product = insertRes.rows?.[0] || null;
      }

      if (!product) {
        res.status(500).json({ error: 'product_failed' });
        return;
      }

      productId = product.id;
      itemName = product.name;
    }

    const sellPrice =
      type === 'OUT'
        ? pickPrice(sellPriceInput, product.last_sell_price, product.default_sell_price)
        : sellPriceInput;
    if (type === 'OUT' && (sellPrice == null || Number.isNaN(sellPrice))) {
      res.status(400).json({ error: 'missing_sell' });
      return;
    }

    const costPrice =
      type === 'OUT'
        ? pickPrice(product.last_buy_price, product.default_buy_price)
        : type === 'IN'
          ? buyPriceInput
          : null;

    if (
      type === 'OUT' &&
      (costPrice == null || Number.isNaN(costPrice)) &&
      String(product.payable_mode || 'credit') !== 'cash'
    ) {
      res.status(400).json({ error: 'missing_cost' });
      return;
    }

    const unitPrice =
      type === 'IN' ? buyPriceInput : type === 'OUT' ? sellPrice : 0;
    const total = Number.isFinite(unitPrice) ? unitPrice * qty : 0;
    const costTotal =
      costPrice != null && !Number.isNaN(costPrice) ? costPrice * qty : null;

    const transactionRes = await dbPool.query(
      `
      INSERT INTO ${DB_TABLE}
        (type, product_id, store_id, item, qty, unit_price, total,
         buy_price, sell_price, cost_price, cost_total, note, sender, raw)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      RETURNING id
      `,
      [
        type,
        productId,
        storeId ?? null,
        itemName,
        qty,
        unitPrice,
        total,
        type === 'IN' ? buyPriceInput : null,
        type === 'OUT' ? sellPrice : sellPriceInput ?? null,
        costPrice,
        costTotal,
        note,
        req.session.user?.username || 'web',
        'web'
      ]
    );

    const transactionId = transactionRes.rows?.[0]?.id || null;

    const nextBuyPrice = type === 'IN' ? buyPriceInput : null;
    const nextSellPrice = type === 'DAMAGE' ? null : sellPrice;
    if (nextBuyPrice != null || nextSellPrice != null) {
      await dbPool.query(
        `
        UPDATE ${PRODUCTS_TABLE}
        SET last_buy_price = COALESCE($2, last_buy_price),
            default_buy_price = COALESCE(default_buy_price, $2),
            last_sell_price = COALESCE($3, last_sell_price),
            default_sell_price = COALESCE(default_sell_price, $3),
            updated_at = now()
        WHERE id = $1
        `,
        [productId, nextBuyPrice, nextSellPrice]
      );
    }

    if (
      dbPool &&
      transactionId &&
      type === 'OUT' &&
      costPrice != null &&
      costTotal != null &&
      !Number.isNaN(costPrice) &&
      !Number.isNaN(costTotal) &&
      String(product.payable_mode || 'credit') !== 'cash'
    ) {
      try {
        await createPayableEntry(dbPool, {
          transactionId,
          productId,
          item: itemName,
          qty,
          costPrice,
          amount: costTotal,
          storeId
        });
      } catch (err) {
        console.error('Failed to create payable entry', err);
      }
    }

    await recordAudit({
      userId: req.session.user?.id,
      action: 'CREATE',
      entity: 'transaction',
      entityId: transactionId,
      afterData: {
        type,
        item: itemName,
        qty,
        unit_price: unitPrice,
        total,
        note,
        store_id: storeId
      },
      req
    });

    res.json({ id: transactionId });
  } catch (err) {
    console.error('Failed to create transaction', err);
    res.status(500).json({ error: 'failed_to_create' });
  }
});

app.get('/api/users', async (req, res) => {
  try {
    const result = await dbPool.query(
      `
      SELECT
        u.id,
        u.username,
        u.role,
        u.is_active,
        u.created_at,
        u.last_login_at,
        u.default_store_id,
        s.name AS default_store_name,
        s.is_active AS default_store_active
      FROM ${USERS_TABLE} u
      LEFT JOIN ${STORES_TABLE} s ON s.id = u.default_store_id
      ORDER BY u.is_active DESC, u.username ASC
      `
    );
    res.json({ data: result.rows });
  } catch (err) {
    console.error('Failed to load users', err);
    res.status(500).json({ error: 'failed_to_load' });
  }
});

app.post('/api/users', async (req, res) => {
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');
  const role = toRole(req.body?.role, 'staff');
  const isActive = parseBoolean(req.body?.is_active);
  const defaultStoreInput =
    req.body?.default_store_id ?? req.body?.defaultStoreId;

  if (!username || !password) {
    res.status(400).json({ error: 'missing_fields' });
    return;
  }

  if (!role) {
    res.status(400).json({ error: 'invalid_role' });
    return;
  }

  if (password.length < 6) {
    res.status(400).json({ error: 'password_too_short' });
    return;
  }

  try {
    const { value: defaultStoreId, error: storeError } =
      await resolveUserDefaultStoreId(defaultStoreInput);
    if (storeError) {
      if (storeError === 'store_lookup_failed') {
        res.status(500).json({ error: 'store_lookup_failed' });
      } else if (storeError === 'store_not_found') {
        res.status(404).json({ error: 'store_not_found' });
      } else {
        res.status(400).json({ error: storeError });
      }
      return;
    }

    const hash = await bcrypt.hash(password, 10);
    const result = await dbPool.query(
      `
      INSERT INTO ${USERS_TABLE}
        (username, password_hash, role, is_active, default_store_id, created_at)
      VALUES ($1,$2,$3,$4,$5,now())
      RETURNING id, username, role, is_active, default_store_id, created_at, last_login_at
      `,
      [username, hash, role, isActive === null ? true : isActive, defaultStoreId]
    );
    const user = result.rows?.[0];
    if (user) {
      await recordAudit({
        userId: req.session.user?.id,
        action: 'CREATE',
        entity: 'user',
        entityId: user.id,
        afterData: sanitizeUserRow(user),
        req
      });
    }
    res.json({ id: user?.id });
  } catch (err) {
    if (String(err?.message || '').includes('duplicate key')) {
      res.status(409).json({ error: 'duplicate_username' });
      return;
    }
    console.error('Failed to create user', err);
    res.status(500).json({ error: 'failed_to_create' });
  }
});

app.put('/api/users/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: 'invalid_id' });
    return;
  }

  const username = req.body?.username != null ? String(req.body.username).trim() : null;
  const role = toRole(req.body?.role, null);
  const isActive = parseBoolean(req.body?.is_active);
  const password = req.body?.password ? String(req.body.password) : '';
  const defaultStoreInput =
    req.body?.default_store_id ?? req.body?.defaultStoreId;
  const hasDefaultStoreInput =
    Object.prototype.hasOwnProperty.call(req.body ?? {}, 'default_store_id') ||
    Object.prototype.hasOwnProperty.call(req.body ?? {}, 'defaultStoreId');
  let defaultStoreId = null;

  if (req.session.user?.id === id) {
    if (isActive === false) {
      res.status(400).json({ error: 'cannot_disable_self' });
      return;
    }
    if (role && role !== 'admin') {
      res.status(400).json({ error: 'cannot_downgrade_self' });
      return;
    }
  }

  if (role === null && req.body?.role != null) {
    res.status(400).json({ error: 'invalid_role' });
    return;
  }

  if (password && password.length < 6) {
    res.status(400).json({ error: 'password_too_short' });
    return;
  }

  try {
    if (hasDefaultStoreInput) {
      const { value, error: storeError } =
        await resolveUserDefaultStoreId(defaultStoreInput);
      if (storeError) {
        if (storeError === 'store_lookup_failed') {
          res.status(500).json({ error: 'store_lookup_failed' });
        } else if (storeError === 'store_not_found') {
          res.status(404).json({ error: 'store_not_found' });
        } else {
          res.status(400).json({ error: storeError });
        }
        return;
      }
      defaultStoreId = value;
    }

    const beforeRes = await dbPool.query(
      `SELECT * FROM ${USERS_TABLE} WHERE id = $1`,
      [id]
    );
    const before = beforeRes.rows?.[0];
    if (!before) {
      res.status(404).json({ error: 'not_found' });
      return;
    }

    const fields = [];
    const params = [id];
    let idx = 2;

    if (username) {
      fields.push(`username = $${idx}`);
      params.push(username);
      idx += 1;
    }
    if (role) {
      fields.push(`role = $${idx}`);
      params.push(role);
      idx += 1;
    }
    if (isActive !== null) {
      fields.push(`is_active = $${idx}`);
      params.push(isActive);
      idx += 1;
    }
    if (hasDefaultStoreInput) {
      fields.push(`default_store_id = $${idx}`);
      params.push(defaultStoreId);
      idx += 1;
    }
    if (password) {
      const hash = await bcrypt.hash(password, 10);
      fields.push(`password_hash = $${idx}`);
      params.push(hash);
      idx += 1;
    }

    if (!fields.length) {
      res.status(400).json({ error: 'no_updates' });
      return;
    }

    const result = await dbPool.query(
      `
      UPDATE ${USERS_TABLE}
      SET ${fields.join(', ')}
      WHERE id = $1
      RETURNING id, username, role, is_active, default_store_id, created_at, last_login_at
      `,
      params
    );

    const after = result.rows?.[0];
    await recordAudit({
      userId: req.session.user?.id,
      action: 'UPDATE',
      entity: 'user',
      entityId: id,
      beforeData: sanitizeUserRow(before),
      afterData: sanitizeUserRow(after),
      req
    });

    res.json({ id: after?.id });
  } catch (err) {
    if (String(err?.message || '').includes('duplicate key')) {
      res.status(409).json({ error: 'duplicate_username' });
      return;
    }
    console.error('Failed to update user', err);
    res.status(500).json({ error: 'failed_to_update' });
  }
});

app.delete('/api/users/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: 'invalid_id' });
    return;
  }

  if (req.session.user?.id === id) {
    res.status(400).json({ error: 'cannot_delete_self' });
    return;
  }

  try {
    const beforeRes = await dbPool.query(
      `SELECT * FROM ${USERS_TABLE} WHERE id = $1`,
      [id]
    );
    const before = beforeRes.rows?.[0];
    if (!before) {
      res.status(404).json({ error: 'not_found' });
      return;
    }

    const result = await dbPool.query(
      `
      UPDATE ${USERS_TABLE}
      SET is_active = false
      WHERE id = $1
      RETURNING id, username, role, is_active, created_at, last_login_at
      `,
      [id]
    );
    const after = result.rows?.[0];

    await recordAudit({
      userId: req.session.user?.id,
      action: 'DELETE',
      entity: 'user',
      entityId: id,
      beforeData: sanitizeUserRow(before),
      afterData: sanitizeUserRow(after),
      req
    });

    res.json({ id: after?.id });
  } catch (err) {
    console.error('Failed to deactivate user', err);
    res.status(500).json({ error: 'failed_to_delete' });
  }
});

app.get('/api/payables/summary', async (req, res) => {
  try {
    const storeId = await resolveStoreId(req);
    const summary = await getPayableBalance(
      dbPool,
      storeId
    );
    res.json(summary || { totalPayable: 0, totalPaid: 0, balance: 0 });
  } catch (err) {
    console.error('Failed to load payables summary', err);
    res.status(500).json({ error: 'failed_to_load' });
  }
});

app.get('/api/payables/products', async (req, res) => {
  try {
    const storeId = await resolveStoreId(req);
    const params = [];
    const where = storeId ? `WHERE store_id = $1` : '';
    if (storeId) params.push(storeId);

    const result = await dbPool.query(
      `
      SELECT product_id, item, unit, payable_total, paid_total, balance
      FROM ${PAYABLE_SUMMARY_VIEW}
      ${where}
      ORDER BY balance DESC, item ASC
      `
      ,
      params
    );

    res.json({ data: result.rows });
  } catch (err) {
    console.error('Failed to load payables products', err);
    res.status(500).json({ error: 'failed_to_load' });
  }
});

app.get('/api/payables/payments', async (req, res) => {
  const limit = Number(req.query.limit || 50);
  try {
    const storeId = await resolveStoreId(req);
    const params = [];
    const where = storeId ? `WHERE store_id = $1` : '';
    if (storeId) params.push(storeId);
    params.push(Number.isFinite(limit) ? limit : 50);

    const result = await dbPool.query(
      `
      SELECT id, created_at, amount, remaining_amount, note
      FROM ${PAYABLE_PAYMENTS_TABLE}
      ${where}
      ORDER BY created_at DESC, id DESC
      LIMIT $${params.length}
      `,
      params
    );

    res.json({ data: result.rows });
  } catch (err) {
    console.error('Failed to load payables payments', err);
    res.status(500).json({ error: 'failed_to_load' });
  }
});

app.post('/api/payables/payments', async (req, res) => {
  const amount = coerceNumber(req.body?.amount);
  const note = String(req.body?.note || '').trim();
  const storeId = await resolveStoreId(req);

  if (!amount || amount <= 0) {
    res.status(400).json({ error: 'invalid_amount' });
    return;
  }

  try {
    const result = await applyPayment(dbPool, {
      amount,
      sender: null,
      raw: null,
      note,
      storeId
    });
    const summary = await getPayableBalance(dbPool, storeId);
    await recordAudit({
      userId: req.session.user?.id,
      action: 'CREATE',
      entity: 'payable_payment',
      entityId: result?.paymentId,
      afterData: { amount, remaining: result?.remaining || 0, note },
      req
    });
    res.json({ result, summary });
  } catch (err) {
    console.error('Failed to create payment', err);
    res.status(500).json({ error: 'failed_to_create' });
  }
});

app.get('/api/audit-logs', async (req, res) => {
  const limit = Number(req.query.limit || 50);

  try {
    const result = await dbPool.query(
      `
      SELECT
        a.id,
        a.created_at,
        a.action,
        a.entity,
        a.entity_id,
        a.before_data,
        a.after_data,
        u.username
      FROM ${AUDIT_LOGS_TABLE} a
      LEFT JOIN ${USERS_TABLE} u ON u.id = a.user_id
      ORDER BY a.created_at DESC, a.id DESC
      LIMIT $1
      `,
      [Number.isFinite(limit) ? limit : 50]
    );

    res.json({ data: result.rows });
  } catch (err) {
    console.error('Failed to load audit logs', err);
    res.status(500).json({ error: 'failed_to_load' });
  }
});

app.listen(port, () => {
  console.log(`Web dashboard ready: http://localhost:${port}`);
});
