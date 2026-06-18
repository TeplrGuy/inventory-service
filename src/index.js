const express = require('express');

function createApp(initialStock = { 'SKU-100': 50, 'SKU-200': 25 }) {
  const app = express();
  const stockBySku = new Map(
    Object.entries(initialStock).map(([sku, available]) => [sku, { available, version: 0 }])
  );
  const reservationsById = new Map();

  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.status(200).json({
      service: 'inventory-service',
      status: 'ok',
      environment: process.env.ENVIRONMENT_NAME || 'local'
    });
  });

  app.get('/inventory/:sku', (req, res) => {
    const sku = req.params.sku;
    const inventory = stockBySku.get(sku);
    res.status(200).json({ sku, available: inventory?.available || 0, version: inventory?.version || 0 });
  });

  app.post('/inventory/reserve', (req, res) => {
    const { reservationId, sku, quantity, expectedVersion } = req.body || {};
    if (
      !reservationId ||
      !sku ||
      !Number.isInteger(quantity) ||
      quantity <= 0 ||
      !Number.isInteger(expectedVersion) ||
      expectedVersion < 0
    ) {
      return res.status(400).json({
        error: 'reservationId, sku, positive integer quantity, and non-negative integer expectedVersion are required.'
      });
    }

    const existingReservation = reservationsById.get(reservationId);
    if (existingReservation) {
      if (existingReservation.sku !== sku || existingReservation.quantity !== quantity) {
        return res.status(409).json({
          error: 'idempotency_conflict',
          reservationId
        });
      }
      const inventory = stockBySku.get(existingReservation.sku);
      return res.status(200).json({
        reservationId,
        status: 'already_reserved',
        sku,
        remaining: inventory?.available || 0,
        version: inventory?.version || 0
      });
    }

    const inventory = stockBySku.get(sku);
    const available = inventory?.available || 0;
    const currentVersion = inventory?.version || 0;

    if (expectedVersion !== currentVersion) {
      return res.status(409).json({ error: 'version_conflict', sku, currentVersion });
    }

    if (available < quantity) {
      return res.status(409).json({ error: 'insufficient_inventory', sku, available, requested: quantity });
    }

    inventory.available -= quantity;
    inventory.version += 1;
    reservationsById.set(reservationId, { sku, quantity, released: false });
    return res.status(200).json({
      reservationId,
      status: 'reserved',
      sku,
      remaining: inventory.available,
      version: inventory.version
    });
  });

  app.post('/inventory/release', (req, res) => {
    const { reservationId, expectedVersion } = req.body || {};
    if (!reservationId || !Number.isInteger(expectedVersion) || expectedVersion < 0) {
      return res
        .status(400)
        .json({ error: 'reservationId and non-negative integer expectedVersion are required.' });
    }

    const reservation = reservationsById.get(reservationId);
    if (!reservation) {
      return res.status(404).json({ error: 'reservation_not_found', reservationId });
    }

    const inventory = stockBySku.get(reservation.sku);
    if (reservation.released) {
      return res.status(200).json({
        reservationId,
        status: 'already_released',
        sku: reservation.sku,
        available: inventory.available,
        version: inventory.version
      });
    }

    if (expectedVersion !== inventory.version) {
      return res.status(409).json({ error: 'version_conflict', sku: reservation.sku, currentVersion: inventory.version });
    }

    inventory.available += reservation.quantity;
    inventory.version += 1;
    reservation.released = true;
    return res.status(200).json({
      reservationId,
      status: 'released',
      sku: reservation.sku,
      available: inventory.available,
      version: inventory.version
    });
  });

  return app;
}

function startServer() {
  const app = createApp();
  const port = process.env.PORT || 3000;
  return app.listen(port, () => {
    console.log('inventory-service listening on port ' + port);
  });
}

if (require.main === module) {
  startServer();
}

module.exports = { createApp, startServer };
