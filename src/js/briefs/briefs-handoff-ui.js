/**
 * LANA Briefs: the handoff prompts the phone gateway asks for, over every page (the port
 * of the standalone app's HandoffLayer). While a phone hands off a meeting the host
 * reports a HandoffView (briefs/packages/host/src/shared/api.ts):
 *   - qr: the tone did not reach the phone; a dialog shows the code for the phone to scan.
 *   - approval: the firm asks the person at this computer to allow the phone.
 *   - tone, receiving, failed: a short status toast.
 *   - idle, received: nothing (a received meeting shows in the Briefs sidebar).
 * promptFor() is plain and covered by tests/unit/briefs/briefs-handoff-ui.test.js; start()
 * is the DOM side, started once per page by lex-app when window.lanaBriefs exists.
 */
(function (global) {
  'use strict';

  /** What to show for one HandoffView. */
  function promptFor(view) {
    switch (view && view.kind) {
      case 'qr':
        return {
          kind: 'qr',
          key: 'qr:' + view.handoffId,
          heading: 'Scan with your phone',
          qrText: String(view.qrText || ''),
          body: 'The tone did not reach your phone. Scan this code in LANA Briefs to finish sending.'
        };
      case 'approval': {
        const name = String(view.phoneName || '').trim();
        return {
          kind: 'approval',
          key: 'approval:' + view.handoffId,
          handoffId: view.handoffId,
          heading: 'Allow ' + (name || 'your phone') + ' to send meetings?',
          body: 'Allow only if ' + (name || 'your phone') + ' is in the room with you now. LANA will receive its meetings over the paired, encrypted connection.'
        };
      }
      case 'tone':
        return {
          kind: 'toast',
          key: 'tone:' + view.handoffId + ':' + view.play,
          level: 'info',
          text: Number(view.play) <= 1 ? 'Playing the proximity tone for your phone' : 'Playing the proximity tone again (' + view.play + ' of 3)'
        };
      case 'receiving':
        return { kind: 'toast', key: 'receiving:' + view.handoffId, level: 'info', text: 'Receiving a meeting from your phone' };
      case 'failed':
        return { kind: 'toast', key: 'failed:' + view.handoffId, level: 'error', text: String(view.message || 'The handoff did not finish. Try again from your phone.') };
      default:
        return { kind: 'none', key: 'none' };
    }
  }

  let started = false;
  let modal = null;
  let shownKey = 'none';

  function escapeText(value) {
    return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function closeModal() {
    if (!modal) return;
    const current = modal;
    modal = null;
    current.removeAttribute('open');
    current.remove();
  }

  function openModal(prompt, api) {
    closeModal();
    const el = document.createElement('lex-modal');
    el.setAttribute('heading', prompt.heading);
    el.setAttribute('size', 'sm');
    el.setAttribute('data-hoist', '');
    if (prompt.kind === 'qr') {
      el.setAttribute('hide-actions', '');
      el.setAttribute('close-on-escape', 'false');
      el.setAttribute('close-on-overlay', 'false');
      el.setAttribute('hide-close', '');
    } else {
      el.setAttribute('confirm-text', 'Allow');
      el.setAttribute('cancel-text', 'Deny');
      el.setAttribute('close-on-overlay', 'false');
    }
    const body = document.createElement('div');
    body.className = 'briefs-handoff';
    body.innerHTML = prompt.kind === 'qr'
      ? '<div class="briefs-handoff-qr" data-handoff-qr></div><p class="briefs-handoff-note">' + escapeText(prompt.body) + '</p>'
      : '<p class="briefs-handoff-note">' + escapeText(prompt.body) + '</p>';
    el.appendChild(body);
    if (prompt.kind === 'approval') {
      let answered = false;
      const answer = (approved) => {
        if (answered) return;
        answered = true;
        Promise.resolve(api.handoff.answerApproval(prompt.handoffId, approved)).then(show, () => show({ kind: 'idle' }));
      };
      el.addEventListener('lex-confirm', () => answer(true));
      el.addEventListener('lex-cancel', () => answer(false));
      el.addEventListener('lex-close', () => answer(false));
    }
    document.body.appendChild(el);
    modal = el;
    el.setAttribute('open', '');
    if (prompt.kind === 'qr') {
      const box = (el.contentRoot || el).querySelector('[data-handoff-qr]');
      if (box && global.QRCode) {
        global.QRCode.toString(prompt.qrText, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }).then((svg) => {
          if (box.isConnected) box.innerHTML = svg;
        }, () => {
          if (box.isConnected) box.textContent = 'The code could not be drawn. Send again from your phone.';
        });
      } else if (box) {
        box.textContent = 'The code could not be drawn. Send again from your phone.';
      }
    }
  }

  function show(view, api) {
    const prompt = promptFor(view);
    if (prompt.key === shownKey) return;
    shownKey = prompt.key;
    if (prompt.kind === 'qr' || prompt.kind === 'approval') {
      openModal(prompt, api || global.lanaBriefs);
      return;
    }
    closeModal();
    if (prompt.kind === 'toast' && global.Lex && global.Lex.Toast) {
      (global.Lex.Toast[prompt.level] || global.Lex.Toast.info)(prompt.text);
    }
  }

  /** Follows the host's handoff view on this page. Safe to call more than once. */
  function start(api) {
    if (started || !api || !api.handoff || typeof api.onEvent !== 'function') return false;
    started = true;
    api.onEvent((event) => {
      if (event && event.type === 'handoff') show(event.view, api);
    });
    Promise.resolve(api.handoff.state()).then((view) => show(view, api), () => {});
    return true;
  }

  const exported = { promptFor, start };
  global.BriefsHandoffUI = exported;
  if (typeof module !== 'undefined' && module.exports) module.exports = exported;
})(typeof window !== 'undefined' ? window : globalThis);
