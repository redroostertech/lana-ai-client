'use strict';

const path = require('path');
const express = require('express');

const app = express();
const port = Number(process.env.LANA_E2E_CLIENT_PORT || 4177);
const root = path.join(__dirname, '..', 'src');

app.disable('x-powered-by');
app.use(express.static(root, { index: false, etag: false, maxAge: 0 }));
app.get('/', (_req, res) => res.redirect('/agents/index.html#catalog'));

const server = app.listen(port, '127.0.0.1', () => {
  process.stdout.write(`Agent Studio test server listening on http://127.0.0.1:${port}\n`);
});

function shutdown() {
  server.close(() => process.exit(0));
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
