// src/js/shared/file-content-errors.js
// A document whose stored file is gone. Chef answers every read of it
// (download, view, version, shared link, editor and redline open) with
// 410 and the code FILE_CONTENT_MISSING (LANA-AI shared/errors/app.error.js
// FileContentMissingError). Viewers show one plain sentence for it instead of
// the raw response. Pure functions, no DOM; loaded as window.LanaFileContentErrors.
(function (root) {
  'use strict';

  var CODE = 'FILE_CONTENT_MISSING';
  var MESSAGE = 'The original file is missing.';

  /** The error code in a response body ({ error: { code } } or { code }), or null. */
  function codeFromBody(bodyText) {
    if (typeof bodyText !== 'string' || !bodyText) return null;
    var data;
    try {
      data = JSON.parse(bodyText);
    } catch (_) {
      return null;
    }
    if (!data || typeof data !== 'object') return null;
    var code = data.error && typeof data.error === 'object' ? data.error.code : data.code;
    return typeof code === 'string' && code ? code : null;
  }

  /** True for an error (or a bare code) that says the stored file is gone. */
  function isFileContentMissing(errorOrCode) {
    if (typeof errorOrCode === 'string') return errorOrCode === CODE;
    return !!errorOrCode && errorOrCode.code === CODE;
  }

  /**
   * What a viewer shows for a failed load: the missing-file sentence, or the
   * caller's prefix with the error's own message.
   */
  function viewerMessage(error, prefix) {
    if (isFileContentMissing(error)) return MESSAGE;
    var detail = error && error.message ? error.message : 'Unknown error';
    return prefix ? prefix + ': ' + detail : detail;
  }

  /**
   * What to say for a failed download or open response (a fetch Response, or
   * anything with text()): the missing-file sentence for FILE_CONTENT_MISSING,
   * otherwise the caller's own message.
   */
  async function failureMessage(response, fallback) {
    var text = '';
    try {
      text = response && typeof response.text === 'function' ? await response.text() : '';
    } catch (_) {
      text = '';
    }
    return isFileContentMissing(codeFromBody(text)) ? MESSAGE : fallback;
  }

  var api = {
    CODE: CODE,
    MESSAGE: MESSAGE,
    codeFromBody: codeFromBody,
    isFileContentMissing: isFileContentMissing,
    viewerMessage: viewerMessage,
    failureMessage: failureMessage
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.LanaFileContentErrors = api;
})(typeof window !== 'undefined' ? window : null);
