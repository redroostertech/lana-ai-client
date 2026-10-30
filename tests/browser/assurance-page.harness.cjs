'use strict';
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const root = path.resolve(__dirname, '../../src');
const template = fs.readFileSync(path.join(root, 'implementation-assurance.html'), 'utf8').split('<template id="page-content">')[1].split('</template>')[0];
const scripts = ['time-utils.js', 'lex/lex.core.js', 'lex/lex.icons.js', 'lex/lex.forms.js', 'lex/lex.utils.js',
  'lex/components/foundation/lex-btn.js', 'lex/components/foundation/lex-banner.js', 'lex/components/foundation/lex-card.js',
  'lex/components/form/lex-select.js', 'lex/components/form/lex-textarea.js', 'lex/components/form/lex-input.js',
  'lex/components/form/lex-checkbox.js', 'lex/components/form/lex-form.js',
  'services/assurance-onboarding-client.js', 'services/assurance-value-controls.js', 'services/assurance-evidence-controls.js',
  'services/implementation-assurance-client.js', 'assurance-onboarding.js', 'implementation-assurance.js'];
function createPageServer(bootstrap) {
const html = `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/css/lex-tokens.css"><link rel="stylesheet" href="/css/components.css"><link rel="stylesheet" href="/css/implementation-assurance.css"></head><body>${template}<script>${bootstrap}</script>${scripts.map(src => '<script src="/js/' + src + '"></script>').join('')}</body></html>`;
const server = http.createServer((req, res) => {
  if (req.url === '/') { res.setHeader('Content-Type', 'text/html'); res.end(html); return; }
  const file = path.resolve(root, '.' + decodeURIComponent(req.url.split('?')[0]));
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
  res.setHeader('Content-Type', file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : 'application/octet-stream'); res.end(fs.readFileSync(file));
});
return server;
}
module.exports = { createPageServer };
