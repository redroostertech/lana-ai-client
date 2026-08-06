/* Lex.Utils — canonical utility functions (Category A: stateless singleton).
   Loaded once in the SPA shell. All pages use Lex.Utils.* for these helpers.
   Backward-compat globals at the bottom keep existing code working. */

(function (global) {
  'use strict';

  global.Lex = global.Lex || {};

  var LanaTime = global.LanaTime;
  var SYSTEM_TIME_ZONE = LanaTime.SYSTEM_TIME_ZONE;
  var MS_PER_SECOND = LanaTime.MS_PER_SECOND;
  var MS_PER_MINUTE = LanaTime.MS_PER_MINUTE;
  var MS_PER_HOUR = LanaTime.MS_PER_HOUR;
  var MS_PER_DAY = LanaTime.MS_PER_DAY;

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

  var nowDate = LanaTime.nowDate;
  var nowMs = LanaTime.nowMs;
  var nowIso = LanaTime.nowIso;
  var addMilliseconds = LanaTime.addMilliseconds;
  var subtractMilliseconds = LanaTime.subtractMilliseconds;
  var addMinutes = LanaTime.addMinutes;
  var addHours = LanaTime.addHours;
  var addDays = LanaTime.addDays;
  var startOfUtcDay = LanaTime.startOfUtcDay;
  var startOfUtcMonth = LanaTime.startOfUtcMonth;
  var addUtcMonths = LanaTime.addUtcMonths;
  var startOfLocalDay = LanaTime.startOfLocalDay;
  var startOfLocalMonth = LanaTime.startOfLocalMonth;
  var endOfLocalMonth = LanaTime.endOfLocalMonth;
  var startOfLocalYear = LanaTime.startOfLocalYear;
  var endOfLocalYear = LanaTime.endOfLocalYear;
  var formatUtcDateOnly = LanaTime.formatUtcDateOnly;
  var millisecondsSince = LanaTime.millisecondsSince;
  var millisecondsUntil = LanaTime.millisecondsUntil;
  var daysBetween = LanaTime.daysBetween;

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
      new Intl.DateTimeFormat('en-US', { timeZone: value }).format(nowDate());
      return value;
    } catch (_error) {
      return '';
    }
  }

  function browserTimezone() {
    try {
      return new Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch (_error) {
      return 'UTC';
    }
  }

  function getOrganizationTimezone(options) {
    var user = readStoredUser();
    var preferences = user.preferences || {};
    options = options || {};
    return validTimezone(
      options.timeZone
      || options.timezone
      || user.timezone
      || user.user_timezone
      || user.userTimezone
      || (preferences.regional && preferences.regional.timezone)
      || user.organization_timezone
      || user.organizationTimezone
      || (preferences.general && preferences.general.timezone)
      || preferences.timezone
    ) || browserTimezone() || SYSTEM_TIME_ZONE;
  }

  function timestampHasExplicitTimezone(value) {
    if (!value || typeof value !== 'string') return false;
    var timeIndex = value.indexOf('T');
    if (timeIndex === -1) return true;
    var timePart = value.substring(timeIndex + 1);
    if (!timePart) return true;
    var last = timePart.charAt(timePart.length - 1);
    if (last === 'Z' || last === 'z') return true;
    return timePart.indexOf('+') !== -1 || timePart.indexOf('-') !== -1;
  }

  function normalizeApiUtcTimestamp(value) {
    if (!value || typeof value !== 'string') return value;
    if (value.indexOf('T') === -1 || timestampHasExplicitTimezone(value)) return value;
    return value + 'Z';
  }

  function parseApiUtcDate(value) {
    if (value instanceof Date) return new Date(value.getTime());
    var date = new Date(normalizeApiUtcTimestamp(value));
    return Number.isFinite(date.getTime()) ? date : null;
  }

  function dateParts(dateString, options) {
    var date = parseApiUtcDate(dateString);
    if (!date) return null;
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
    return Number(parts.month) + '/' + Number(parts.day) + '/' + parts.year;
  }

  function formatDateTime(dateString, options) {
    if (!dateString) return 'Never';
    var parts = dateParts(dateString, Object.assign({}, options || {}, { includeTime: true }));
    if (!parts) return 'Never';
    var hour24 = parts.hour === '24' ? 0 : Number(parts.hour);
    var hour12 = hour24 % 12 || 12;
    var meridiem = hour24 >= 12 ? 'PM' : 'AM';
    return Number(parts.month) + '/' + Number(parts.day) + '/' + parts.year + ' ' + hour12 + ':' + parts.minute + ' ' + meridiem;
  }

  // Long format: "May 3, 2026" (or "Sun, May 3" / "Sunday, May 3, 2026" via opts).
  // Always honors org timezone via getOrganizationTimezone().
  function formatDateLong(dateString, options) {
    if (!dateString) return 'Never';
    var date = parseApiUtcDate(dateString);
    if (!date) return 'Never';
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
    var date = parseApiUtcDate(dateString);
    if (!date) return '';
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
    var date = parseApiUtcDate(dateString);
    if (!date) return '-';
    // Delegate to the canonical LanaTime formatter so this global (exported
    // as window.timeAgo, preferred by several page formatters) can't drift
    // from the rest of the app.
    if (global.LanaTime && typeof global.LanaTime.timeAgo === 'function') {
      return global.LanaTime.timeAgo(date, { style: 'words' }) || '-';
    }
    var seconds = Math.floor(millisecondsSince(date.getTime()) / MS_PER_SECOND);
    for (var i = 0; i < TIME_INTERVALS.length; i++) {
      var count = Math.floor(seconds / TIME_INTERVALS[i].seconds);
      if (count >= 1) {
        return count + ' ' + TIME_INTERVALS[i].label + (count !== 1 ? 's' : '') + ' ago';
      }
    }
    return 'Just now';
  }

  // ── Safe markdown rendering ───────────────────────────────────────────
  // For LLM-generated or otherwise untrusted markdown: raw HTML renders as
  // escaped text, links are restricted to http(s)/mailto (new tab with
  // noopener), and images render as their alt text. Returns null when the
  // vendored marked library is not loaded or parsing throws, so callers can
  // fall back to plain escaping.

  var _safeMarkedInstance = null;

  function getSafeMarkedInstance() {
    if (_safeMarkedInstance) return _safeMarkedInstance;
    var markedLib = global.marked;
    if (!markedLib || typeof markedLib.Marked !== 'function') return null;
    _safeMarkedInstance = new markedLib.Marked({
      renderer: {
        html: function (token) {
          return escapeHtml(token && token.text ? token.text : '');
        },
        link: function (token) {
          var href = String((token && token.href) || '');
          var label = this.parser.parseInline((token && token.tokens) || []);
          if (/^(https?:|mailto:)/i.test(href)) {
            var title = token && token.title ? ' title="' + escapeHtml(token.title) + '"' : '';
            return '<a href="' + escapeHtml(href) + '"' + title + ' target="_blank" rel="noopener noreferrer">' + label + '</a>';
          }
          return label;
        },
        image: function (token) {
          return escapeHtml((token && (token.text || token.title)) || '');
        }
      }
    });
    return _safeMarkedInstance;
  }

  function renderMarkdownSafe(text, options) {
    if (text === null || text === undefined || text === '') return '';
    var parser = getSafeMarkedInstance();
    if (!parser) return null;
    try {
      return options && options.inline
        ? parser.parseInline(String(text))
        : parser.parse(String(text));
    } catch (error) {
      return null;
    }
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
    var date = parseApiUtcDate(dateString);
    if (!date) return '\u2014';
    var diffMs = millisecondsSince(date.getTime());
    var diffDays = Math.floor(diffMs / MS_PER_DAY);
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return diffDays + ' days ago';
    return formatDate(dateString);
  }

  // ── lex-btn label update ──────────────────────────────────────────────
  // Correctly updates the visible label of a <lex-btn> element.
  //
  // Why this helper exists:
  //   lex-btn renders its label inside a <slot-content> child node (see
  //   lex-btn.js and lex.core.js _captureContent/_restoreContent). Setting
  //   `.textContent` directly on the <lex-btn> wipes the styled inner DOM
  //   (the .lex-btn-inner button, ripple container, etc.), leaving raw text.
  //   It also fails to update on next property change because LexElement's
  //   re-render path restores from `_originalChildren`, not from the DOM.
  //
  // This helper:
  //   1. Updates the live <slot-content> textContent so the label changes
  //      immediately without disturbing the rendered button shell.
  //   2. Re-seeds `_originalChildren` so any future re-render (triggered by
  //      e.g. `loading`, `disabled`, `variant` changes) restores the NEW
  //      label, not the stale captured one.
  //
  // Falls back to plain textContent only if the slot is missing — covers
  // raw <button> and other non-lex elements.
  function setLexButtonText(button, label) {
    if (!button) return;
    button._originalChildren = [document.createTextNode(label)];
    var slot = button.querySelector('slot-content');
    if (slot) {
      slot.textContent = label;
    } else {
      button.textContent = label;
    }
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
    SYSTEM_TIME_ZONE:    SYSTEM_TIME_ZONE,
    MS_PER_SECOND:       MS_PER_SECOND,
    MS_PER_MINUTE:       MS_PER_MINUTE,
    MS_PER_HOUR:         MS_PER_HOUR,
    MS_PER_DAY:          MS_PER_DAY,
    nowDate:             nowDate,
    nowMs:               nowMs,
    nowIso:              nowIso,
    addMilliseconds:     addMilliseconds,
    subtractMilliseconds: subtractMilliseconds,
    addMinutes:          addMinutes,
    addHours:            addHours,
    addDays:             addDays,
    addUtcMonths:        addUtcMonths,
    startOfUtcDay:       startOfUtcDay,
    startOfUtcMonth:     startOfUtcMonth,
    startOfLocalDay:     startOfLocalDay,
    startOfLocalMonth:   startOfLocalMonth,
    endOfLocalMonth:     endOfLocalMonth,
    startOfLocalYear:    startOfLocalYear,
    endOfLocalYear:      endOfLocalYear,
    formatUtcDateOnly:   formatUtcDateOnly,
    millisecondsSince:   millisecondsSince,
    millisecondsUntil:   millisecondsUntil,
    daysBetween:         daysBetween,
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
    normalizeApiUtcTimestamp: normalizeApiUtcTimestamp,
    parseApiUtcDate:    parseApiUtcDate,
    timeAgo:            timeAgo,
    renderMarkdownSafe: renderMarkdownSafe,
    debounce:           debounce,
    truncateText:       truncateText,
    formatPercentage:   formatPercentage,
    statusBadge:        statusBadge,
    getFileType:        getFileType,
    setLexButtonText:   setLexButtonText
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
  global.normalizeApiUtcTimestamp = normalizeApiUtcTimestamp;
  global.parseApiUtcDate    = parseApiUtcDate;
  global.timeAgo            = timeAgo;
  global.debounce           = debounce;
  global.formatFileSize     = formatFileSize;
  global.getOrganizationTimezone = getOrganizationTimezone;
  global.LexNowIso       = nowIso;
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
