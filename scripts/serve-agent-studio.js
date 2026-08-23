'use strict';

const path = require('path');
const { Readable } = require('stream');
const express = require('express');

const app = express();
const port = Number(process.env.LANA_E2E_CLIENT_PORT || 4177);
const root = path.join(__dirname, '..', 'src');
const apiBaseUrl = String(process.env.LANA_E2E_API_URL || 'http://127.0.0.1:8080').replace(/\/$/, '');

app.disable('x-powered-by');
app.use('/api', async (req, res) => {
  try {
    const headers = { ...req.headers };
    delete headers.host;
    delete headers.connection;
    delete headers['content-length'];

    let body;
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      body = Buffer.concat(chunks);
    }

    const upstream = await fetch(apiBaseUrl + req.originalUrl, {
      method: req.method,
      headers,
      body,
      redirect: 'manual',
    });

    res.status(upstream.status);
    upstream.headers.forEach((value, name) => {
      if (!['connection', 'content-encoding', 'content-length', 'transfer-encoding'].includes(name.toLowerCase())) {
        res.setHeader(name, value);
      }
    });

    if (!upstream.body) return res.end();
    return Readable.fromWeb(upstream.body).pipe(res);
  } catch (error) {
    return res.status(502).json({ error: 'Agent Studio test proxy failed', message: error.message });
  }
});
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
