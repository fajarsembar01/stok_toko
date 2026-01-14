import { Pool } from 'pg';

const DATABASE_URL = process.env.DATABASE_URL || '';
const DB_TABLE_RAW = process.env.DB_TABLE || 'transactions';
const DB_TABLE = DB_TABLE_RAW.replace(/[^a-zA-Z0-9_]/g, '') || 'transactions';
const STORES_TABLE_RAW = process.env.STORES_TABLE || 'stores';
const STORES_TABLE =
  STORES_TABLE_RAW.replace(/[^a-zA-Z0-9_]/g, '') || 'stores';
const PRODUCTS_TABLE_RAW = process.env.PRODUCTS_TABLE || 'products';
const PRODUCTS_TABLE =
  PRODUCTS_TABLE_RAW.replace(/[^a-zA-Z0-9_]/g, '') || 'products';
const DB_SUMMARY_VIEW_RAW = process.env.DB_SUMMARY_VIEW || 'inventory_summary';
const DB_SUMMARY_VIEW =
  DB_SUMMARY_VIEW_RAW.replace(/[^a-zA-Z0-9_]/g, '') || 'inventory_summary';
const PAYABLE_ENTRIES_TABLE_RAW =
  process.env.PAYABLE_ENTRIES_TABLE || 'payable_entries';
const PAYABLE_ENTRIES_TABLE =
  PAYABLE_ENTRIES_TABLE_RAW.replace(/[^a-zA-Z0-9_]/g, '') || 'payable_entries';
const PAYABLE_PAYMENTS_TABLE_RAW =
  process.env.PAYABLE_PAYMENTS_TABLE || 'payable_payments';
const PAYABLE_PAYMENTS_TABLE =
  PAYABLE_PAYMENTS_TABLE_RAW.replace(/[^a-zA-Z0-9_]/g, '') || 'payable_payments';
const PAYABLE_ALLOCATIONS_TABLE_RAW =
  process.env.PAYABLE_ALLOCATIONS_TABLE || 'payable_allocations';
const PAYABLE_ALLOCATIONS_TABLE =
  PAYABLE_ALLOCATIONS_TABLE_RAW.replace(/[^a-zA-Z0-9_]/g, '') ||
  'payable_allocations';
const PAYABLE_SUMMARY_VIEW_RAW =
  process.env.PAYABLE_SUMMARY_VIEW || 'payable_summary';
const PAYABLE_SUMMARY_VIEW =
  PAYABLE_SUMMARY_VIEW_RAW.replace(/[^a-zA-Z0-9_]/g, '') || 'payable_summary';
const USERS_TABLE_RAW = process.env.USERS_TABLE || 'web_users';
const USERS_TABLE =
  USERS_TABLE_RAW.replace(/[^a-zA-Z0-9_]/g, '') || 'web_users';
const AUDIT_LOGS_TABLE_RAW = process.env.AUDIT_LOGS_TABLE || 'audit_logs';
const AUDIT_LOGS_TABLE =
  AUDIT_LOGS_TABLE_RAW.replace(/[^a-zA-Z0-9_]/g, '') || 'audit_logs';
const BUYER_ORDERS_TABLE_RAW =
  process.env.BUYER_ORDERS_TABLE || 'buyer_orders';
const BUYER_ORDERS_TABLE =
  BUYER_ORDERS_TABLE_RAW.replace(/[^a-zA-Z0-9_]/g, '') || 'buyer_orders';
const BUYER_ORDER_ITEMS_TABLE_RAW =
  process.env.BUYER_ORDER_ITEMS_TABLE || 'buyer_order_items';
const BUYER_ORDER_ITEMS_TABLE =
  BUYER_ORDER_ITEMS_TABLE_RAW.replace(/[^a-zA-Z0-9_]/g, '') ||
  'buyer_order_items';
const OUTBOUND_MESSAGES_TABLE_RAW =
  process.env.OUTBOUND_MESSAGES_TABLE || 'outbound_messages';
const OUTBOUND_MESSAGES_TABLE =
  OUTBOUND_MESSAGES_TABLE_RAW.replace(/[^a-zA-Z0-9_]/g, '') ||
  'outbound_messages';
