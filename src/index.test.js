const test = require('node:test');
const assert = require('node:assert/strict');

const { createApp } = require('./index');

async function withServer(run) {
  const app = createApp();
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    await run(baseUrl);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function post(baseUrl, path, body) {
  const response = await fetch(baseUrl + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  return { status: response.status, body: await response.json() };
}

async function get(baseUrl, path) {
  const response = await fetch(baseUrl + path);
  return { status: response.status, body: await response.json() };
}

test('reserve uses optimistic version checks and idempotency', async () => {
  await withServer(async (baseUrl) => {
    const initial = await get(baseUrl, '/inventory/SKU-100');
    assert.equal(initial.status, 200);
    assert.deepEqual(initial.body, { sku: 'SKU-100', available: 50, version: 0 });

    const reserved = await post(baseUrl, '/inventory/reserve', {
      reservationId: 'res-1',
      sku: 'SKU-100',
      quantity: 5,
      expectedVersion: 0
    });
    assert.equal(reserved.status, 200);
    assert.equal(reserved.body.status, 'reserved');
    assert.equal(reserved.body.remaining, 45);
    assert.equal(reserved.body.version, 1);

    const retry = await post(baseUrl, '/inventory/reserve', {
      reservationId: 'res-1',
      sku: 'SKU-100',
      quantity: 5,
      expectedVersion: 0
    });
    assert.equal(retry.status, 200);
    assert.equal(retry.body.status, 'already_reserved');
    assert.equal(retry.body.remaining, 45);
    assert.equal(retry.body.version, 1);

    const staleVersion = await post(baseUrl, '/inventory/reserve', {
      reservationId: 'res-2',
      sku: 'SKU-100',
      quantity: 1,
      expectedVersion: 0
    });
    assert.equal(staleVersion.status, 409);
    assert.equal(staleVersion.body.error, 'version_conflict');
    assert.equal(staleVersion.body.currentVersion, 1);
  });
});

test('release uses optimistic version checks and is idempotent', async () => {
  await withServer(async (baseUrl) => {
    const reserved = await post(baseUrl, '/inventory/reserve', {
      reservationId: 'res-3',
      sku: 'SKU-200',
      quantity: 3,
      expectedVersion: 0
    });
    assert.equal(reserved.status, 200);
    assert.equal(reserved.body.version, 1);

    const staleRelease = await post(baseUrl, '/inventory/release', {
      reservationId: 'res-3',
      expectedVersion: 0
    });
    assert.equal(staleRelease.status, 409);
    assert.equal(staleRelease.body.error, 'version_conflict');

    const released = await post(baseUrl, '/inventory/release', {
      reservationId: 'res-3',
      expectedVersion: 1
    });
    assert.equal(released.status, 200);
    assert.equal(released.body.status, 'released');
    assert.equal(released.body.available, 25);
    assert.equal(released.body.version, 2);

    const releaseRetry = await post(baseUrl, '/inventory/release', {
      reservationId: 'res-3',
      expectedVersion: 1
    });
    assert.equal(releaseRetry.status, 200);
    assert.equal(releaseRetry.body.status, 'already_released');
    assert.equal(releaseRetry.body.version, 2);
  });
});

test('conflicts when reservation id is reused with different payload and errors on unknown release', async () => {
  await withServer(async (baseUrl) => {
    const reserved = await post(baseUrl, '/inventory/reserve', {
      reservationId: 'res-4',
      sku: 'SKU-100',
      quantity: 2,
      expectedVersion: 0
    });
    assert.equal(reserved.status, 200);

    const conflict = await post(baseUrl, '/inventory/reserve', {
      reservationId: 'res-4',
      sku: 'SKU-100',
      quantity: 1,
      expectedVersion: 1
    });
    assert.equal(conflict.status, 409);
    assert.equal(conflict.body.error, 'idempotency_conflict');

    const missing = await post(baseUrl, '/inventory/release', {
      reservationId: 'missing-reservation',
      expectedVersion: 0
    });
    assert.equal(missing.status, 404);
    assert.equal(missing.body.error, 'reservation_not_found');
  });
});
