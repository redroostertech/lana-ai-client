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

  function readStoredUser() {
    try {
      return JSON.parse(global.localStorage && global.localStorage.getItem('user') || 'null') || {};
    } catch (_error) {
      return {};
    }
  }

  function validTimezone(value) {
    if (!value || typeof value !== 'string') return '';
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date());
      return value;
    } catch (_error) {
      return '';
    }
  }

  function getOrganizationTimezone(options) {
    var user = readStoredUser();
    var preferences = user.preferences || {};
    options = options || {};
    return validTimezone(
      options.timeZone
      || options.timezone
      || user.organization_timezone
      || user.organizationTimezone
      || user.timezone
      || (preferences.general && preferences.general.timezone)
      || preferences.timezone
    ) || 'UTC';
  }

  function dateParts(dateString, options) {
    var date = new Date(dateString);
    if (!Number.isFinite(date.getTime())) return null;
    var formatterOptions = {
      timeZone: getOrganizationTimezone(options),
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    };
    if (!options || options.includeTime !== false) {
      formatterOptions.hour = '2-digit';
      formatterOptions.minute = '2-digit';
      formatterOptions.hour12 = false;
    }
    return Object.fromEntries(new Intl.DateTimeFormat('en-US', formatterOptions).formatToParts(date).map(function (part) {
      return [part.type, part.value];
    }));
  }

  function formatDate(dateString, options) {
    if (!dateString) return 'Never';
    var parts = dateParts(dateString, Object.assign({}, options || {}, { includeTime: false }));
    if (!parts) return 'Never';
    return parts.month + '/' + parts.day + '/' + parts.year;
  }

  function formatDateTime(dateString, options) {
    if (!dateString) return 'Never';
    var parts = dateParts(dateString, Object.assign({}, options || {}, { includeTime: true }));
    if (!parts) return 'Never';
    var hour24 = parts.hour === '24' ? 0 : Number(parts.hour);
    var hour12 = hour24 % 12 || 12;
    var meridiem = hour24 >= 12 ? 'PM' : 'AM';
    return parts.month + '/' + parts.day + '/' + parts.year + ' ' + String(hour12).padStart(2, '0') + ':' + parts.minute + ' ' + meridiem;
  }

  // Long format: "May 3, 2026" (or "Sun, May 3" / "Sunday, May 3, 2026" via opts).
  // Always honors org timezone via getOrganizationTimezone().
  function formatDateLong(dateString, options) {
    if (!dateString) return 'Never';
    var date = new Date(dateString);
    if (!Number.isFinite(date.getTime())) return 'Never';
    options = options || {};
    var fmt = {
      timeZone: getOrganizationTimezone(options),
      year:  options.year  || 'numeric',
      month: options.month || 'long',
      day:   options.day   || 'numeric'
    };
    if (options.weekday) fmt.weekday = options.weekday === true ? 'long' : options.weekday;
    return new Intl.DateTimeFormat('en-US', fmt).format(date);
  }

  // Weekday-prefixed long format: "Sunday, May 3, 2026". Convenience wrapper.
  function formatDateWeekday(dateString, options) {
    return formatDateLong(dateString, Object.assign({ weekday: 'long' }, options || {}));
  }

  // Time-only: "10:29 PM" (12-hour, org timezone). Pass { hour12: false } for 24-hour.
  function formatTime(dateString, options) {
    if (!dateString) return '';
    var date = new Date(dateString);
    if (!Number.isFinite(date.getTime())) return '';
    options = options || {};
    return new Intl.DateTimeFormat('en-US', {
      timeZone: getOrganizationTimezone(options),
      hour:   options.hour   || 'numeric',
      minute: options.minute || '2-digit',
      hour12: options.hour12 !== false
    }).format(date);
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

  var STATUS_TOKEN_STYLES = {
    active:    { bg: 'var(--lex-status-success-bg, #ECFDF3)',   text: 'var(--lex-status-success-text, #067647)' },
    inactive:  { bg: 'var(--lex-status-neutral-bg, #F5F3F0)',   text: 'var(--lex-status-neutral-text, #423F3A)' },
    pending:   { bg: 'var(--lex-status-warning-bg, #FFFAEB)',   text: 'var(--lex-status-warning-text, #B54708)' },
    disabled:  { bg: 'var(--lex-status-danger-bg, #FEF3F2)',    text: 'var(--lex-status-danger-text, #B42318)' },
    healthy:   { bg: 'var(--lex-status-success-bg, #ECFDF3)',   text: 'var(--lex-status-success-text, #067647)' },
    unhealthy: { bg: 'var(--lex-status-danger-bg, #FEF3F2)',    text: 'var(--lex-status-danger-text, #B42318)' },
    degraded:  { bg: 'var(--lex-status-warning-bg, #FFFAEB)',   text: 'var(--lex-status-warning-text, #B54708)' },
    installed: { bg: 'var(--lex-status-info-bg, #EFF4FF)',      text: 'var(--lex-status-info-text, #175CD3)' },
    running:   { bg: 'var(--lex-status-success-bg, #ECFDF3)',   text: 'var(--lex-status-success-text, #067647)' },
    stopped:   { bg: 'var(--lex-status-neutral-bg, #F5F3F0)',   text: 'var(--lex-status-neutral-text, #423F3A)' }
  };

  var STATUS_DEFAULT_TOKEN = { bg: 'var(--lex-status-neutral-bg, #F5F3F0)', text: 'var(--lex-status-neutral-text, #423F3A)' };

  function statusBadge(status) {
    var escaped = escapeHtml(status);
    var tokens = STATUS_TOKEN_STYLES[status] || STATUS_DEFAULT_TOKEN;
    var inlineStyle = 'background:' + tokens.bg + ';color:' + tokens.text + ';';
    return '<span style="display:inline-flex;align-items:center;padding:2px 8px;font-size:var(--lex-body-xs-size,0.75rem);font-weight:500;border-radius:var(--lex-radius-full,9999px);' + inlineStyle + '">' + escaped + '</span>';
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
    return formatDate(dateString);
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
    getOrganizationTimezone: getOrganizationTimezone,
    formatDate:         formatDate,
    formatDateTime:     formatDateTime,
    formatDateLong:     formatDateLong,
    formatDateWeekday:  formatDateWeekday,
    formatTime:         formatTime,
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
  global.formatDateLong     = formatDateLong;
  global.formatDateWeekday  = formatDateWeekday;
  global.formatTime         = formatTime;
  global.formatRelativeDate = formatRelativeDate;
  global.timeAgo            = timeAgo;
  global.debounce           = debounce;
  global.formatFileSize     = formatFileSize;
  global.getOrganizationTimezone = getOrganizationTimezone;
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
