'use strict';

const { MAX_CONTEXT_CHARS } = require('./contracts');

const SENSITIVE_NAME = /(?:password|passcode|pin|security code|credit card|card number|cvv|secret|token|api key)/i;

function truncateText(value, maxChars = MAX_CONTEXT_CHARS) {
  const text = String(value || '').replace(/\u0000/g, '');
  if (text.length <= maxChars) return { text, truncated: false, originalCharacters: text.length };
  const head = Math.ceil(maxChars * 0.7);
  const tail = Math.max(0, maxChars - head - 24);
  return {
    text: `${text.slice(0, head)}\n…[context truncated]…\n${text.slice(-tail)}`,
    truncated: true,
    originalCharacters: text.length
  };
}

function sanitizeContext(raw = {}, options = {}) {
  const focused = raw.focusedElement || {};
  const sensitive = Boolean(focused.isPassword || SENSITIVE_NAME.test(`${focused.name || ''} ${focused.role || ''}`));
  const budget = Math.min(MAX_CONTEXT_CHARS, Math.max(1000, Number(options.maxChars) || MAX_CONTEXT_CHARS));
  if (sensitive) {
    return {
      ...raw,
      focusedElement: { ...focused, value: '', isPassword: true },
      selectedText: '',
      surroundingText: '',
      accessibleDocumentText: '',
      nearbyControls: [],
      screenshotReference: null,
      truncationMetadata: { truncated: false, originalCharacters: 0, retainedCharacters: 0 }
    };
  }

  const selected = truncateText(raw.selectedText, Math.min(4000, budget));
  const remainingAfterSelection = Math.max(0, budget - selected.text.length);
  const surrounding = truncateText(raw.surroundingText, Math.min(4000, remainingAfterSelection));
  const remaining = Math.max(0, remainingAfterSelection - surrounding.text.length);
  const document = truncateText(raw.accessibleDocumentText, remaining);
  const originalCharacters = selected.originalCharacters + surrounding.originalCharacters + document.originalCharacters;
  const retainedCharacters = selected.text.length + surrounding.text.length + document.text.length;

  return {
    ...raw,
    focusedElement: { ...focused, value: truncateText(focused.value, Math.min(2000, budget)).text },
    selectedText: selected.text,
    surroundingText: surrounding.text,
    accessibleDocumentText: document.text,
    nearbyControls: Array.isArray(raw.nearbyControls) ? raw.nearbyControls.slice(0, 20) : [],
    screenshotReference: null,
    truncationMetadata: {
      truncated: selected.truncated || surrounding.truncated || document.truncated,
      originalCharacters,
      retainedCharacters
    }
  };
}

module.exports = { SENSITIVE_NAME, truncateText, sanitizeContext };