const PG_SSL = process.env.PG_SSL === 'true';

function normalizeItemKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function createPool() {
  if (!DATABASE_URL) return null;
  return new Pool({
    connectionString: DATABASE_URL,
    ssl: PG_SSL ? { rejectUnauthorized: false } : undefined
  });
}

async function ensureDatabase(pool) {
  if (!pool) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${STORES_TABLE} (
      id bigserial PRIMARY KEY,
      name text NOT NULL,
      slug text NOT NULL UNIQUE,
      category text,
      description text,
      wa_trigger text UNIQUE,
      is_active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  await pool.query(`
    ALTER TABLE ${STORES_TABLE}
      ADD COLUMN IF NOT EXISTS category text,
      ADD COLUMN IF NOT EXISTS description text,
      ADD COLUMN IF NOT EXISTS wa_trigger text UNIQUE,
      ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
      ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
      ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now()
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${PRODUCTS_TABLE} (
      id bigserial PRIMARY KEY,
      name text NOT NULL,
      name_key text NOT NULL,
      store_id bigint,
      unit text,
      default_buy_price numeric,
      default_sell_price numeric,
      last_buy_price numeric,
      last_sell_price numeric,
      payable_mode text NOT NULL DEFAULT 'credit',
      note text,
      is_active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${DB_TABLE} (
      id bigserial PRIMARY KEY,
      created_at timestamptz NOT NULL DEFAULT now(),
      type text NOT NULL,
      product_id bigint,
      store_id bigint,
      item text NOT NULL,
      qty numeric NOT NULL,
      unit_price numeric NOT NULL,
      total numeric NOT NULL,
      buy_price numeric,
      sell_price numeric,
      note text,
      sender text,
      raw text
    )
  `);

  await pool.query(`
    ALTER TABLE ${PRODUCTS_TABLE}
      ADD COLUMN IF NOT EXISTS store_id bigint,
      ADD COLUMN IF NOT EXISTS unit text,
      ADD COLUMN IF NOT EXISTS default_buy_price numeric,
      ADD COLUMN IF NOT EXISTS default_sell_price numeric,
      ADD COLUMN IF NOT EXISTS last_buy_price numeric,
      ADD COLUMN IF NOT EXISTS last_sell_price numeric,
      ADD COLUMN IF NOT EXISTS payable_mode text NOT NULL DEFAULT 'credit',
      ADD COLUMN IF NOT EXISTS note text,
      ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
      ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
      ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now()
  `);

  await pool.query(`
    ALTER TABLE ${DB_TABLE}
      ADD COLUMN IF NOT EXISTS product_id bigint,
      ADD COLUMN IF NOT EXISTS store_id bigint,
      ADD COLUMN IF NOT EXISTS item text,
      ADD COLUMN IF NOT EXISTS buy_price numeric,
      ADD COLUMN IF NOT EXISTS sell_price numeric,
      ADD COLUMN IF NOT EXISTS cost_price numeric,
      ADD COLUMN IF NOT EXISTS cost_total numeric
  `);

  const fkName = `${DB_TABLE}_product_id_fkey`;
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '${fkName}') THEN
        ALTER TABLE ${DB_TABLE}
          ADD CONSTRAINT ${fkName}
          FOREIGN KEY (product_id)
          REFERENCES ${PRODUCTS_TABLE}(id)
          ON DELETE SET NULL;
      END IF;
    END $$;
  `);

  const productStoreFk = `${PRODUCTS_TABLE}_store_id_fkey`;
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '${productStoreFk}') THEN
        ALTER TABLE ${PRODUCTS_TABLE}
          ADD CONSTRAINT ${productStoreFk}
          FOREIGN KEY (store_id)
          REFERENCES ${STORES_TABLE}(id)
          ON DELETE SET NULL;
      END IF;
    END $$;
  `);

  const txStoreFk = `${DB_TABLE}_store_id_fkey`;
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '${txStoreFk}') THEN
        ALTER TABLE ${DB_TABLE}
          ADD CONSTRAINT ${txStoreFk}
          FOREIGN KEY (store_id)
          REFERENCES ${STORES_TABLE}(id)
          ON DELETE SET NULL;
      END IF;
    END $$;
  `);

  const nameKeyConstraint = `${PRODUCTS_TABLE}_name_key_key`;
  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '${nameKeyConstraint}') THEN
        ALTER TABLE ${PRODUCTS_TABLE} DROP CONSTRAINT ${nameKeyConstraint};
      END IF;
    END $$;
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS ${PRODUCTS_TABLE}_store_name_key_uq
    ON ${PRODUCTS_TABLE} (store_id, name_key)
  `);

  const defaultStores = [
    {
      name: 'Toko Dewi',
      slug: 'dewi',
      category: 'toko kelontong sembako',
      description: 'Toko kelontong sembako',
      wa_trigger: 'dewi'
    },
    {
      name: 'Toko Dina',
      slug: 'dina',
      category: 'toko alat2 pertanian',
      description: 'Toko alat2 pertanian',
      wa_trigger: 'dina'
    }
  ];

  for (const store of defaultStores) {
    await pool.query(
      `
      INSERT INTO ${STORES_TABLE}
        (name, slug, category, description, wa_trigger, is_active, updated_at)
      VALUES ($1,$2,$3,$4,$5,true,now())
      ON CONFLICT (slug) DO UPDATE
      SET name = COALESCE(${STORES_TABLE}.name, EXCLUDED.name),
          category = COALESCE(${STORES_TABLE}.category, EXCLUDED.category),
          description = COALESCE(${STORES_TABLE}.description, EXCLUDED.description),
          wa_trigger = COALESCE(${STORES_TABLE}.wa_trigger, EXCLUDED.wa_trigger),
          updated_at = now()
      `,
      [
        store.name,
        store.slug,
        store.category,
        store.description,
        store.wa_trigger
      ]
    );
  }

  const defaultStoreSlug = (process.env.DEFAULT_STORE_SLUG || 'dewi').toLowerCase();
  const defaultStoreRes = await pool.query(
    `SELECT id FROM ${STORES_TABLE} WHERE slug = $1 LIMIT 1`,
    [defaultStoreSlug]
  );
  const defaultStoreIdRaw = defaultStoreRes.rows?.[0]?.id;
  const defaultStoreId = Number.isFinite(Number(defaultStoreIdRaw))
    ? Number(defaultStoreIdRaw)
    : null;

  await pool.query(
    `CREATE INDEX IF NOT EXISTS ${DB_TABLE}_item_idx ON ${DB_TABLE} (item)`
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS ${DB_TABLE}_product_idx ON ${DB_TABLE} (product_id)`
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS ${DB_TABLE}_created_idx ON ${DB_TABLE} (created_at)`
  );

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${PAYABLE_ENTRIES_TABLE} (
      id bigserial PRIMARY KEY,
      created_at timestamptz NOT NULL DEFAULT now(),
      transaction_id bigint NOT NULL,
      product_id bigint,
      item text NOT NULL,
      qty numeric NOT NULL,
      cost_price numeric NOT NULL,
      amount numeric NOT NULL,
      amount_paid numeric NOT NULL DEFAULT 0
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${PAYABLE_PAYMENTS_TABLE} (
      id bigserial PRIMARY KEY,
      created_at timestamptz NOT NULL DEFAULT now(),
      store_id bigint,
      amount numeric NOT NULL,
      remaining_amount numeric NOT NULL,
      note text,
      sender text,
      raw text
    )
  `);

  await pool.query(`
    ALTER TABLE ${PAYABLE_PAYMENTS_TABLE}
      ADD COLUMN IF NOT EXISTS store_id bigint
  `);

  const paymentStoreFk = `${PAYABLE_PAYMENTS_TABLE}_store_id_fkey`;
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '${paymentStoreFk}') THEN
        ALTER TABLE ${PAYABLE_PAYMENTS_TABLE}
          ADD CONSTRAINT ${paymentStoreFk}
          FOREIGN KEY (store_id)
          REFERENCES ${STORES_TABLE}(id)
          ON DELETE SET NULL;
      END IF;
    END $$;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${PAYABLE_ALLOCATIONS_TABLE} (
      id bigserial PRIMARY KEY,
      created_at timestamptz NOT NULL DEFAULT now(),
      payment_id bigint NOT NULL,
      entry_id bigint NOT NULL,
      amount numeric NOT NULL
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${USERS_TABLE} (
      id bigserial PRIMARY KEY,
      username text NOT NULL UNIQUE,
      password_hash text NOT NULL,
      role text NOT NULL DEFAULT 'admin',
      created_at timestamptz NOT NULL DEFAULT now(),
      last_login_at timestamptz
    )
  `);

  await pool.query(`
    ALTER TABLE ${USERS_TABLE}
    ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${AUDIT_LOGS_TABLE} (
      id bigserial PRIMARY KEY,
      created_at timestamptz NOT NULL DEFAULT now(),
      user_id bigint,
      action text NOT NULL,
      entity text NOT NULL,
      entity_id text,
      before_data jsonb,
      after_data jsonb,
      ip_address text
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${BUYER_ORDERS_TABLE} (
      id bigserial PRIMARY KEY,
      created_at timestamptz NOT NULL DEFAULT now(),
      store_id bigint,
      buyer_wa text NOT NULL,
      address_block text NOT NULL,
      address_number text NOT NULL,
      subtotal numeric NOT NULL,
      shipping_fee numeric NOT NULL,
      total numeric NOT NULL,
      status text NOT NULL DEFAULT 'new',
      items_count integer NOT NULL DEFAULT 0
    )
  `);

  await pool.query(`
    ALTER TABLE ${BUYER_ORDERS_TABLE}
      ADD COLUMN IF NOT EXISTS store_id bigint
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${BUYER_ORDER_ITEMS_TABLE} (
      id bigserial PRIMARY KEY,
      order_id bigint NOT NULL,
      product_id bigint,
      item_name text NOT NULL,
      qty numeric NOT NULL,
      unit_price numeric NOT NULL,
      total numeric NOT NULL
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${OUTBOUND_MESSAGES_TABLE} (
      id bigserial PRIMARY KEY,
      created_at timestamptz NOT NULL DEFAULT now(),
      target_jid text,
      message text NOT NULL,
      status text NOT NULL DEFAULT 'pending',
      attempts integer NOT NULL DEFAULT 0,
      last_error text,
      sent_at timestamptz
    )
  `);

  const auditUserFk = `${AUDIT_LOGS_TABLE}_user_id_fkey`;
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '${auditUserFk}') THEN
        ALTER TABLE ${AUDIT_LOGS_TABLE}
          ADD CONSTRAINT ${auditUserFk}
          FOREIGN KEY (user_id)
          REFERENCES ${USERS_TABLE}(id)
          ON DELETE SET NULL;
      END IF;
    END $$;
  `);

  const orderItemFk = `${BUYER_ORDER_ITEMS_TABLE}_order_id_fkey`;
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '${orderItemFk}') THEN
        ALTER TABLE ${BUYER_ORDER_ITEMS_TABLE}
          ADD CONSTRAINT ${orderItemFk}
          FOREIGN KEY (order_id)
          REFERENCES ${BUYER_ORDERS_TABLE}(id)
          ON DELETE CASCADE;
      END IF;
    END $$;
  `);

  const orderItemProductFk = `${BUYER_ORDER_ITEMS_TABLE}_product_id_fkey`;
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '${orderItemProductFk}') THEN
        ALTER TABLE ${BUYER_ORDER_ITEMS_TABLE}
          ADD CONSTRAINT ${orderItemProductFk}
          FOREIGN KEY (product_id)
          REFERENCES ${PRODUCTS_TABLE}(id)
          ON DELETE SET NULL;
      END IF;
    END $$;
  `);

  const orderStoreFk = `${BUYER_ORDERS_TABLE}_store_id_fkey`;
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '${orderStoreFk}') THEN
        ALTER TABLE ${BUYER_ORDERS_TABLE}
          ADD CONSTRAINT ${orderStoreFk}
          FOREIGN KEY (store_id)
          REFERENCES ${STORES_TABLE}(id)
          ON DELETE SET NULL;
      END IF;
    END $$;
  `);

  if (defaultStoreId) {
    await pool.query(
      `UPDATE ${PRODUCTS_TABLE} SET store_id = $1 WHERE store_id IS NULL`,
      [defaultStoreId]
    );
    await pool.query(
      `
      UPDATE ${DB_TABLE} t
      SET store_id = p.store_id
      FROM ${PRODUCTS_TABLE} p
      WHERE t.store_id IS NULL AND t.product_id = p.id
      `
    );
    await pool.query(
      `
      UPDATE ${DB_TABLE}
      SET store_id = $1
      WHERE store_id IS NULL
      `,
      [defaultStoreId]
    );
    await pool.query(
      `UPDATE ${PAYABLE_PAYMENTS_TABLE} SET store_id = $1 WHERE store_id IS NULL`,
      [defaultStoreId]
    );
    await pool.query(
      `UPDATE ${BUYER_ORDERS_TABLE} SET store_id = $1 WHERE store_id IS NULL`,
      [defaultStoreId]
    );
  }

  const payableTxFk = `${PAYABLE_ENTRIES_TABLE}_transaction_id_fkey`;
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '${payableTxFk}') THEN
        ALTER TABLE ${PAYABLE_ENTRIES_TABLE}
          ADD CONSTRAINT ${payableTxFk}
          FOREIGN KEY (transaction_id)
          REFERENCES ${DB_TABLE}(id)
          ON DELETE CASCADE;
      END IF;
    END $$;
  `);

  const payableProductFk = `${PAYABLE_ENTRIES_TABLE}_product_id_fkey`;
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '${payableProductFk}') THEN
        ALTER TABLE ${PAYABLE_ENTRIES_TABLE}
          ADD CONSTRAINT ${payableProductFk}
          FOREIGN KEY (product_id)
          REFERENCES ${PRODUCTS_TABLE}(id)
          ON DELETE SET NULL;
      END IF;
    END $$;
  `);

  const allocationPaymentFk = `${PAYABLE_ALLOCATIONS_TABLE}_payment_id_fkey`;
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '${allocationPaymentFk}') THEN
        ALTER TABLE ${PAYABLE_ALLOCATIONS_TABLE}
          ADD CONSTRAINT ${allocationPaymentFk}
          FOREIGN KEY (payment_id)
          REFERENCES ${PAYABLE_PAYMENTS_TABLE}(id)
          ON DELETE CASCADE;
      END IF;
    END $$;
  `);

  const allocationEntryFk = `${PAYABLE_ALLOCATIONS_TABLE}_entry_id_fkey`;
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '${allocationEntryFk}') THEN
        ALTER TABLE ${PAYABLE_ALLOCATIONS_TABLE}
          ADD CONSTRAINT ${allocationEntryFk}
          FOREIGN KEY (entry_id)
          REFERENCES ${PAYABLE_ENTRIES_TABLE}(id)
          ON DELETE CASCADE;
      END IF;
    END $$;
  `);

  await pool.query(
    `CREATE INDEX IF NOT EXISTS ${PAYABLE_ENTRIES_TABLE}_tx_idx ON ${PAYABLE_ENTRIES_TABLE} (transaction_id)`
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS ${PAYABLE_ENTRIES_TABLE}_product_idx ON ${PAYABLE_ENTRIES_TABLE} (product_id)`
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS ${PAYABLE_ENTRIES_TABLE}_created_idx ON ${PAYABLE_ENTRIES_TABLE} (created_at)`
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS ${PAYABLE_PAYMENTS_TABLE}_created_idx ON ${PAYABLE_PAYMENTS_TABLE} (created_at)`
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS ${PAYABLE_ALLOCATIONS_TABLE}_payment_idx ON ${PAYABLE_ALLOCATIONS_TABLE} (payment_id)`
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS ${PAYABLE_ALLOCATIONS_TABLE}_entry_idx ON ${PAYABLE_ALLOCATIONS_TABLE} (entry_id)`
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS ${AUDIT_LOGS_TABLE}_user_idx ON ${AUDIT_LOGS_TABLE} (user_id)`
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS ${AUDIT_LOGS_TABLE}_entity_idx ON ${AUDIT_LOGS_TABLE} (entity, entity_id)`
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS ${AUDIT_LOGS_TABLE}_created_idx ON ${AUDIT_LOGS_TABLE} (created_at)`
  );

  await pool.query(
    `UPDATE ${PRODUCTS_TABLE} SET is_active = true WHERE is_active IS NULL`
  );
  await pool.query(
    `UPDATE ${PRODUCTS_TABLE} SET created_at = now() WHERE created_at IS NULL`
  );
  await pool.query(
    `UPDATE ${PRODUCTS_TABLE} SET updated_at = now() WHERE updated_at IS NULL`
  );

  if (defaultStoreId) {
    await pool.query(
      `
      INSERT INTO ${PRODUCTS_TABLE} (name, name_key, store_id)
      SELECT DISTINCT item,
        LOWER(REGEXP_REPLACE(TRIM(item), '\\s+', ' ', 'g')),
        $1::bigint
      FROM ${DB_TABLE}
      WHERE item IS NOT NULL AND item <> ''
      ON CONFLICT (store_id, name_key) DO NOTHING
      `,
      [defaultStoreId]
    );
  }

  await pool.query(`
    UPDATE ${DB_TABLE} t
    SET product_id = p.id
    FROM ${PRODUCTS_TABLE} p
    WHERE t.product_id IS NULL
      AND p.name_key = LOWER(REGEXP_REPLACE(TRIM(t.item), '\\s+', ' ', 'g'))
      AND (p.store_id = t.store_id OR t.store_id IS NULL)
  `);

  await pool.query(`
    UPDATE ${PRODUCTS_TABLE} p
    SET last_buy_price = sub.buy_price,
        default_buy_price = COALESCE(p.default_buy_price, sub.buy_price),
        updated_at = now()
    FROM (
      SELECT DISTINCT ON (store_id, name_key) store_id, name_key, buy_price
      FROM (
        SELECT
               store_id,
               LOWER(REGEXP_REPLACE(TRIM(item), '\\s+', ' ', 'g')) AS name_key,
               buy_price,
               created_at
        FROM ${DB_TABLE}
        WHERE buy_price IS NOT NULL
      ) t
      ORDER BY store_id, name_key, created_at DESC
    ) sub
    WHERE p.name_key = sub.name_key
      AND (p.store_id = sub.store_id OR sub.store_id IS NULL)
  `);

  await pool.query(`
    UPDATE ${PRODUCTS_TABLE} p
    SET last_sell_price = sub.sell_price,
        default_sell_price = COALESCE(p.default_sell_price, sub.sell_price),
        updated_at = now()
    FROM (
      SELECT DISTINCT ON (store_id, name_key) store_id, name_key, sell_price
      FROM (
        SELECT
               store_id,
               LOWER(REGEXP_REPLACE(TRIM(item), '\\s+', ' ', 'g')) AS name_key,
               sell_price,
               created_at
        FROM ${DB_TABLE}
        WHERE sell_price IS NOT NULL
      ) t
      ORDER BY store_id, name_key, created_at DESC
    ) sub
    WHERE p.name_key = sub.name_key
      AND (p.store_id = sub.store_id OR sub.store_id IS NULL)
  `);

  await pool.query(`
    UPDATE ${DB_TABLE} t
    SET cost_price = COALESCE(t.cost_price, p.last_buy_price, p.default_buy_price),
        cost_total = COALESCE(t.cost_total, COALESCE(p.last_buy_price, p.default_buy_price) * t.qty)
    FROM ${PRODUCTS_TABLE} p
    WHERE t.type = 'OUT'
      AND t.cost_price IS NULL
      AND t.product_id = p.id
  `);

  await pool.query(`
    UPDATE ${DB_TABLE} t
    SET cost_price = COALESCE(t.cost_price, p.last_buy_price, p.default_buy_price),
        cost_total = COALESCE(t.cost_total, COALESCE(p.last_buy_price, p.default_buy_price) * t.qty),
        product_id = COALESCE(t.product_id, p.id)
    FROM ${PRODUCTS_TABLE} p
    WHERE t.type = 'OUT'
      AND t.cost_price IS NULL
      AND p.name_key = LOWER(REGEXP_REPLACE(TRIM(t.item), '\\s+', ' ', 'g'))
      AND (p.store_id = t.store_id OR t.store_id IS NULL)
  `);

  await pool.query(`
    INSERT INTO ${PAYABLE_ENTRIES_TABLE}
      (transaction_id, product_id, item, qty, cost_price, amount)
    SELECT t.id, t.product_id, t.item, t.qty, t.cost_price, t.cost_total
    FROM ${DB_TABLE} t
    LEFT JOIN ${PAYABLE_ENTRIES_TABLE} e ON e.transaction_id = t.id
    WHERE t.type = 'OUT'
      AND t.cost_price IS NOT NULL
      AND t.cost_total IS NOT NULL
      AND e.id IS NULL
  `);

  await pool.query(`DROP VIEW IF EXISTS ${DB_SUMMARY_VIEW}`);
  await pool.query(`
    CREATE VIEW ${DB_SUMMARY_VIEW} AS
    SELECT
      p.id AS product_id,
      p.store_id,
      p.name AS item,
      p.name_key,
      p.unit,
      p.is_active,
      COALESCE(SUM(CASE WHEN t.type = 'IN' THEN t.qty ELSE 0 END), 0) AS stock_in,
      COALESCE(SUM(CASE WHEN t.type IN ('OUT', 'DAMAGE') THEN t.qty ELSE 0 END), 0) AS stock_out,
      COALESCE(SUM(CASE WHEN t.type = 'IN' THEN t.qty ELSE 0 END), 0) -
        COALESCE(SUM(CASE WHEN t.type IN ('OUT', 'DAMAGE') THEN t.qty ELSE 0 END), 0) AS stock,
      COALESCE(SUM(CASE WHEN t.type = 'OUT' THEN t.total ELSE 0 END), 0) AS revenue,
      COALESCE(SUM(CASE WHEN t.type = 'IN' THEN t.total ELSE 0 END), 0) AS cost,
      COALESCE(SUM(CASE WHEN t.type = 'OUT' THEN t.total ELSE 0 END), 0) -
        COALESCE(SUM(CASE WHEN t.type = 'IN' THEN t.total ELSE 0 END), 0) AS profit
    FROM ${PRODUCTS_TABLE} p
    LEFT JOIN ${DB_TABLE} t ON t.product_id = p.id
    GROUP BY p.id, p.store_id, p.name, p.name_key, p.unit, p.is_active
  `);

  await pool.query(`DROP VIEW IF EXISTS ${PAYABLE_SUMMARY_VIEW}`);
  await pool.query(`
    CREATE VIEW ${PAYABLE_SUMMARY_VIEW} AS
    SELECT
      p.id AS product_id,
      p.store_id,
      p.name AS item,
      p.unit,
      COALESCE(SUM(e.amount), 0) AS payable_total,
      COALESCE(SUM(e.amount_paid), 0) AS paid_total,
      COALESCE(SUM(e.amount - e.amount_paid), 0) AS balance
    FROM ${PRODUCTS_TABLE} p
    LEFT JOIN ${PAYABLE_ENTRIES_TABLE} e ON e.product_id = p.id
    GROUP BY p.id, p.store_id, p.name, p.unit
  `);
}

export {
  DATABASE_URL,
  DB_TABLE,
  STORES_TABLE,
  PRODUCTS_TABLE,
  DB_SUMMARY_VIEW,
  PAYABLE_ENTRIES_TABLE,
  PAYABLE_PAYMENTS_TABLE,
  PAYABLE_ALLOCATIONS_TABLE,
  PAYABLE_SUMMARY_VIEW,
  USERS_TABLE,
  AUDIT_LOGS_TABLE,
  BUYER_ORDERS_TABLE,
  BUYER_ORDER_ITEMS_TABLE,
  OUTBOUND_MESSAGES_TABLE,
  normalizeItemKey,
  createPool,
  ensureDatabase
};
