/* Lex.Utils — canonical utility functions (Category A: stateless singleton).
   Loaded once in the SPA shell. All pages use Lex.Utils.* for these helpers.
   Backward-compat globals at the bottom keep existing code working. */

(function (global) {
  'use strict';

  global.Lex = global.Lex || {};

  // ── HTML escaping (no regex) ──────────────────────────────────────────

  var HTML_ESCAPE_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };

  function escapeHtml(unsafe) {
    if (unsafe === null || unsafe === undefined) return '';
    var str = String(unsafe);
    var out = '';
    for (var i = 0; i < str.length; i++) {
      var ch = str.charAt(i);
      out += HTML_ESCAPE_MAP[ch] || ch;
    }
    return out;
  }

  // ── Decode HTML entities (no regex) ───────────────────────────────────

  var ENTITY_PAIRS = [
    ['&apos;', "'"],
    ['&quot;', '"'],
    ['&#96;',  '`'],
    ['&lt;',   '<'],
    ['&gt;',   '>'],
    ['&amp;',  '&']   // Must be last — decoded '&' shouldn't trigger earlier matches
  ];

  function decodeHtmlEntities(str) {
    if (!str) return '';
    var result = String(str);
    for (var i = 0; i < ENTITY_PAIRS.length; i++) {
      var parts = result.split(ENTITY_PAIRS[i][0]);
      result = parts.join(ENTITY_PAIRS[i][1]);
    }
    return result;
  }

  // ── File size formatter ───────────────────────────────────────────────

  function formatFileSize(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    var k = 1024;
    var sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    var i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  // ── Date formatters ───────────────────────────────────────────────────

  function formatDate(dateString, options) {
    if (!dateString) return '-';
    var defaults = { year: 'numeric', month: 'short', day: 'numeric' };
    var merged = defaults;
    if (options) {
      var keys = Object.keys(options);
      for (var i = 0; i < keys.length; i++) {
        merged[keys[i]] = options[keys[i]];
      }
    }
    return new Date(dateString).toLocaleDateString('en-US', merged);
  }

  function formatDateTime(dateString) {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleString('en-US', {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  }

  // ── Time ago ──────────────────────────────────────────────────────────

  var TIME_INTERVALS = [
    { label: 'year',   seconds: 31536000 },
    { label: 'month',  seconds: 2592000 },
    { label: 'day',    seconds: 86400 },
    { label: 'hour',   seconds: 3600 },
    { label: 'minute', seconds: 60 }
  ];

  function timeAgo(dateString) {
    if (!dateString) return '-';
    var seconds = Math.floor((new Date() - new Date(dateString)) / 1000);
    for (var i = 0; i < TIME_INTERVALS.length; i++) {
      var count = Math.floor(seconds / TIME_INTERVALS[i].seconds);
      if (count >= 1) {
        return count + ' ' + TIME_INTERVALS[i].label + (count !== 1 ? 's' : '') + ' ago';
      }
    }
    return 'Just now';
  }

  // ── Debounce ──────────────────────────────────────────────────────────

  function debounce(fn, wait) {
    var timeout;
    return function () {
      var ctx = this;
      var args = arguments;
      clearTimeout(timeout);
      timeout = setTimeout(function () { fn.apply(ctx, args); }, wait);
    };
  }

  // ── Truncate text ─────────────────────────────────────────────────────

  function truncateText(text, maxLen, suffix) {
    if (!text) return '';
    if (maxLen === undefined) maxLen = 50;
    if (suffix === undefined) suffix = '...';
    if (text.length <= maxLen) return text;
    return text.substring(0, maxLen) + suffix;
  }

  // ── Percentage formatter ──────────────────────────────────────────────

  function formatPercentage(value, decimals) {
    if (value === null || value === undefined) return '-';
    if (decimals === undefined) decimals = 1;
    return value.toFixed(decimals) + '%';
  }

  // ── Status badge ──────────────────────────────────────────────────────

  var STATUS_STYLES = {
    active:    'bg-green-100 text-green-800',
    inactive:  'bg-gray-100 text-gray-800',
    pending:   'bg-yellow-100 text-yellow-800',
    disabled:  'bg-red-100 text-red-800',
    healthy:   'bg-green-100 text-green-800',
    unhealthy: 'bg-red-100 text-red-800',
    degraded:  'bg-yellow-100 text-yellow-800',
    installed: 'bg-blue-100 text-blue-800',
    running:   'bg-green-100 text-green-800',
    stopped:   'bg-gray-100 text-gray-800'
  };

  function statusBadge(status) {
    var escaped = escapeHtml(status);
    var style = STATUS_STYLES[status] || 'bg-gray-100 text-gray-800';
    return '<span class="px-2 py-1 text-xs font-medium rounded-full ' + style + '">' + escaped + '</span>';
  }

  // ── Relative date formatter ──────────────────────────────────────────
  // Returns "Today", "Yesterday", "3 days ago", or "Jan 12, 2025" for older dates.
  // Different from timeAgo (which returns "2 hours ago" style granularity)
  // and formatDate (which always returns a locale date string).

  function formatRelativeDate(dateString) {
    if (!dateString) return '\u2014';
    var date = new Date(dateString);
    var now = new Date();
    var diffMs = now - date;
    var diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return diffDays + ' days ago';
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  // ── File type label ─────────────────────────────────────────────────
  // Maps a File object (MIME type + extension) to a human-readable label.

  var MIME_TYPE_LABELS = {
    'application/pdf': 'PDF',
    'application/msword': 'Word',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Word',
    'application/vnd.ms-excel': 'Excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'Excel',
    'application/vnd.ms-powerpoint': 'PowerPoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'PowerPoint',
    'text/plain': 'Text',
    'text/csv': 'CSV',
    'image/jpeg': 'Image',
    'image/jpg': 'Image',
    'image/png': 'Image',
    'image/gif': 'Image',
    'image/svg+xml': 'Image',
    'application/zip': 'ZIP',
    'application/x-zip-compressed': 'ZIP'
  };

  var EXT_TYPE_LABELS = {
    'pdf': 'PDF', 'doc': 'Word', 'docx': 'Word',
    'xls': 'Excel', 'xlsx': 'Excel',
    'ppt': 'PowerPoint', 'pptx': 'PowerPoint',
    'txt': 'Text', 'csv': 'CSV',
    'jpg': 'Image', 'jpeg': 'Image', 'png': 'Image',
    'gif': 'Image', 'svg': 'Image', 'zip': 'ZIP'
  };

  function getFileType(file) {
    if (file && file.type && MIME_TYPE_LABELS[file.type]) {
      return MIME_TYPE_LABELS[file.type];
    }
    if (file && file.name) {
      var parts = file.name.split('.');
      var ext = parts.length > 1 ? parts[parts.length - 1].toLowerCase() : '';
      if (EXT_TYPE_LABELS[ext]) return EXT_TYPE_LABELS[ext];
    }
    return 'Unknown';
  }

  // ── Soft-close scroll ────────────────────────────────────────────────
  // Mimics a hydraulic-damped drawer:
  //   Fast initial push → catch/brake at ~40% → gentle spring pull to rest

  var scrollRAF = null;

  function softScrollEase(t) {
    if (t < 0.3) {
      // Push: fast initial movement (smoothstep)
      var p = t / 0.3;
      return 0.45 * (p * p * (3 - 2 * p));
    }
    // Catch + pull: hydraulic damper brakes hard, spring settles (ease-out ^7)
    var p2 = (t - 0.3) / 0.7;
    var inv = 1 - p2;
    return 0.45 + 0.55 * (1 - inv * inv * inv * inv * inv * inv * inv);
  }

  function softScrollTo(targetY, opts) {
    if (scrollRAF) cancelAnimationFrame(scrollRAF);

    var el = (opts && opts.element) || null;
    var scroller = el || window;
    var startY = el ? el.scrollTop : window.scrollY;
    var distance = targetY - startY;
    if (distance === 0) return;
    var startTime = performance.now();
    var duration = (opts && opts.duration) || Math.min(1100, 500 + Math.abs(distance) * 0.2);

    function step(now) {
      var elapsed = now - startTime;
      var t = Math.min(elapsed / duration, 1);
      var y = startY + distance * softScrollEase(t);

      if (el) {
        el.scrollTop = y;
      } else {
        window.scrollTo(0, y);
      }

      if (t < 1) {
        scrollRAF = requestAnimationFrame(step);
      } else {
        scrollRAF = null;
      }
    }

    scrollRAF = requestAnimationFrame(step);
  }

  // ── Public API ────────────────────────────────────────────────────────

  global.Lex.Scroll = {
    softTo: softScrollTo
  };

  global.Lex.Utils = {
    escapeHtml:         escapeHtml,
    decodeHtmlEntities: decodeHtmlEntities,
    formatFileSize:     formatFileSize,
    formatDate:         formatDate,
    formatDateTime:     formatDateTime,
    formatRelativeDate: formatRelativeDate,
    timeAgo:            timeAgo,
    debounce:           debounce,
    truncateText:       truncateText,
    formatPercentage:   formatPercentage,
    statusBadge:        statusBadge,
    getFileType:        getFileType
  };

  // ── Backward-compat globals ───────────────────────────────────────────
  // Existing pages call these as bare globals. Bridge them so nothing breaks.

  global.escapeHtml         = escapeHtml;
  global.formatDate         = formatDate;
  global.formatDateTime     = formatDateTime;
  global.formatRelativeDate = formatRelativeDate;
  global.timeAgo            = timeAgo;
  global.debounce           = debounce;
  global.formatFileSize     = formatFileSize;
  global.formatPercentage   = formatPercentage;
  global.truncateText       = truncateText;
  global.statusBadge        = statusBadge;
  global.getFileType        = getFileType;

  // Bridge Utils.* (utils.js defines window.Utils with some of these)
  global.Utils = global.Utils || {};
  global.Utils.escapeHtml    = escapeHtml;
  global.Utils.formatFileSize = formatFileSize;
  global.Utils.truncate       = truncateText;

})(window);
