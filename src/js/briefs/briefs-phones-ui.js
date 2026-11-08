/**
 * LANA Briefs pages' shared phone and first-run pieces, used by the Dashboard
 * (src/briefs/dashboard.js) and the meeting page (src/briefs/app.js):
 * - the top bar's phone status icon and its hover card (lex-topbar statusIcon and friends);
 * - Phones: paired phones, pairing (QR code, then the six digits confirmed on both
 *   screens) and removing a phone, in a lex-modal this module adds to the page;
 * - the walkthrough (<lex-walkthrough>), shown once per person; the host remembers.
 * Settings > Connected devices (src/js/pages/settings-briefs.js) uses Phones only: attach(container,
 * { topbar: false, walkthrough: false }).
 * The rules are in briefs-status.js and briefs-walkthrough.js. Nothing here logs names.
 */
(function (global) {
  'use strict';

  const P = global.BriefsStatus;
  const W = global.BriefsWalkthrough;
  const DEVICE_NOUN = 'computer';

  function bridge() {
    return global.lanaBriefs || null;
  }

  function escape(text) {
    return global.Lex.Utils.escapeHtml(String(text == null ? '' : text));
  }

  function icon(name) {
    const Icons = global.Lex && global.Lex.Icons;
    return Icons && Icons.has(name) ? String(Icons[name].small) : '';
  }

  const phone = { gateway: null, preferences: null, phones: null, pairing: { kind: 'idle' }, removing: null, error: null };
  const listeners = new Set();
  let modal = null;
  let body = null;
  let host = null;
  let pairingTimer = null;
  let loadToken = 0;
  let globalsBound = false;
  let options = { topbar: true, walkthrough: true };

  /** This module's pieces are on screen (the shell swaps pages in place). */
  function onPage() {
    return Boolean(host && document.contains(host));
  }

  // ── Status ────────────────────────────────────────────

  async function refresh() {
    const api = bridge();
    if (!api || !api.devices) return;
    const token = ++loadToken;
    const settle = (work) => Promise.resolve().then(work).catch(() => null);
    const [gateway, preferences, phones] = await Promise.all([
      settle(() => api.devices.gatewayStatus()),
      settle(() => (api.preferences ? api.preferences.get() : null)),
      settle(() => api.devices.list()),
    ]);
    if (token !== loadToken) return;
    phone.gateway = gateway;
    phone.preferences = preferences;
    phone.phones = phones && phones.ok ? phones.value : phone.phones;
    renderStatus();
    if (phonesOpen()) renderPhones();
    listeners.forEach((listener) => listener(card()));
  }

  /** The status card as briefs-status.js shapes it, for the top bar and the Dashboard. */
  function card() {
    return P.statusCard(phone.gateway, phone.preferences, phone.phones || []);
  }

  function renderStatus() {
    const topbar = document.querySelector('lex-topbar');
    if (!topbar || !onPage() || !options.topbar) return;
    const view = card();
    topbar.statusIcon = view.icon;
    topbar.statusLabel = view.label;
    topbar.statusTone = view.tone;
    topbar.statusSummary = view.summary;
    topbar.statusRows = view.rows;
    topbar.statusAction = view.action;
  }

  // ── Phones dialog ─────────────────────────────────────

  function phonesOpen() {
    return Boolean(modal && modal.open);
  }

  async function openPhones() {
    if (!onPage() || !modal) return;
    phone.removing = null;
    phone.error = null;
    try {
      phone.pairing = await bridge().devices.pairingState();
    } catch (_) {
      phone.pairing = { kind: 'idle' };
    }
    modal.open = true;
    renderPhones();
    // No phone yet: go straight to the code, which is why the person came.
    if ((phone.phones || []).length === 0 && phone.pairing.kind === 'idle') startPairing();
  }

  /** Closing Phones mid pairing cancels it, so the listener closes again. */
  function onClosed() {
    stopTimer();
    if (P.pairingActive(phone.pairing)) bridge().devices.cancelPairing().catch(() => {});
    else if (phone.pairing.kind !== 'idle') bridge().devices.resetPairing().catch(() => {});
    phone.pairing = { kind: 'idle' };
  }

  async function startPairing() {
    phone.error = null;
    phone.pairing = { kind: 'starting' };
    renderPhones();
    try {
      setPairing(await bridge().devices.startPairing());
    } catch (_) {
      setPairing({ kind: 'failed', message: 'LANA could not start pairing. Try again.' });
    }
  }

  function setPairing(next) {
    phone.pairing = P.pairingShown(next, phone.pairing);
    if (next && next.kind === 'paired') refresh();
    if (phonesOpen()) renderPhones();
  }

  function stopTimer() {
    if (pairingTimer) clearInterval(pairingTimer);
    pairingTimer = null;
  }

  function codeLeft(expiresAt) {
    return P.countdown((Date.parse(expiresAt) - Date.now()) / 1000);
  }

  function pairingHtml(pairing) {
    switch (pairing.kind) {
      case 'starting':
        return '<div class="briefs-pair-panel briefs-pair-busy" role="status"><lex-spinner size="sm"></lex-spinner><span>Preparing a pairing code</span></div>';
      case 'saving':
        return '<div class="briefs-pair-panel briefs-pair-busy" role="status"><lex-spinner size="sm"></lex-spinner><span>Saving the pairing</span></div>';
      case 'showingCode':
        return `<div class="briefs-pair-panel briefs-pair-qr">
            <div class="briefs-pair-code" data-pair-qr aria-label="Pairing code to scan" role="img"></div>
            <div class="briefs-pair-text">
              <p class="briefs-overline">Pair a phone</p>
              <p class="briefs-pair-title">Open Briefs on your phone and scan this code.</p>
              <p class="briefs-pair-note">The code works once and expires in <span data-pair-left>${codeLeft(pairing.expiresAt)}</span>.</p>
              <p class="briefs-pair-waiting"><lex-spinner size="sm"></lex-spinner>Waiting for the phone</p>
              <div><lex-btn variant="secondary" size="sm" data-pair="cancel">Cancel</lex-btn></div>
            </div>
          </div>`;
      case 'confirming':
        return `<div class="briefs-pair-panel briefs-pair-confirm">
            <p class="briefs-overline">Confirm the code</p>
            <p class="briefs-pair-title">Does ${escape(pairing.phoneName || 'your phone')} show this code?</p>
            <div class="briefs-pair-digits" role="img" aria-label="Code ${escape(String(pairing.code || '').split('').join(' '))}">${String(pairing.code || '').split('').map((digit, index) => `<span class="briefs-pair-digit${index === 3 ? ' is-group-start' : ''}">${escape(digit)}</span>`).join('')}</div>
            <p class="briefs-pair-note">Both screens must show the same six digits. If they differ, cancel: someone may be in between.</p>
            <div class="briefs-pair-buttons">
              <lex-btn variant="secondary" size="sm" data-pair="reject">Cancel</lex-btn>
              <lex-btn variant="primary" size="sm" leading-icon="check" data-pair="accept">Codes match, pair</lex-btn>
            </div>
          </div>`;
      case 'paired':
        return `<div class="briefs-pair-panel briefs-pair-outcome is-good" role="status">
            <lex-brand-mark class="briefs-pair-mark" animation="success" size="48" label="Paired"></lex-brand-mark>
            <p class="briefs-pair-title">${escape(pairing.phoneName || 'Your phone')} is paired. It can now send meetings to this ${DEVICE_NOUN}.</p>
            <lex-btn variant="secondary" size="sm" data-pair="done">Done</lex-btn>
          </div>`;
      case 'expired':
        return `<div class="briefs-pair-panel briefs-pair-outcome is-warning" role="status">
            <p class="briefs-pair-title">The pairing code expired. Show a new one when your phone is ready.</p>
            <lex-btn variant="secondary" size="sm" leading-icon="refresh-cw" data-pair="start">New code</lex-btn>
          </div>`;
      case 'failed':
        return `<div class="briefs-pair-panel briefs-pair-outcome is-warning" role="alert">
            <p class="briefs-pair-title">${escape(pairing.message || 'Pairing did not work.')}</p>
            <lex-btn variant="secondary" size="sm" data-pair="start">Try again</lex-btn>
          </div>`;
      default:
        return '';
    }
  }

  function phoneListHtml() {
    const phones = phone.phones || [];
    if (phones.length === 0) return '<p class="briefs-list-note">No phone paired yet.</p>';
    const when = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
    return `<p class="briefs-overline">Paired</p><ul class="briefs-phone-list">${phones.map((item) => {
      const name = escape(item.displayName || 'Phone');
      const removing = phone.removing === item.id;
      const date = item.pairedAt && !Number.isNaN(Date.parse(item.pairedAt)) ? `Paired ${when.format(new Date(item.pairedAt))}` : 'Paired';
      return `<li class="briefs-phone-row${removing ? ' is-removing' : ''}">
          <span class="briefs-share-phone" aria-hidden="true">${icon('smartphone')}</span>
          <span class="briefs-share-text"><span class="briefs-share-name">${name}</span><span class="briefs-share-status">${escape(date)}</span></span>
          ${removing
            ? `<span class="briefs-phone-confirm"><lex-btn variant="ghost" size="sm" data-phone-keep>Keep</lex-btn><lex-btn variant="danger" size="sm" data-phone-remove-yes="${escape(item.id)}">Remove</lex-btn></span>`
            : `<lex-btn variant="secondary" size="sm" data-phone-remove="${escape(item.id)}">Remove</lex-btn>`}
        </li>${removing ? `<li class="briefs-phone-warning">${name} will no longer be able to send meetings here. Meetings already received stay. To use it again, pair it again.</li>` : ''}`;
    }).join('')}</ul>`;
  }

  function renderPhones() {
    if (!body) return;
    const pairing = phone.pairing || { kind: 'idle' };
    const busy = pairing.kind !== 'idle';
    body.innerHTML = `
      <p class="briefs-phones-lead">Only paired phones can send meetings to this ${DEVICE_NOUN}. It listens on your network only while a phone is paired, or while you pair one.</p>
      ${busy ? pairingHtml(pairing) : '<div><lex-btn variant="primary" size="sm" leading-icon="smartphone" data-pair="start">Pair a phone</lex-btn></div>'}
      ${phone.error ? `<p class="briefs-meeting-error briefs-phones-error" role="alert">${escape(phone.error)}</p>` : ''}
      <section class="briefs-phones-paired" aria-label="Paired phones">${phoneListHtml()}</section>`;
    stopTimer();
    if (pairing.kind === 'showingCode') {
      drawQr(pairing.qrText);
      pairingTimer = setInterval(() => {
        const left = body.querySelector('[data-pair-left]');
        if (left) left.textContent = codeLeft(pairing.expiresAt);
      }, 1000);
    }
  }

  function drawQr(text) {
    const box = body.querySelector('[data-pair-qr]');
    if (!box || !global.QRCode) return;
    global.QRCode.toString(text, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }).then((svg) => {
      if (box.isConnected) box.innerHTML = svg;
    }, () => {
      if (box.isConnected) box.textContent = 'The code could not be drawn. Cancel and try again.';
    });
  }

  async function removePhone(id) {
    phone.removing = null;
    let result = null;
    try {
      result = await bridge().devices.revoke(id);
    } catch (_) {
      result = null;
    }
    phone.error = result && result.ok ? null : ((result && result.error && result.error.message) || 'LANA could not remove that phone. Try again.');
    await refresh();
    renderPhones();
  }

  function onPhonesClick(event) {
    const target = event.target;
    const pair = target.closest('[data-pair]');
    if (pair) {
      const what = pair.dataset.pair;
      const devices = bridge().devices;
      if (what === 'start') startPairing();
      else if (what === 'cancel') devices.cancelPairing().then(setPairing, () => {});
      else if (what === 'reject') devices.answerPairing(false).then(setPairing, () => {});
      else if (what === 'accept') devices.answerPairing(true).then(setPairing, () => {});
      else if (what === 'done') devices.resetPairing().then(() => setPairing({ kind: 'idle' }), () => {});
      return;
    }
    const remove = target.closest('[data-phone-remove]');
    if (remove) {
      phone.removing = remove.dataset.phoneRemove;
      renderPhones();
      return;
    }
    if (target.closest('[data-phone-keep]')) {
      phone.removing = null;
      renderPhones();
      return;
    }
    const yes = target.closest('[data-phone-remove-yes]');
    if (yes) removePhone(yes.dataset.phoneRemoveYes);
  }

  // ── Walkthrough ───────────────────────────────────────

  async function signedInUserID() {
    try {
      const account = await bridge().account.state();
      return account && account.kind === 'signedIn' && account.user ? String(account.user.id) : null;
    } catch (_) {
      return null;
    }
  }

  /** First run: shows the walkthrough unless this person has seen it. */
  async function maybeShowWalkthrough() {
    const api = bridge();
    if (!api || !api.settings || !W) return;
    const userID = await signedInUserID();
    if (userID === null || !onPage()) return;
    let seen = true;
    try {
      seen = await api.settings.walkthroughCompleted(userID);
    } catch (_) {
      seen = true;
    }
    if (!seen && onPage()) showWalkthrough(userID);
  }

  /** Shows the walkthrough now (the Dashboard's button). */
  async function showWalkthrough(knownUserID) {
    if (!W || document.querySelector('lex-walkthrough')) return;
    const userID = knownUserID || await signedInUserID();
    const tour = document.createElement('lex-walkthrough');
    tour.className = 'briefs-tour';
    tour.brand = 'BRIEFS.';
    tour.pages = W.pages(icon, DEVICE_NOUN);
    tour.addEventListener('lex-walkthrough-done', (event) => {
      if (userID) bridge().settings.setWalkthroughCompleted(userID).catch(() => {});
      if (event.detail && event.detail.action === 'pair') openPhones();
    });
    document.body.appendChild(tour);
  }

  // ── Setup ─────────────────────────────────────────────

  function onEvent(event) {
    if (!event || !onPage()) return;
    if (event.type === 'pairing') setPairing(event.state);
    if (event.type === 'gateway' || event.type === 'preferences' || event.type === 'pairing') refresh();
  }

  /**
   * Called by each Briefs page's init with an element that lives in the page content
   * (Phones is added there, so it goes when the shell swaps the page). Loads the status
   * and, on first run, the walkthrough. `settings.topbar` and `settings.walkthrough`
   * (both default true) turn those off for pages outside Briefs.
   */
  function attach(container, settings) {
    host = container;
    options = Object.assign({ topbar: true, walkthrough: true }, settings || {});
    stopTimer();
    modal = document.createElement('lex-modal');
    modal.id = 'briefs-phones';
    modal.setAttribute('heading', 'Phones');
    modal.setAttribute('size', 'md');
    modal.setAttribute('hide-actions', '');
    body = document.createElement('div');
    body.className = 'briefs-phones';
    modal.appendChild(body);
    container.appendChild(modal);
    // The modal renders its own body around the child; keep the reference to the live node.
    body = modal.querySelector('.briefs-phones') || body;
    modal.addEventListener('click', (event) => {
      if (body && body.contains(event.target)) onPhonesClick(event);
    });
    modal.addEventListener('lex-close', onClosed);
    modal.addEventListener('lex-cancel', onClosed);
    if (!globalsBound) {
      globalsBound = true;
      document.addEventListener('topbar-status-action', () => {
        if (onPage() && options.topbar) openPhones();
      });
      const api = bridge();
      if (api && typeof api.onEvent === 'function') api.onEvent(onEvent);
    }
    refresh();
    if (options.walkthrough) maybeShowWalkthrough();
  }

  /** Called with the status card whenever it changes (the Dashboard's phone card). */
  function subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  global.BriefsPhonesUI = { attach, refresh, card, openPhones, showWalkthrough, subscribe };
})(typeof window !== 'undefined' ? window : globalThis);
