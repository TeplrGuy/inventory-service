const express = require('express');

const app = express();
const port = process.env.PORT || 3000;
const stockBySku = new Map();
const processedReservationIds = new Set();

app.use(express.json());

stockBySku.set('SKU-100', 50);
stockBySku.set('SKU-200', 25);

app.get('/health', (_req, res) => {
  res.status(200).json({
    service: 'inventory-service',
    status: 'ok',
    environment: process.env.ENVIRONMENT_NAME || 'local'
  });
});

app.get('/inventory/:sku', (req, res) => {
  const sku = req.params.sku;
  const available = stockBySku.get(sku) || 0;
  res.status(200).json({ sku, available });
});

app.post('/inventory/reserve', (req, res) => {
  const { reservationId, sku, quantity } = req.body || {};
  if (!reservationId || !sku || !Number.isInteger(quantity) || quantity <= 0) {
    return res.status(400).json({ error: 'reservationId, sku, and positive integer quantity are required.' });
  }

  if (processedReservationIds.has(reservationId)) {
    return res.status(200).json({ reservationId, status: 'already_reserved' });
  }

  const available = stockBySku.get(sku) || 0;
  if (available < quantity) {
    return res.status(409).json({ error: 'insufficient_inventory', sku, available, requested: quantity });
  }

  stockBySku.set(sku, available - quantity);
  processedReservationIds.add(reservationId);
  return res.status(200).json({ reservationId, status: 'reserved', sku, remaining: available - quantity });
});

app.listen(port, () => {
  console.log('inventory-service listening on port ' + port);
});
