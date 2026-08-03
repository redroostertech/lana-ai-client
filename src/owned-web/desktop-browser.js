'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ALLOWED_ACTION_TYPES = new Set([
  'navigate', 'navigateBack', 'snapshot', 'readText', 'click', 'type',
  'fill', 'clear', 'scroll', 'waitFor', 'captureEvidence',
  'requestSubmission', 'closeSession'
]);

const CONSEQUENTIAL_ACTION_TYPES = new Set(['requestSubmission']);

class OwnedWebDesktopBrowserManager {
  constructor(options = {}) {
    this.BrowserWindow = options.BrowserWindow;
    this.dialog = options.dialog;
    this.app = options.app;
    this.assertSender = options.assertSender || (() => true);
    this.clock = options.clock || (() => new Date());
    this.randomBytes = options.randomBytes || ((size) => crypto.randomBytes(size));
    this.sessions = new Map();
    this.approvals = new Map();
    this.uploadRefs = new Map();
  }

  async openSession(event, payload = {}) {
    this.assertSender(event);
    if (payload.executionTarget && payload.executionTarget !== 'desktop_local') {
      throw new Error('desktop_local_required');
    }
    const id = `desktop_web_${this.randomBytes(8).toString('hex')}`;
    const partition = payload.persistAuthenticationState
      ? `persist:lana-owned-web-${hashForLog(id).slice(0, 16)}`
      : `lana-owned-web-${hashForLog(id).slice(0, 16)}`;
    const allowedOrigins = normalizeOrigins(payload.allowedOrigins || []);
    const win = new this.BrowserWindow({
      show: payload.show !== false,
      width: Math.min(Number(payload.width) || 1200, 1800),
      height: Math.min(Number(payload.height) || 860, 1200),
      title: 'LANA Owned Web',
      webPreferences: {
        partition,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false
      }
    });
    const now = this.clock();
    const session = {
      id,
      executionTarget: 'desktop_local',
      status: 'open',
      allowedOrigins,
      partition,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + Math.min(Number(payload.maxSessionDurationMs) || 30 * 60 * 1000, 2 * 60 * 60 * 1000)).toISOString(),
      stepCount: 0,
      stepBudget: Math.min(Number(payload.maxSteps) || 50, 100),
      window: win
    };
    this.attachDownloadQuarantine(session);
    this.sessions.set(id, session);
    if (typeof win.on === 'function') {
      win.on('closed', () => this.sessions.delete(id));
    }
    return publicSession(session);
  }

  hasSession(sessionId) {
    return this.sessions.has(sessionId);
  }

  async snapshot(event, sessionId) {
    return this.executeAction(event, sessionId, { type: 'snapshot' });
  }

  async previewAction(event, sessionId, action = {}) {
    this.assertSender(event);
    const session = this.getSession(sessionId);
    const cleanAction = sanitizeOwnedWebAction(action);
    this.assertActionAllowed(session, cleanAction);
    const risk = actionRisk(cleanAction);
    const actionHash = canonicalActionHash(cleanAction);
    let approvalId = null;
    if (CONSEQUENTIAL_ACTION_TYPES.has(cleanAction.type)) {
      approvalId = `desktop_approval_${this.randomBytes(8).toString('hex')}`;
      this.approvals.set(approvalId, {
        approvalId,
        sessionId,
        actionHash,
        status: 'pending',
        expiresAt: new Date(this.clock().getTime() + 5 * 60 * 1000).toISOString()
      });
    }
    return { success: true, data: {
      approvalRequired: Boolean(approvalId),
      approvalId,
      risk,
      canonicalActionHash: actionHash,
      action: redactAction(cleanAction),
      expiresAt: approvalId ? this.approvals.get(approvalId).expiresAt : null
    } };
  }

  async decideApproval(event, approvalId, decision) {
    this.assertSender(event);
    const approval = this.approvals.get(approvalId);
    if (!approval || approval.status !== 'pending') {
      return { success: false, error: 'approval_unavailable' };
    }
    approval.status = decision === 'approved' ? 'approved' : 'denied';
    approval.decidedAt = this.clock().toISOString();
    return { success: true, data: { approvalId, decision: approval.status, decidedAt: approval.decidedAt } };
  }

  async executeAction(event, sessionId, action = {}) {
    this.assertSender(event);
    const session = this.getSession(sessionId);
    const cleanAction = sanitizeOwnedWebAction(action);
    this.assertActionAllowed(session, cleanAction);
    if (CONSEQUENTIAL_ACTION_TYPES.has(cleanAction.type)) {
      const approval = this.approvals.get(cleanAction.approvalId);
      if (!approval || approval.sessionId !== sessionId || approval.status !== 'approved' || approval.usedAt) {
        throw new Error('approval_required');
      }
      if (approval.actionHash !== canonicalActionHash(cleanAction)) {
        throw new Error('approval_action_mismatch');
      }
      approval.usedAt = this.clock().toISOString();
    }
    if (session.stepCount >= session.stepBudget) throw new Error('browser_step_budget_exceeded');
    session.stepCount += 1;
    const result = await performAction(session, cleanAction);
    return { success: true, data: { session: publicSession(session), risk: actionRisk(cleanAction), result } };
  }

  async chooseUploadFiles(event, payload = {}) {
    this.assertSender(event);
    const result = await this.dialog.showOpenDialog({
      title: 'Select files for LANA owned web upload',
      properties: ['openFile', 'multiSelections'],
      filters: Array.isArray(payload.filters) ? payload.filters : undefined
    });
    if (result.canceled) return { success: true, data: { files: [] } };
    const files = [];
    for (const filePath of (result.filePaths || []).slice(0, 10)) {
      const stat = fs.statSync(filePath);
      if (!stat.isFile()) continue;
      const buffer = fs.readFileSync(filePath);
      const hash = crypto.createHash('sha256').update(buffer).digest('hex');
      const ref = `desktop_upload_${this.randomBytes(8).toString('hex')}`;
      const file = {
        ref,
        name: normalizeFilename(path.basename(filePath)),
        size: stat.size,
        hash,
        contentType: payload.contentType || 'application/octet-stream'
      };
      this.uploadRefs.set(ref, { ...file, path: filePath });
      files.push(file);
    }
    return { success: true, data: { files } };
  }

  async closeSession(event, sessionId) {
    this.assertSender(event);
    const session = this.sessions.get(sessionId);
    if (session?.window && typeof session.window.close === 'function') {
      session.window.close();
    }
    this.sessions.delete(sessionId);
    return { success: true, data: { closed: true, sessionId } };
  }

  shutdown() {
    for (const session of this.sessions.values()) {
      try { session.window?.close?.(); } catch (_) { /* best effort */ }
    }
    this.sessions.clear();
    this.approvals.clear();
    this.uploadRefs.clear();
  }

  attachDownloadQuarantine(session) {
    const electronSession = session.window?.webContents?.session;
    if (!electronSession || typeof electronSession.on !== 'function') return;
    electronSession.on('will-download', (_event, item) => {
      const filename = normalizeFilename(item?.getFilename?.() || 'download.bin');
      const quarantineDir = path.join(this.app.getPath('userData'), 'owned-web-quarantine', session.id);
      fs.mkdirSync(quarantineDir, { recursive: true, mode: 0o700 });
      const savePath = path.join(quarantineDir, `${Date.now()}-${filename}`);
      if (typeof item.setSavePath === 'function') item.setSavePath(savePath);
      session.lastDownload = {
        filename,
        quarantinePath: savePath,
        status: 'quarantined'
      };
    });
  }

  getSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session || session.status !== 'open') throw new Error('browser_session_expired');
    if (new Date(session.expiresAt).getTime() <= this.clock().getTime()) {
      this.sessions.delete(sessionId);
      throw new Error('browser_session_expired');
    }
    return session;
  }

  assertActionAllowed(session, action) {
    const origin = targetOrigin(action);
    if (origin && session.allowedOrigins.length && !session.allowedOrigins.includes(origin)) {
      throw new Error('origin_denied');
    }
  }
}

