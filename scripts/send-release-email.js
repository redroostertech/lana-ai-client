#!/usr/bin/env node
'use strict';

/*
 * send-release-email.js
 * ---------------------------------------------------------------------------
 * Reusable sender for Lana AI Client release / pre-release emails.
 *
 * It reads an email file produced by the release-email generator
 * (cli/lib/utils/email.js -> dist/release-email-<tag>.txt), then sends it over
 * SMTP. Zero npm dependencies: it speaks SMTP directly using Node's built-in
 * `net`/`tls`, so it runs anywhere Node does without `npm install`.
 *
 * Why SMTP: our Google OAuth client was deleted, which kills every Gmail *API*
 * path (MCP connectors, lana-mailer token). A Gmail App Password over SMTP is
 * independent of that OAuth client, so it keeps working.
 *
 * ---------------------------------------------------------------------------
 * CREDENTIALS (env vars, or an --env-file that defines them):
 *   EMAIL_HOST   SMTP host        (default: smtp.gmail.com)
 *   EMAIL_PORT   SMTP port        (default: 587 -> STARTTLS; 465 -> implicit TLS)
 *   EMAIL_USER   SMTP username / sending account   (required)
 *   EMAIL_PASS   SMTP password / Gmail App Password (required)
 *   EMAIL_FROM_NAME  display name in the From header (default: EMAIL_USER)
 *   RELEASE_EMAIL_TO comma-separated recipients (fallback if no --to / file To:)
 *
 * USAGE:
 *   node scripts/send-release-email.js --tag v4.1.0-pre.16de7a6 \
 *       --env-file ../../RedRoosterTech-Web/.env --send
 *
 *   # preview only (default when --send is omitted): verifies SMTP login,
 *   # prints the resolved recipients / subject / body, sends nothing.
 *   node scripts/send-release-email.js --tag v4.1.0-pre.16de7a6 \
 *       --env-file ../../RedRoosterTech-Web/.env
 *
 * FLAGS:
 *   --tag <tag>        locate dist/release-email-<tag>.txt in this repo
 *   --file <path>      explicit email file (overrides --tag)
 *   --to <a,b,c>       recipients (overrides the file's "To:" line and env)
 *   --from <addr>      From address (default: EMAIL_USER)
 *   --subject <text>   override the subject
 *   --env-file <path>  load EMAIL_* / RELEASE_EMAIL_TO from this .env file
 *   --send             actually send (without it, dry-run/preview)
 *   --help
 * ---------------------------------------------------------------------------
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const tls = require('tls');

const REPO_ROOT = path.resolve(__dirname, '..');

// ----------------------------- arg parsing --------------------------------
function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--send' || a === '--help' || a === '-h') {
      args[a.replace(/^-+/, '')] = true;
    } else if (a.startsWith('--')) {
      args[a.slice(2)] = argv[++i];
    } else {
      args._.push(a);
    }
  }
  return args;
}

function usage() {
  console.log(fs.readFileSync(__filename, 'utf8').split('\n')
    .filter((l) => l.startsWith(' *') || l.startsWith('/*'))
    .map((l) => l.replace(/^\/?\*\/?/, '').replace(/^ /, ''))
    .join('\n'));
}

// --------------------------- .env loading ---------------------------------
// Minimal KEY=VALUE parser so the script stays dependency-free.
function loadEnvFile(file) {
  const resolved = path.isAbsolute(file) ? file : path.resolve(process.cwd(), file);
  if (!fs.existsSync(resolved)) {
    throw new Error(`--env-file not found: ${resolved}`);
  }
  for (const line of fs.readFileSync(resolved, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    if (line.trim().startsWith('#')) continue;
    let val = m[2].trim();
    if ((val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    // Do not clobber vars already set in the real environment.
    if (process.env[m[1]] === undefined) process.env[m[1]] = val;
  }
}

// ------------------------- email file parsing -----------------------------
function parseEmailFile(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const lines = raw.split('\n');
  const subjLine = lines.find((l) => /^Subject:/i.test(l));
  const toLine = lines.find((l) => /^To:/i.test(l));
  const subject = subjLine ? subjLine.replace(/^Subject:\s*/i, '').trim() : '';
  const to = toLine ? toLine.replace(/^To:\s*/i, '').trim() : '';
  const firstBlank = lines.findIndex((l) => l.trim() === '');
  const body = lines.slice(firstBlank + 1).join('\n').trim() + '\n';
  return { subject, to, body };
}

