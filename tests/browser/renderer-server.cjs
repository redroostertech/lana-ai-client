// Serves the real renderer (src/) over http for the browser harnesses. With
// proxyTo set, /api/, /socket.io/ and /health go to that backend (same
// origin for the page, so no CORS), websocket upgrades included.
'use strict';
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');

const root = path.resolve(__dirname, '../../src');
const TYPES = { '.js': 'application/javascript', '.css': 'text/css', '.html': 'text/html', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff', '.json': 'application/json' };
const PROXIED = /^\/(api|socket\.io)\/|^\/health(\?|$)/;

// tailwind-output.css is a gitignored build product; build it into the output
// directory when the checkout has none, without touching src/.
function tailwindCss(outDir) {
  const built = path.join(root, 'css/tailwind-output.css');
  if (fs.existsSync(built)) return built;
  const target = path.join(outDir, '.tailwind-output.css');
  if (!fs.existsSync(target)) {
    require('node:child_process').execFileSync('npx', ['postcss', 'src/css/tailwind-input.css', '-o', target, '--env', 'production'], { cwd: path.resolve(root, '..'), stdio: 'inherit' });
  }
  return target;
}

// tiptap-bundle-built.js is another gitignored build product (scripts/build-tiptap.js);
// built into the output directory the same way when the checkout has none.
function tiptapBundle(outDir) {
  const built = path.join(root, 'js/tiptap-bundle-built.js');
  if (fs.existsSync(built)) return built;
  const target = path.join(outDir, '.tiptap-bundle-built.js');
  if (!fs.existsSync(target)) {
    const { baseConfig } = require('../../scripts/build-tiptap.js');
    require('esbuild').buildSync({ ...baseConfig, absWorkingDir: path.resolve(root, '..'), sourcemap: false, outfile: target });
  }
  return target;
}

function proxyRequest(req, res, target) {
  const upstream = http.request({ host: target.hostname, port: target.port, method: req.method, path: req.url, headers: { ...req.headers, host: target.host } }, (answer) => {
    res.writeHead(answer.statusCode, answer.headers);
    answer.pipe(res);
  });
  upstream.on('error', (error) => { res.writeHead(502, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: { code: 'PROXY_ERROR', message: error.message } })); });
  req.pipe(upstream);
}

function proxyUpgrade(req, socket, head, target) {
  const upstream = net.connect(Number(target.port), target.hostname, () => {
    const lines = [req.method + ' ' + req.url + ' HTTP/' + req.httpVersion];
    for (let i = 0; i < req.rawHeaders.length; i += 2) lines.push(req.rawHeaders[i] + ': ' + (/^host$/i.test(req.rawHeaders[i]) ? target.host : req.rawHeaders[i + 1]));
    upstream.write(lines.join('\r\n') + '\r\n\r\n');
    if (head && head.length) upstream.write(head);
    upstream.pipe(socket);
    socket.pipe(upstream);
  });
  const close = () => { socket.destroy(); upstream.destroy(); };
  upstream.on('error', close);
  socket.on('error', close);
}

// withTiptap also serves the note editor bundle (the live flows edit notes in it).
function rendererServer({ outDir, proxyTo, withTiptap } = {}) {
  const built = { '/css/tailwind-output.css': tailwindCss(outDir) };
  if (withTiptap) built['/js/tiptap-bundle-built.js'] = tiptapBundle(outDir);
  const target = proxyTo ? new URL(proxyTo) : null;
  const server = http.createServer((req, res) => {
    if (target && PROXIED.test(req.url)) { proxyRequest(req, res, target); return; }
    const requested = decodeURIComponent(req.url.split('?')[0]);
    const file = built[requested] || path.resolve(root, '.' + requested);
    if ((!built[requested] && !file.startsWith(root + path.sep)) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type', TYPES[path.extname(file)] || 'application/octet-stream');
    res.end(fs.readFileSync(file));
  });
  if (target) server.on('upgrade', (req, socket, head) => (PROXIED.test(req.url) ? proxyUpgrade(req, socket, head, target) : socket.destroy()));
  return server;
}

module.exports = { rendererServer };