async function performAction(session, action) {
  const webContents = session.window.webContents;
  switch (action.type) {
    case 'navigate':
      await webContents.loadURL(action.url);
      return snapshotFromWebContents(webContents);
    case 'navigateBack':
      if (typeof webContents.goBack === 'function') webContents.goBack();
      return snapshotFromWebContents(webContents);
    case 'snapshot':
    case 'captureEvidence':
      return snapshotFromWebContents(webContents);
    case 'readText':
      return { text: await webContents.executeJavaScript(readTextScript(action.selector), true) };
    case 'fill':
    case 'type':
      await webContents.executeJavaScript(fillScript(action.selector, action.value || ''), true);
      return { filled: true };
    case 'clear':
      await webContents.executeJavaScript(fillScript(action.selector, ''), true);
      return { cleared: true };
    case 'click':
    case 'requestSubmission':
      await webContents.executeJavaScript(clickScript(action.selector), true);
      return snapshotFromWebContents(webContents);
    case 'scroll':
      await webContents.executeJavaScript(`window.scrollBy(${Number(action.deltaX) || 0}, ${Number(action.deltaY) || 600}); true;`, true);
      return snapshotFromWebContents(webContents);
    case 'waitFor':
      await new Promise((resolve) => setTimeout(resolve, Math.min(Number(action.timeoutMs) || 250, 5000)));
      return snapshotFromWebContents(webContents);
    case 'closeSession':
      session.window.close();
      return { closed: true };
    default:
      throw new Error('unsupported_action');
  }
}