function splitRecipients(csv) {
  return (csv || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

// ------------------------------ SMTP client -------------------------------
// Speaks just enough SMTP for STARTTLS + AUTH LOGIN + a single message.
class SmtpClient {
  constructor({ host, port }) {
    this.host = host;
    this.port = port;
    this.sock = null;
    this.buffer = '';
    this.pending = null; // { resolve, reject }
  }

  _attach(sock) {
    this.sock = sock;
    this.buffer = '';
    sock.setEncoding('utf8');
    sock.on('data', (chunk) => {
      this.buffer += chunk;
      // A complete reply ends with a line "NNN " (space, not '-').
      const lines = this.buffer.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        if (/^\d{3} /.test(lines[i])) {
          const code = parseInt(lines[i].slice(0, 3), 10);
          const text = lines.slice(0, i + 1).join('\n');
          this.buffer = lines.slice(i + 1).join('\n');
          const p = this.pending;
          this.pending = null;
          if (p) p.resolve({ code, text });
          return;
        }
      }
    });
    sock.on('error', (err) => {
      const p = this.pending;
      this.pending = null;
      if (p) p.reject(err);
    });
  }

  _expect() {
    return new Promise((resolve, reject) => { this.pending = { resolve, reject }; });
  }

  async _cmd(line, okCodes) {
    this.sock.write(line + '\r\n');
    const res = await this._expect();
    if (okCodes && !okCodes.includes(res.code)) {
      throw new Error(`SMTP "${line.split(' ')[0]}" -> ${res.code}: ${res.text.trim()}`);
    }
    return res;
  }

  async connect() {
    await new Promise((resolve, reject) => {
      if (this.port === 465) {
        const s = tls.connect({ host: this.host, port: this.port, servername: this.host }, resolve);
        s.once('error', reject);
        this._attach(s);
      } else {
        const s = net.connect({ host: this.host, port: this.port }, resolve);
        s.once('error', reject);
        this._attach(s);
      }
    });
    await this._expect(); // 220 greeting
  }

  async starttlsIfNeeded(ehloName) {
    await this._cmd(`EHLO ${ehloName}`, [250]);
    if (this.port !== 465) {
      await this._cmd('STARTTLS', [220]);
      const upgraded = await new Promise((resolve, reject) => {
        const t = tls.connect({ socket: this.sock, servername: this.host }, () => resolve(t));
        t.once('error', reject);
      });
      this._attach(upgraded);
      await this._cmd(`EHLO ${ehloName}`, [250]);
    }
  }

  async authLogin(user, pass) {
    await this._cmd('AUTH LOGIN', [334]);
    await this._cmd(Buffer.from(user).toString('base64'), [334]);
    await this._cmd(Buffer.from(pass).toString('base64'), [235]);
  }

  async send({ from, recipients, message }) {
    await this._cmd(`MAIL FROM:<${from}>`, [250]);
    for (const rcpt of recipients) {
      await this._cmd(`RCPT TO:<${rcpt}>`, [250, 251]);
    }
    await this._cmd('DATA', [354]);
    // Dot-stuff, ensure CRLF, terminate with <CRLF>.<CRLF>
    const dotStuffed = message
      .split(/\r?\n/)
      .map((l) => (l.startsWith('.') ? '.' + l : l))
      .join('\r\n');
    this.sock.write(dotStuffed + '\r\n.\r\n');
    const res = await this._expect();
    if (res.code !== 250) throw new Error(`DATA rejected -> ${res.code}: ${res.text.trim()}`);
    return res.text.trim();
  }

  async quit() {
    try { await this._cmd('QUIT', [221]); } catch (_) { /* ignore */ }
    if (this.sock) this.sock.end();
  }
}

// ------------------------------ MIME build --------------------------------
function buildMessage({ fromName, fromAddr, to, subject, body }) {
  const domain = (fromAddr.split('@')[1] || 'localhost');
  const rand = Math.abs(Date.now() ^ (Math.floor(Math.random() * 1e9))).toString(36);
  const messageId = `<${rand}@${domain}>`;
  const fromHeader = fromName ? `${fromName} <${fromAddr}>` : fromAddr;
  const headers = [
    `From: ${fromHeader}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: ${messageId}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
  ];
  return { message: headers.join('\r\n') + '\r\n\r\n' + body, messageId };
}

// -------------------------------- main ------------------------------------
async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { usage(); return; }

  // Explicit --env-file wins. Otherwise fall back to the consolidated machine
  // credential store (~/.lana-client/credentials), which is the single place
  // EMAIL_* / RELEASE_EMAIL_TO live alongside the Apple + GitHub release creds.
  if (args['env-file']) {
    loadEnvFile(args['env-file']);
  } else {
    const defaultCreds = path.join(os.homedir(), '.lana-client', 'credentials');
    if (fs.existsSync(defaultCreds)) {
      loadEnvFile(defaultCreds);
      console.log('Credentials  :', defaultCreds);
    }
  }

  const host = process.env.EMAIL_HOST || 'smtp.gmail.com';
  const port = parseInt(process.env.EMAIL_PORT || '587', 10);
  const user = process.env.EMAIL_USER;
  const pass = process.env.EMAIL_PASS;
  if (!user || !pass) {
    throw new Error('EMAIL_USER and EMAIL_PASS are required (set them in the env or via --env-file).');
  }

  // Resolve the email file.
  let file = args.file;
  if (!file && args.tag) {
    file = path.join(REPO_ROOT, 'dist', `release-email-${args.tag}.txt`);
  }
  if (!file) throw new Error('Provide --file <path> or --tag <tag>.');
  if (!fs.existsSync(file)) throw new Error(`Email file not found: ${file}`);

  const parsed = parseEmailFile(file);
  const subject = args.subject || parsed.subject;
  const fromAddr = args.from || user;
  const fromName = process.env.EMAIL_FROM_NAME || 'Michael Westbrooks';
  const recipients = splitRecipients(
    args.to || parsed.to || process.env.RELEASE_EMAIL_TO
  );
  if (!subject) throw new Error('No subject (file had none and --subject not given).');
  if (recipients.length === 0) {
    throw new Error('No recipients (use --to, a "To:" line in the file, or RELEASE_EMAIL_TO).');
  }

  console.log('SMTP host   :', `${host}:${port}`);
  console.log('Auth as     :', user);
  console.log('From        :', fromName ? `${fromName} <${fromAddr}>` : fromAddr);
  console.log('Recipients  :', recipients.join(', '));
  console.log('Subject     :', subject);
  console.log('Email file  :', file);
  console.log('Mode        :', args.send ? 'SEND' : 'DRY-RUN (add --send to actually send)');
  console.log('----------------------------------------------------------------');

  const client = new SmtpClient({ host, port });
  await client.connect();
  await client.starttlsIfNeeded(domainOfHost());
  await client.authLogin(user, pass);
  console.log('✓ SMTP authentication OK');

  if (!args.send) {
    await client.quit();
    console.log('\n--- BODY PREVIEW ---\n' + parsed.body);
    console.log('Dry-run complete. Nothing was sent. Re-run with --send to deliver.');
    return;
  }

  const { message, messageId } = buildMessage({ fromName, fromAddr, to: recipients.join(', '), subject, body: parsed.body });
  await client.send({ from: fromAddr, recipients, message });
  await client.quit();
  console.log('\n✓ SENT');
  console.log('  messageId :', messageId);
  console.log('  accepted  :', recipients.join(', '));
}

function domainOfHost() {
  // EHLO name — hostname is fine; use the sender domain for tidiness.
  return (process.env.EMAIL_USER || 'localhost').split('@')[1] || 'localhost';
}

main().catch((err) => {
  console.error('\n✗ ' + (err && err.message ? err.message : err));
  process.exit(1);
});
