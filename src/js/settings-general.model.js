/**
 * Settings > General: the text for About, Software update, Date & time and Language &
 * region, from the facts the main process reports (electron-system-info.js). Pure: the page
 * controller is src/js/pages/settings-general.js.
 */
(function (global) {
  'use strict';

  /** Decimal units, as computers label their disks and memory ("994.66 GB" shows as "994.7 GB"). */
  function bytes(value) {
    if (value === null || value === undefined) return 'Not available';
    var n = Number(value);
    if (!Number.isFinite(n) || n < 0) return 'Not available';
    var units = ['bytes', 'KB', 'MB', 'GB', 'TB'];
    var unit = 0;
    while (n >= 1000 && unit < units.length - 1) {
      n /= 1000;
      unit += 1;
    }
    var text = unit === 0 || n >= 100 ? String(Math.round(n)) : n.toFixed(1).replace(/\.0$/, '');
    return text + ' ' + units[unit];
  }

  /** Memory reads in whole powers of two ("68719476736" is "64 GB"). */
  function memory(value) {
    var n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return 'Not available';
    return Math.round(n / Math.pow(1024, 3)) + ' GB';
  }

  function platformName(platform) {
    if (platform === 'darwin') return 'macOS';
    if (platform === 'win32') return 'Windows';
    if (platform === 'linux') return 'Linux';
    return platform || 'Unknown';
  }

  function archName(arch, platform) {
    if (arch === 'arm64') return platform === 'darwin' ? 'Apple silicon (arm64)' : 'ARM 64-bit (arm64)';
    if (arch === 'x64') return platform === 'darwin' ? 'Intel (x64)' : '64-bit (x64)';
    if (arch === 'ia32') return '32-bit (ia32)';
    return arch || 'Unknown';
  }

  /** "26.3.0" reads "26.3"; Windows builds stay as reported. */
  function osVersion(version, platform) {
    var text = String(version || '');
    return platform === 'darwin' ? text.replace(/\.0$/, '') : text;
  }

  var LOW_SPACE_BYTES = 10 * 1000 * 1000 * 1000;

  /**
   * About: name, version, the computer and its storage.
   * @param {object} info  settings:system-info's `info`
   * @param {string} name  the product name ("LANA AI" or "LANA One")
   */
  function aboutView(info, name) {
    var app = (info && info.app) || {};
    var device = (info && info.device) || {};
    var disk = (info && info.storage) || {};
    var processor = device.cpuModel
      ? device.cpuModel + (device.cpuCores ? ', ' + device.cpuCores + ' cores' : '')
      : 'Not available';
    var rows = [
      { label: 'Name', value: name || 'LANA AI' },
      { label: 'Version', value: app.displayVersion || 'Not available' },
      { label: 'Computer name', value: device.computerName || 'Not available' },
      { label: 'Operating system', value: (platformName(device.platform) + ' ' + osVersion(device.osVersion, device.platform)).trim() },
      { label: 'Processor', value: processor },
      { label: 'Architecture', value: archName(device.arch, device.platform) },
      { label: 'Memory', value: memory(device.memoryBytes) },
      { label: 'Capacity', value: bytes(disk.totalBytes) },
      { label: 'Available', value: disk.freeBytes == null ? 'Not available' : bytes(disk.freeBytes) + ' available' },
    ];
    var runtime = [];
    if (app.electron) runtime.push('Electron ' + app.electron);
    if (app.chrome) runtime.push('Chromium ' + app.chrome);
    if (app.node) runtime.push('Node.js ' + app.node);
    if (runtime.length) rows.push({ label: 'Runtime', value: runtime.join(', ') });
    var lowSpace = disk.freeBytes != null && disk.freeBytes < LOW_SPACE_BYTES;
    return {
      rows: rows,
      warning: lowSpace ? 'Less than 10 GB is free on this computer. Model downloads and recordings may not fit.' : '',
    };
  }

  function dateTime(iso, timeZone) {
    var date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    var options = { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' };
    if (timeZone) options.timeZone = timeZone;
    return new Intl.DateTimeFormat('en-US', options).format(date);
  }

  /** Software update: the badge, the line under it, and the one button. */
  function updateView(status, timeZone) {
    var s = status || {};
    var result = s.result;
    var checked = s.lastChecked ? 'Last checked ' + dateTime(s.lastChecked, timeZone) + '.' : 'Not checked since LANA started.';
    var view = {
      version: s.currentVersion || 'Not available',
      checked: checked,
      badge: 'Not checked',
      color: 'gray',
      summary: 'LANA checks for updates each time it starts.',
      action: 'check',
      actionLabel: 'Check for updates',
      releaseNotes: '',
      note: s.packaged === false ? 'This copy runs from source code, so updates apply to installed copies only.' : '',
    };
    if (!result) return view;
    if (result.error) {
      view.badge = 'Could not check';
      view.color = 'red';
      view.summary = result.error;
      return view;
    }
    if (result.updateAvailable) {
      view.badge = result.updateRequired ? 'Update required' : 'Update available';
      view.color = result.updateRequired ? 'yellow' : 'blue';
      view.summary = result.version
        ? 'Version ' + result.version + ' is ready to install.' + (result.updateRequired ? ' Your organization requires it.' : '')
        : 'A new version is ready to install.';
      view.action = 'install';
      view.actionLabel = result.version ? 'Update to ' + result.version : 'Update';
      view.releaseNotes = result.releaseNotes || '';
      return view;
    }
    view.badge = 'Up to date';
    view.color = 'green';
    view.summary = 'You have the latest version of LANA for this computer.';
    return view;
  }

  /** "Sunday, November 8, 2026 at 1:42 PM EST" in the person's time zone. */
  function nowText(now, timeZone) {
    var options = { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' };
    if (timeZone) options.timeZone = timeZone;
    try {
      return new Intl.DateTimeFormat('en-US', options).format(now);
    } catch (_) {
      delete options.timeZone;
      return new Intl.DateTimeFormat('en-US', options).format(now);
    }
  }

  function languageName(tag) {
    if (!tag) return '';
    try {
      return new Intl.DisplayNames(['en'], { type: 'language' }).of(tag) || tag;
    } catch (_) {
      return tag;
    }
  }

  function regionName(tag) {
    if (!tag) return '';
    try {
      var region = new Intl.Locale(tag).maximize().region;
      return region ? new Intl.DisplayNames(['en'], { type: 'region' }).of(region) || region : '';
    } catch (_) {
      return '';
    }
  }

  /** Language & region: what LANA shows in, and what this computer is set to. */
  function languageView(locale) {
    var l = locale || {};
    var system = l.systemLocale || l.appLocale || '';
    var preferred = (l.preferredLanguages || []).map(languageName).filter(Boolean);
    return {
      rows: [
        { label: 'LANA language', value: 'English' },
        { label: 'This computer\'s languages', value: preferred.length ? preferred.join(', ') : (languageName(system) || 'Not available') },
        { label: 'Region', value: regionName(system) || 'Not available' },
      ],
      note: 'LANA is available in English. It shows dates and times in the time zone set above.',
    };
  }

  var api = { bytes: bytes, memory: memory, platformName: platformName, archName: archName, aboutView: aboutView, updateView: updateView, nowText: nowText, languageView: languageView };
  global.LanaSettingsGeneral = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