async function snapshotFromWebContents(webContents) {
  const url = typeof webContents.getURL === 'function' ? webContents.getURL() : '';
  const title = typeof webContents.getTitle === 'function' ? webContents.getTitle() : '';
  const text = await webContents.executeJavaScript(readTextScript(null), true).catch(() => '');
  return { url, title, origin: targetOrigin({ url }), text: String(text || '').slice(0, 50000) };
}

function sanitizeOwnedWebAction(action = {}) {
  if (!action || typeof action !== 'object' || Array.isArray(action)) throw new Error('invalid_action');
  if (!ALLOWED_ACTION_TYPES.has(action.type)) throw new Error('unsupported_action');
  if (action.script || action.cdpCommand || action.request || action.cookie || action.filesystemPath) {
    throw new Error('arbitrary_browser_code_denied');
  }
  const allowed = ['type', 'url', 'selector', 'value', 'deltaX', 'deltaY', 'timeoutMs', 'approvalId'];
  const out = {};
  for (const key of allowed) {
    if (action[key] !== undefined) out[key] = action[key];
  }
  if ((out.type === 'navigate') && !isSafeDesktopUrl(out.url)) throw new Error('url_denied');
  if (out.selector !== undefined) out.selector = String(out.selector).slice(0, 1024);
  if (out.value !== undefined) out.value = String(out.value).slice(0, 10000);
  return out;
}

function canonicalActionHash(action = {}) {
  const copy = { ...action };
  delete copy.approvalId;
  return crypto.createHash('sha256').update(stableJson(copy)).digest('hex');
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (!value || typeof value !== 'object') return JSON.stringify(value);
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
}

function actionRisk(action = {}) {
  if (CONSEQUENTIAL_ACTION_TYPES.has(action.type)) return 'legally_consequential_action';
  if (['fill', 'type', 'clear'].includes(action.type)) return 'local_form_preparation';
  if (['navigate', 'navigateBack', 'scroll', 'waitFor'].includes(action.type)) return 'navigation';
  return 'observation';
}

function redactAction(action = {}) {
  return {
    ...action,
    value: action.value === undefined ? undefined : '[REDACTED_FORM_VALUE]'
  };
}

function normalizeOrigins(origins) {
  return Array.from(new Set(origins.map((entry) => new URL(entry).origin)));
}

function targetOrigin(action = {}) {
  try {
    return action.url ? new URL(action.url).origin : null;
  } catch (_) {
    return null;
  }
}

function isSafeDesktopUrl(value) {
  try {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol)) return false;
    if (parsed.username || parsed.password) return false;
    const host = parsed.hostname.toLowerCase();
    return !(
      host === 'localhost' ||
      host === '0.0.0.0' ||
      host.startsWith('127.') ||
      host === '::1' ||
      host === '169.254.169.254' ||
      host.startsWith('10.') ||
      host.startsWith('192.168.') ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
    );
  } catch (_) {
    return false;
  }
}

function readTextScript(selector) {
  return `(() => {
    const target = ${selector ? `document.querySelector(${JSON.stringify(selector)})` : 'document.body'};
    return target ? String(target.innerText || target.textContent || '').slice(0, 50000) : '';
  })()`;
}

function fillScript(selector, value) {
  return `(() => {
    const el = document.querySelector(${JSON.stringify(selector || '')});
    if (!el) throw new Error('selector_not_found');
    el.focus();
    el.value = ${JSON.stringify(String(value))};
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`;
}

function clickScript(selector) {
  return `(() => {
    const el = document.querySelector(${JSON.stringify(selector || '')});
    if (!el) throw new Error('selector_not_found');
    el.click();
    return true;
  })()`;
}

function normalizeFilename(value) {
  const base = path.basename(String(value || 'upload.bin'))
    .normalize('NFKC')
    .replace(/[^\w.\- ]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
  return base && base !== '.' && base !== '..' ? base : 'upload.bin';
}

function hashForLog(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function publicSession(session) {
  return {
    id: session.id,
    executionTarget: session.executionTarget,
    status: session.status,
    allowedOrigins: session.allowedOrigins,
    stepCount: session.stepCount,
    stepBudget: session.stepBudget,
    expiresAt: session.expiresAt,
    partition: session.partition.startsWith('persist:') ? 'persisted_owned_web' : 'isolated_memory'
  };
}

module.exports = {
  OwnedWebDesktopBrowserManager,
  sanitizeOwnedWebAction,
  canonicalActionHash,
  isSafeDesktopUrl,
  normalizeFilename
};
