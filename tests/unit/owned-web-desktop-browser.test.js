const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  OwnedWebDesktopBrowserManager,
  sanitizeOwnedWebAction,
  canonicalActionHash,
  isSafeDesktopUrl,
  normalizeFilename
} = require('../../src/owned-web/desktop-browser');

describe('OwnedWebDesktopBrowserManager', () => {
  test('sanitizes typed actions and rejects arbitrary browser code', () => {
    expect(sanitizeOwnedWebAction({ type: 'snapshot' })).toEqual({ type: 'snapshot' });
    expect(() => sanitizeOwnedWebAction({ type: 'eval', script: 'document.cookie' })).toThrow(/unsupported_action/);
    expect(() => sanitizeOwnedWebAction({ type: 'snapshot', script: 'document.cookie' })).toThrow(/arbitrary_browser_code_denied/);
    expect(() => sanitizeOwnedWebAction({ type: 'navigate', url: 'file:///etc/passwd' })).toThrow(/url_denied/);
  });

  test('applies desktop URL policy before navigation', () => {
    expect(isSafeDesktopUrl('https://example.com')).toBe(true);
    expect(isSafeDesktopUrl('http://127.0.0.1:8080')).toBe(false);
    expect(isSafeDesktopUrl('http://169.254.169.254/latest/meta-data')).toBe(false);
    expect(isSafeDesktopUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeDesktopUrl('https://user:pass@example.com')).toBe(false);
  });

  test('opens isolated desktop-local sessions in main process only', async () => {
    const created = [];
    const manager = createManager({ created });
    const session = await manager.openSession(event(), {
      executionTarget: 'desktop_local',
      allowedOrigins: ['https://example.com/page'],
      show: false
    });

    expect(session.executionTarget).toBe('desktop_local');
    expect(session.allowedOrigins).toEqual(['https://example.com']);
    expect(session.partition).toBe('isolated_memory');
    expect(created[0].options.webPreferences).toMatchObject({
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    });
  });

  test('sender validation blocks unauthorized desktop IPC callers', async () => {
    const manager = createManager({
      assertSender: () => { throw new Error('unauthorized_sender'); }
    });

    await expect(manager.openSession(event(), { executionTarget: 'desktop_local' })).rejects.toThrow(/unauthorized_sender/);
  });

  test('approval is exact, one-time, and bound to the desktop session action', async () => {
    const manager = createManager();
    const session = await manager.openSession(event(), {
      executionTarget: 'desktop_local',
      allowedOrigins: ['https://example.com']
    });
    await manager.executeAction(event(), session.id, { type: 'navigate', url: 'https://example.com/form' });

    const preview = await manager.previewAction(event(), session.id, { type: 'requestSubmission', selector: '#submit' });

    expect(preview.data.approvalRequired).toBe(true);
    await expect(manager.executeAction(event(), session.id, { type: 'requestSubmission', selector: '#submit' })).rejects.toThrow(/approval_required/);
    await manager.decideApproval(event(), preview.data.approvalId, 'approved');
    await expect(manager.executeAction(event(), session.id, {
      type: 'requestSubmission',
      selector: '#submit',
      approvalId: preview.data.approvalId
    })).resolves.toMatchObject({ success: true });
    await expect(manager.executeAction(event(), session.id, {
      type: 'requestSubmission',
      selector: '#submit',
      approvalId: preview.data.approvalId
    })).rejects.toThrow(/approval_required/);
  });

  test('approval fails when the action changes after preview', async () => {
    const manager = createManager();
    const session = await manager.openSession(event(), {
      executionTarget: 'desktop_local',
      allowedOrigins: ['https://example.com']
    });
    const preview = await manager.previewAction(event(), session.id, { type: 'requestSubmission', selector: '#one' });
    await manager.decideApproval(event(), preview.data.approvalId, 'approved');

    await expect(manager.executeAction(event(), session.id, {
      type: 'requestSubmission',
      selector: '#two',
      approvalId: preview.data.approvalId
    })).rejects.toThrow(/approval_action_mismatch/);
  });

  test('upload selection returns brokered refs without exposing local paths', async () => {
    const tmp = path.join(os.tmpdir(), `lana-owned-web-upload-${Date.now()}.txt`);
    fs.writeFileSync(tmp, 'upload content');
    try {
      const manager = createManager({ filePaths: [tmp] });
      const result = await manager.chooseUploadFiles(event(), {});

      expect(result.success).toBe(true);
      expect(result.data.files[0]).toMatchObject({
        name: normalizeFilename(path.basename(tmp)),
        size: Buffer.byteLength('upload content'),
        contentType: 'application/octet-stream'
      });
      expect(result.data.files[0].hash).toHaveLength(64);
      expect(result.data.files[0].path).toBeUndefined();
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  });

  test('desktop downloads are forced into app-owned quarantine', async () => {
    const listeners = {};
    const manager = createManager({ sessionListeners: listeners });
    const session = await manager.openSession(event(), { executionTarget: 'desktop_local' });
    const setSavePath = jest.fn();

    listeners['will-download']({}, {
      getFilename: () => '../malicious name.pdf',
      setSavePath
    });

    expect(setSavePath).toHaveBeenCalledWith(expect.stringContaining(path.join('owned-web-quarantine', session.id)));
    expect(setSavePath.mock.calls[0][0]).toContain('malicious name.pdf');
  });

  test('canonical action hash ignores approval id', () => {
    expect(canonicalActionHash({ type: 'requestSubmission', selector: '#s' }))
      .toBe(canonicalActionHash({ type: 'requestSubmission', selector: '#s', approvalId: 'approval-1' }));
  });
});

function event() {
  return { sender: { id: 1 } };
}

function createManager(options = {}) {
  const created = options.created || [];
  let count = 0;
  class FakeBrowserWindow {
    constructor(windowOptions) {
      this.options = windowOptions;
      this.currentUrl = '';
      this.closed = false;
      this.webContents = {
        session: {
          on: jest.fn((name, handler) => {
            if (options.sessionListeners) options.sessionListeners[name] = handler;
          })
        },
        loadURL: jest.fn(async (target) => { this.currentUrl = target; }),
        getURL: jest.fn(() => this.currentUrl),
        getTitle: jest.fn(() => 'Fixture page'),
        executeJavaScript: jest.fn(async () => 'Fixture text')
      };
      created.push(this);
    }
    on() {}
    close() { this.closed = true; }
  }
  return new OwnedWebDesktopBrowserManager({
    BrowserWindow: FakeBrowserWindow,
    dialog: {
      showOpenDialog: jest.fn(async () => ({
        canceled: false,
        filePaths: options.filePaths || []
      }))
    },
    app: { getPath: jest.fn(() => os.tmpdir()) },
    assertSender: options.assertSender || (() => true),
    randomBytes: () => Buffer.from(String(++count).padStart(16, '0')),
    clock: () => new Date('2026-08-02T00:00:00.000Z')
  });
}
