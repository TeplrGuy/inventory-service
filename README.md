# inventory-service

Node.js service baseline for the SDLC demo.

Set `DATABASE_URL` to a PostgreSQL connection string for durable inventory and
reservation state. The database user needs permission to create service tables
and seed the demo SKUs. Without a connection string the service uses in-memory
state only locally; `NODE_ENV=production` or a non-local `ENVIRONMENT_NAME`
requires PostgreSQL. Configure TLS and credentials through the connection
settings; do not commit credentials.

