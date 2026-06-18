const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHealth(baseUrl, attempts = 40) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch {}
    await wait(150);
  }
  throw new Error("inventory-service did not become healthy in time");
}

test("inventory reserve flow and idempotency", async () => {
  const port = String(3800 + Math.floor(Math.random() * 200));
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn("node", ["src/index.js"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: port },
    stdio: "ignore"
  });

  try {
    await waitForHealth(baseUrl);

    const invalid = await fetch(`${baseUrl}/inventory/reserve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sku: "SKU-100", quantity: 1 })
    });
    assert.equal(invalid.status, 400);

    const reserve = await fetch(`${baseUrl}/inventory/reserve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reservationId: "res-1", sku: "SKU-100", quantity: 2 })
    });
    assert.equal(reserve.status, 200);

    const reserveAgain = await fetch(`${baseUrl}/inventory/reserve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reservationId: "res-1", sku: "SKU-100", quantity: 2 })
    });
    assert.equal(reserveAgain.status, 200);
    const payload = await reserveAgain.json();
    assert.equal(payload.status, "already_reserved");
  } finally {
    child.kill("SIGTERM");
  }
});
