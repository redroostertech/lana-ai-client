'use strict';

const { runHelper } = require('./native-helper');
const { sanitizeContext } = require('./context-sanitizer');
const { fingerprintsMatch } = require('./target-fingerprint');

class UnsupportedDesktopAdapter {
  constructor(platform) { this.platform = platform; }
  async permissionStatus() { return { accessibility: false, supported: false, platform: this.platform }; }
  async requestPermission() { return this.permissionStatus(); }
  async getContext() {
    const error = new Error('Screen-aware dictation is not yet supported on this operating system.');
    error.code = 'PLATFORM_UNSUPPORTED';
    throw error;
  }
  async insert() { return this.getContext(); }
  async replaceSelection() { return this.getContext(); }
  async undo() { return this.getContext(); }
}

class MacDesktopAdapter {
  constructor(options = {}) {
    this.run = options.runHelper || runHelper;
    this.clipboard = options.clipboard;
    this.sleep = options.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.lastMutation = null;
  }

  async permissionStatus() {
    const result = await this.run('permission-status');
    return { accessibility: Boolean(result.trusted), supported: true, platform: 'darwin' };
  }

  async requestPermission() {
    const result = await this.run('request-permission');
    return { accessibility: Boolean(result.trusted), supported: true, platform: 'darwin' };
  }

  async getContext(options = {}) {
    const result = await this.run('context');
    return sanitizeContext(result.context, { maxChars: options.maxChars });
  }

  async getTarget() {
    const result = await this.run('target');
    return sanitizeContext(result.context, { maxChars: 1000 });
  }

  async activate(fingerprint) {
    await this.run('activate', { targetFingerprint: fingerprint });
  }

  async assertTarget(fingerprint, requireSelection = false) {
    const context = await this.getContext();
    if (!fingerprintsMatch(fingerprint, context.targetFingerprint, { requireSelection })) {
      const error = new Error('The active application or text target changed.');
      error.code = 'TARGET_CHANGED';
      throw error;
    }
    return context;
  }

  snapshotClipboard() {
    if (!this.clipboard) return null;
    return this.clipboard.availableFormats().map((format) => ({ format, data: this.clipboard.readBuffer(format) }));
  }

  restoreClipboard(snapshot) {
    if (!this.clipboard || !snapshot) return;
    this.clipboard.clear();
    snapshot.forEach(({ format, data }) => this.clipboard.writeBuffer(format, data));
  }

  async mutate(command, text, fingerprint) {
    await this.activate(fingerprint);
    await this.assertTarget(fingerprint, command === 'replace');
    let result = await this.run(command, { text, targetFingerprint: fingerprint });
    if (result.fallback === 'clipboard_paste') {
      if (!this.clipboard) {
        const error = new Error('Clipboard paste fallback is unavailable.');
        error.code = 'INSERTION_UNAVAILABLE';
        throw error;
      }
      const snapshot = this.snapshotClipboard();
      try {
        this.clipboard.writeText(text);
        result = await this.run('paste', { targetFingerprint: fingerprint });
        await this.sleep(160);
      } finally {
        this.restoreClipboard(snapshot);
      }
    }
    this.lastMutation = { fingerprint, command, at: Date.now() };
    return result;
  }

  insert(text, fingerprint) { return this.mutate('insert', text, fingerprint); }
  replaceSelection(text, fingerprint) { return this.mutate('replace', text, fingerprint); }

  async undo() {
    if (!this.lastMutation || Date.now() - this.lastMutation.at > 10 * 60 * 1000) {
      const error = new Error('There is no recent voice edit to undo.');
      error.code = 'UNDO_UNAVAILABLE';
      throw error;
    }
    await this.activate(this.lastMutation.fingerprint);
    const result = await this.run('undo', { targetFingerprint: this.lastMutation.fingerprint });
    this.lastMutation = null;
    return result;
  }
}

function createDesktopAdapter(options = {}) {
  const platform = options.platform || process.platform;
  return platform === 'darwin' ? new MacDesktopAdapter(options) : new UnsupportedDesktopAdapter(platform);
}

module.exports = { UnsupportedDesktopAdapter, MacDesktopAdapter, createDesktopAdapter };
