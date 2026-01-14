import {
  PAYABLE_ALLOCATIONS_TABLE,
  PAYABLE_ENTRIES_TABLE,
  PAYABLE_PAYMENTS_TABLE,
  PRODUCTS_TABLE
} from './db.js';

function toNumber(value) {
  if (typeof value === 'number') return value;
  const raw = String(value || '').trim();
  if (!raw) return 0;
  const cleaned = raw.replace(/[^0-9.,-]/g, '');
  if (!cleaned) return 0;
  const normalized = cleaned
    .replace(/(\d)[.,](?=\d{3}(?:[.,]|$))/g, '$1')
    .replace(',', '.');
  const num = Number(normalized);
  return Number.isNaN(num) ? 0 : num;
}

async function applyPayment(pool, { amount, sender, raw, note, storeId }) {
  if (!pool) return null;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const paymentRes = await client.query(
      `
      INSERT INTO ${PAYABLE_PAYMENTS_TABLE}
        (amount, remaining_amount, note, sender, raw, store_id)
      VALUES ($1,$1,$2,$3,$4,$5)
      RETURNING id, remaining_amount
      `,
      [amount, note || null, sender || null, raw || null, storeId || null]
    );

    const paymentId = paymentRes.rows?.[0]?.id;
    let remaining = toNumber(paymentRes.rows?.[0]?.remaining_amount);
    const allocations = [];

    const entriesRes = await client.query(
      `
      SELECT e.id, e.item, e.qty, e.cost_price, e.amount, e.amount_paid
      FROM ${PAYABLE_ENTRIES_TABLE} e
      JOIN ${PRODUCTS_TABLE} p ON p.id = e.product_id
      WHERE e.amount_paid < e.amount
        AND ($1::bigint IS NULL OR p.store_id = $1)
      ORDER BY e.created_at ASC, e.id ASC
      FOR UPDATE
      `
      ,
      [storeId || null]
    );

    for (const entry of entriesRes.rows || []) {
      if (remaining <= 0) break;
      const entryAmount = toNumber(entry.amount);
      const entryPaid = toNumber(entry.amount_paid);
      const available = Math.max(entryAmount - entryPaid, 0);
      if (available <= 0) continue;

      const allocation = Math.min(available, remaining);
      if (allocation <= 0) continue;

      await client.query(
        `UPDATE ${PAYABLE_ENTRIES_TABLE} SET amount_paid = amount_paid + $1 WHERE id = $2`,
        [allocation, entry.id]
      );
      await client.query(
        `INSERT INTO ${PAYABLE_ALLOCATIONS_TABLE} (payment_id, entry_id, amount) VALUES ($1,$2,$3)`,
        [paymentId, entry.id, allocation]
      );

      allocations.push({
        entryId: entry.id,
        item: entry.item,
        qty: toNumber(entry.qty),
        costPrice: toNumber(entry.cost_price),
        amount: allocation
      });

      remaining -= allocation;
    }

    await client.query(
      `UPDATE ${PAYABLE_PAYMENTS_TABLE} SET remaining_amount = $1 WHERE id = $2`,
      [remaining, paymentId]
    );

    await client.query('COMMIT');
    return { paymentId, remaining, allocations };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function createPayableEntry(pool, {
  transactionId,
  productId,
  item,
  qty,
  costPrice,
  amount,
  storeId
}) {
  if (!pool) return null;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const entryRes = await client.query(
      `
      INSERT INTO ${PAYABLE_ENTRIES_TABLE}
        (transaction_id, product_id, item, qty, cost_price, amount)
      VALUES ($1,$2,$3,$4,$5,$6)
      RETURNING id
      `,
      [transactionId, productId, item, qty, costPrice, amount]
    );

    const entryId = entryRes.rows?.[0]?.id;
    let remaining = toNumber(amount);
    const allocations = [];

    const paymentsRes = await client.query(
      `
      SELECT id, remaining_amount
      FROM ${PAYABLE_PAYMENTS_TABLE}
      WHERE remaining_amount > 0
        AND ($1::bigint IS NULL OR store_id = $1)
      ORDER BY created_at ASC, id ASC
      FOR UPDATE
      `
      ,
      [storeId || null]
    );

    for (const payment of paymentsRes.rows || []) {
      if (remaining <= 0) break;
      const credit = toNumber(payment.remaining_amount);
      if (credit <= 0) continue;

      const allocation = Math.min(credit, remaining);
      if (allocation <= 0) continue;

      await client.query(
        `UPDATE ${PAYABLE_PAYMENTS_TABLE} SET remaining_amount = remaining_amount - $1 WHERE id = $2`,
        [allocation, payment.id]
      );
      await client.query(
        `UPDATE ${PAYABLE_ENTRIES_TABLE} SET amount_paid = amount_paid + $1 WHERE id = $2`,
        [allocation, entryId]
      );
      await client.query(
        `INSERT INTO ${PAYABLE_ALLOCATIONS_TABLE} (payment_id, entry_id, amount) VALUES ($1,$2,$3)`,
        [payment.id, entryId, allocation]
      );

      allocations.push({
        paymentId: payment.id,
        amount: allocation
      });

      remaining -= allocation;
    }

    await client.query('COMMIT');
    return { entryId, remaining, allocations };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function getPayableBalance(pool, storeId) {
  if (!pool) return null;

  const payableRes = await pool.query(
    `
    SELECT COALESCE(SUM(e.amount), 0) AS total
    FROM ${PAYABLE_ENTRIES_TABLE} e
    JOIN ${PRODUCTS_TABLE} p ON p.id = e.product_id
    WHERE ($1::bigint IS NULL OR p.store_id = $1)
    `,
    [storeId || null]
  );
  const paidRes = await pool.query(
    `
    SELECT COALESCE(SUM(amount), 0) AS total
    FROM ${PAYABLE_PAYMENTS_TABLE}
    WHERE ($1::bigint IS NULL OR store_id = $1)
    `,
    [storeId || null]
  );

  const totalPayable = toNumber(payableRes.rows?.[0]?.total);
  const totalPaid = toNumber(paidRes.rows?.[0]?.total);
  const balance = totalPaid - totalPayable;

  return { totalPayable, totalPaid, balance };
}

export { applyPayment, createPayableEntry, getPayableBalance };
