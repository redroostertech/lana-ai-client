/**
 * Lana AI Community Edition - Frontend Server
 * Express server to serve static files and proxy API requests to backend
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const BACKEND_URL = process.env.BACKEND_URL || 'http://127.0.0.1:8080';

// Serve static files from the src directory
const srcDir = path.join(__dirname);
const publicDir = path.join(__dirname, '..', 'public_html');

// Check which directory to use
let staticDir = srcDir;
if (fs.existsSync(publicDir)) {
  staticDir = publicDir;
}

console.log(`[Frontend] Serving static files from: ${staticDir}`);
console.log(`[Frontend] Proxying /api/* to: ${BACKEND_URL}`);

// Proxy API requests to backend
app.use('/api', createProxyMiddleware({
  target: BACKEND_URL,
  changeOrigin: true,
  ws: true, // Enable WebSocket proxying
  onError: (err, req, res) => {
    console.error(`[Frontend] Proxy error: ${err.message}`);
    res.status(502).json({ error: 'Backend unavailable', message: err.message });
  }
}));

// Serve static files
app.use(express.static(staticDir, {
  extensions: ['html', 'htm'],
  index: ['index.html', 'login.html']
}));

// Serve node_modules for client-side dependencies
app.use('/node_modules', express.static(path.join(__dirname, '..', 'node_modules')));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Fallback for SPA routing (if needed)
// Express 5 uses different wildcard syntax
app.use((req, res) => {
  const htmlFile = path.join(staticDir, req.path);
  const htmlFileWithExt = htmlFile + '.html';

  if (fs.existsSync(htmlFile) && fs.statSync(htmlFile).isFile()) {
    res.sendFile(htmlFile);
  } else if (fs.existsSync(htmlFileWithExt)) {
    res.sendFile(htmlFileWithExt);
  } else {
    // Try login.html as default
    const loginPage = path.join(staticDir, 'login.html');
    if (fs.existsSync(loginPage)) {
      res.sendFile(loginPage);
    } else {
      res.status(404).send('Page not found');
    }
  }
});

// Start server
app.listen(PORT, HOST, () => {
  console.log(`[Frontend] Server running at http://${HOST}:${PORT}`);
  console.log(`[Frontend] Static directory: ${staticDir}`);
});
