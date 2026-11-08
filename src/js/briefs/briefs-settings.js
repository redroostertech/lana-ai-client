/**
 * LANA Briefs in the client's Settings (settings-v2): the view rules for the Phone section,
 * the meeting audio row in Data controls and the speech model rows under Capabilities.
 * The page controller is src/js/pages/settings-briefs.js; the host owns every rule about
 * what a setting does (preferencesService.ts, modelService.ts). This file only shapes text.
 */
(function (global) {
  'use strict';

  const DEVICE_NOUN = 'computer';

  /** Retention choices offered; the current value is added when it is something else. */
  const RETENTION_PRESETS = [7, 30, 90, 180, 365];

  /**
   * Speech models shown in Settings. Listening and the LANA voice serve Talk, which the
   * client does not have yet; they join this list when it does.
   */
  const SHOWN_MODELS = ['transcription'];

  function daysLabel(days) {
    if (days === 365) return '1 year';
    if (days === 1) return '1 day';
    return `${days} days`;
  }

  /** Options for the "Keep meeting audio" select, in order, as strings for lex-select. */
  function retentionChoices(current, range) {
    const min = range && Number.isFinite(range.min) ? range.min : 1;
    const max = range && Number.isFinite(range.max) ? range.max : 3650;
    const values = RETENTION_PRESETS.filter((days) => days >= min && days <= max);
    if (Number.isFinite(current) && values.indexOf(current) === -1) values.push(current);
    return values.sort((a, b) => a - b).map((days) => ({ value: String(days), label: daysLabel(days) }));
  }

  function hoursLabel(hours) {
    return hours === 1 ? '1 hour' : `${hours} hours`;
  }

  /** Options for the lease length segmented control. */
  function leaseChoices(background) {
    const choices = background && Array.isArray(background.leaseHourChoices) ? background.leaseHourChoices : [];
    return choices.map((hours) => ({ value: String(hours), label: hoursLabel(hours) }));
  }

  /** The proximity check rows: the tone (always on) and the three choices the person makes. */
  function proximityRows(preferences) {
    const prefs = preferences || {};
    return [
      { key: 'tone', title: `Tone from this ${DEVICE_NOUN}'s speaker`, detail: `Always on. The phone hears a one-time code played by this ${DEVICE_NOUN}.`, checked: true, disabled: true },
      { key: 'requireMacClick', title: `Require a click on this ${DEVICE_NOUN} after the tone`, detail: `Someone at this ${DEVICE_NOUN} approves every handoff, even when the tone worked.`, checked: Boolean(prefs.requireMacClick), disabled: false },
      { key: 'allowQR', title: 'Allow the QR fallback', detail: `When the tone fails, this ${DEVICE_NOUN} shows a code the phone scans.`, checked: Boolean(prefs.allowQR), disabled: false },
      { key: 'allowMacApproval', title: `Allow approval on this ${DEVICE_NOUN}`, detail: `When the tone and QR code fail, someone at this ${DEVICE_NOUN} can let the phone in.`, checked: Boolean(prefs.allowMacApproval), disabled: false },
    ];
  }

  /** StatusTone (host) to lex-badge color. */
  function badgeColor(tone) {
    if (tone === 'good') return 'green';
    if (tone === 'warning') return 'yellow';
    if (tone === 'danger') return 'red';
    return 'gray';
  }

  /** One speech model row: its badge, its button and the line under it. */
  function modelRow(status) {
    const state = (status && status.state) || { kind: 'notDownloaded' };
    const size = status && status.sizeText ? status.sizeText : '';
    const base = { id: status.id, title: status.title, detail: status.detail, progress: null, note: '' };
    switch (state.kind) {
      case 'ready':
        return Object.assign(base, { badge: 'Ready', color: 'green', action: status.shared ? null : 'remove', actionLabel: 'Remove download', note: size ? `About ${size} on this ${DEVICE_NOUN}.` : '' });
      case 'downloading': {
        const percent = Math.max(0, Math.min(100, Math.round((Number(state.progress) || 0) * 100)));
        return Object.assign(base, { badge: `Downloading ${percent}%`, color: 'blue', action: 'remove', actionLabel: 'Cancel', progress: percent, note: size ? `One time, about ${size}. Wi-Fi recommended.` : '' });
      }
      case 'failed':
        return Object.assign(base, { badge: 'Not downloaded', color: 'red', action: 'download', actionLabel: 'Try again', note: state.message || 'The download did not finish.' });
      default:
        return Object.assign(base, { badge: 'Not downloaded', color: 'gray', action: 'download', actionLabel: 'Download', note: size ? `A one-time download of about ${size}, kept on this ${DEVICE_NOUN}.` : '' });
    }
  }

  /** The rows for the speech models card, in SHOWN_MODELS order, skipping any the host did not send. */
  function modelRows(status) {
    if (!status) return [];
    return SHOWN_MODELS.filter((id) => status[id]).map((id) => modelRow(status[id]));
  }

  const api = { retentionChoices, leaseChoices, proximityRows, badgeColor, modelRows, daysLabel, hoursLabel };
  global.BriefsSettings = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
