require('./telemetry');
const express = require('express');
const { createStore } = require('./store');

const app = express();
const port = process.env.PORT || 3000;
let store;

app.use(express.json());

app.get('/health', async (_req, res) => {
  try {
    await store.check();
    res.status(200).json({
      service: 'inventory-service',
      status: 'ok',
      environment: process.env.ENVIRONMENT_NAME || 'local'
    });
  } catch (error) {
    console.error('inventory-service health check failed', error);
    res.status(503).json({ service: 'inventory-service', status: 'unavailable' });
  }
});

app.get('/inventory/:sku', async (req, res, next) => {
  const sku = req.params.sku;
  try {
    res.status(200).json({ sku, available: await store.available(sku) });
  } catch (error) {
    next(error);
  }
});

app.post('/inventory/reserve', async (req, res, next) => {
  const { reservationId, sku, quantity } = req.body || {};
  if (!reservationId || !sku || !Number.isInteger(quantity) || quantity <= 0) {
    return res.status(400).json({ error: 'reservationId, sku, and positive integer quantity are required.' });
  }

  try {
    const result = await store.reserve(reservationId, sku, quantity);
    if (result.status === 'insufficient_inventory' || result.status === 'reservation_conflict') {
      const { status, ...details } = result;
      return res.status(409).json({ error: status, ...details });
    }
    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
});

app.use((error, _req, res, _next) => {
  console.error('inventory-service request failed', error);
  res.status(500).json({ error: 'internal_error' });
});

createStore().then((createdStore) => {
  store = createdStore;
  app.listen(port, () => console.log('inventory-service listening on port ' + port));
}).catch((error) => {
  console.error('inventory-service startup failed', error);
  process.exitCode = 1;
});
