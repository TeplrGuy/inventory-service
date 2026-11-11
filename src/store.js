function createMemoryStore() {
  const stock = new Map([['SKU-100', 50], ['SKU-200', 25]]);
  const reservations = new Map();
  return {
    async check() {},
    async close() {},
    async available(sku) {
      return stock.get(sku) || 0;
    },
    async reserve(reservationId, sku, quantity) {
      const previous = reservations.get(reservationId);
      if (previous) {
        return previous.sku === sku && previous.quantity === quantity
          ? { status: 'already_reserved', reservationId }
          : { status: 'reservation_conflict', reservationId };
      }
      const available = stock.get(sku) || 0;
      if (available < quantity) return { status: 'insufficient_inventory', sku, available, requested: quantity };
      const remaining = available - quantity;
      stock.set(sku, remaining);
      reservations.set(reservationId, { sku, quantity });
      return { status: 'reserved', reservationId, sku, remaining };
    }
  };
}

async function createPostgresStore(connectionString) {
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString });
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('inventory-service schema'))");
    await client.query(`CREATE TABLE IF NOT EXISTS inventory_stock (
      sku text PRIMARY KEY, available integer NOT NULL CHECK (available >= 0)
    )`);
    await client.query(`CREATE TABLE IF NOT EXISTS inventory_reservations (
      reservation_id text PRIMARY KEY, sku text NOT NULL, quantity integer NOT NULL CHECK (quantity > 0)
    )`);
    await client.query(`INSERT INTO inventory_stock (sku, available) VALUES ('SKU-100', 50), ('SKU-200', 25)
      ON CONFLICT (sku) DO NOTHING`);
    await client.query('COMMIT');
  } catch (error) {
    try {
      if (client) await client.query('ROLLBACK');
    } finally {
      if (client) client.release();
      await pool.end();
    }
    throw error;
  }
  client.release();
  return {
    async check() { await pool.query('SELECT 1'); },
    async close() { await pool.end(); },
    async available(sku) {
      const result = await pool.query('SELECT available FROM inventory_stock WHERE sku = $1', [sku]);
      return result.rows[0]?.available ?? 0;
    },
    async reserve(reservationId, sku, quantity) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const inserted = await client.query(
          `INSERT INTO inventory_reservations (reservation_id, sku, quantity) VALUES ($1, $2, $3)
           ON CONFLICT (reservation_id) DO NOTHING RETURNING reservation_id`,
          [reservationId, sku, quantity]
        );
        if (inserted.rowCount === 0) {
          const previous = await client.query(
            'SELECT sku, quantity FROM inventory_reservations WHERE reservation_id = $1', [reservationId]
          );
          await client.query('COMMIT');
          return previous.rows[0].sku === sku && previous.rows[0].quantity === quantity
            ? { status: 'already_reserved', reservationId }
            : { status: 'reservation_conflict', reservationId };
        }
        const updated = await client.query(
          'UPDATE inventory_stock SET available = available - $2 WHERE sku = $1 AND available >= $2 RETURNING available',
          [sku, quantity]
        );
        if (updated.rowCount === 0) {
          const existing = await client.query('SELECT available FROM inventory_stock WHERE sku = $1', [sku]);
          await client.query('ROLLBACK');
          return { status: 'insufficient_inventory', sku, available: existing.rows[0]?.available ?? 0, requested: quantity };
        }
        await client.query('COMMIT');
        return { status: 'reserved', reservationId, sku, remaining: updated.rows[0].available };
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    }
  };
}

async function createStore() {
  if (process.env.DATABASE_URL) return createPostgresStore(process.env.DATABASE_URL);
  if (process.env.NODE_ENV === 'production' || (process.env.ENVIRONMENT_NAME && process.env.ENVIRONMENT_NAME !== 'local')) {
    throw new Error('DATABASE_URL is required outside the local environment');
  }
  return createMemoryStore();
}

module.exports = { createStore };
