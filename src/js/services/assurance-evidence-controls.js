/* Captures source references; the backend verifies retained bytes, scope, coverage and review. */
(function (global) {
  'use strict';
  function instant(value) {
    var text = String(value || '');
    var calendar = text.slice(0, 10).split('-');
    var validDigits = calendar.length === 3 && calendar.every(function (part) { return part && Array.from(part).every(function (character) { return character >= '0' && character <= '9'; }); });
    var year = Number(calendar[0]); var month = Number(calendar[1]); var day = Number(calendar[2]);
    var lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    var date = new Date(text);
    if (!validDigits || text[10] !== 'T' || month < 1 || month > 12 || day < 1 || day > lastDay || !Number.isFinite(date.getTime())) throw new Error('Choose a valid date and time.');
    return date.toISOString();
  }
  function localInput(value) {
    if (!value) return '';
    var date = new Date(value);
    if (!Number.isFinite(date.getTime())) return '';
    var part = function (value) { return String(value).padStart(2, '0'); };
    return date.getFullYear() + '-' + part(date.getMonth() + 1) + '-' + part(date.getDate()) + 'T' + part(date.getHours()) + ':' + part(date.getMinutes());
  }
  function evidenceFromFields(rows, releases) {
    return rows.map(function (row) {
      var release = releases.find(function (item) { return item.id === row.releaseId; });
      if (!release || !release.reference || release.retained !== true) throw new Error('Choose an available retained document version.');
      var result = { artifact: Object.assign({}, release.reference), evidence_class: row.evidenceClass,
        observed_at: instant(row.observedAt), coverage: row.coverage };
      var locator = {};
      if (row.page !== '' && row.page !== null && row.page !== undefined) {
        var page = Number(row.page);
        if (!Number.isSafeInteger(page) || page < 1) throw new Error('A source page must be a positive whole number.');
        locator.page = page;
      }
      if (String(row.quote || '').trim()) locator.quote = String(row.quote).trim();
      if (Object.keys(locator).length) result.locator = locator;
      return result;
    });
  }
  function createEvidenceEditor(host, options) {
    var releases = options.releases || [];
    var fields = [];
    host.replaceChildren();
    var rows = document.createElement('div'); rows.className = 'assurance-repeatable'; host.appendChild(rows);
    function input(tag, label, value) { var element = document.createElement(tag); element.label = label; if (value !== undefined) element.value = value; return element; }
    function addRow(initial) {
      var row = document.createElement('div'); row.className = 'assurance-evidence-row';
      var release = input('lex-select', 'Retained document version'); release.searchable = true;
      release.options = releases.map(function (item) { return { value: item.id, label: item.label + ' · version ' + item.reference.version }; });
      var evidenceClass = input('lex-select', 'What this source establishes');
      evidenceClass.options = (options.evidenceClasses || []).map(function (value) { return { value: value, label: value.split('_').join(' ') }; });
      var coverage = input('lex-select', 'Coverage of this observation'); coverage.options = [{ value: 'complete', label: 'Complete' }, { value: 'partial', label: 'Partial' }, { value: 'unknown', label: 'Not established' }];
      var observedAt = input('lex-input', 'Observed at (your local time)'); observedAt.type = 'datetime-local';
      var page = input('lex-input', 'Page (optional)'); page.type = 'number';
      var quote = input('lex-textarea', 'Exact source passage (optional)'); quote.rows = 3;
      var open = input('lex-btn', 'Open selected source'); open.variant = 'secondary';
      var remove = input('lex-btn', 'Remove source'); remove.variant = 'ghost';
      var record = { row: row, release: release, evidenceClass: evidenceClass, coverage: coverage, observedAt: observedAt, page: page, quote: quote };
      if (initial) {
        release.value = initial.artifact.id; evidenceClass.value = initial.evidence_class; coverage.value = initial.coverage;
        observedAt.value = localInput(initial.observed_at); page.value = initial.locator && initial.locator.page || ''; quote.value = initial.locator && initial.locator.quote || '';
      }
      open.addEventListener('click', function () {
        var item = releases.find(function (entry) { return entry.id === release.value; });
        if (item && options.openSource) options.openSource(item, { page: page.value, quote: quote.value });
      });
      remove.addEventListener('click', function () { fields = fields.filter(function (entry) { return entry !== record; }); row.remove(); });
      var actions = document.createElement('div'); actions.className = 'assurance-actions'; actions.append(open, remove);
      row.append(release, evidenceClass, coverage, observedAt, page, quote, actions); rows.appendChild(row); fields.push(record);
    }
    if (options.value && options.value.length) options.value.forEach(addRow); else addRow();
    var add = input('lex-btn', 'Add another source'); add.variant = 'secondary'; add.addEventListener('click', function () { addRow(); }); host.appendChild(add);
    return { value: function () { return evidenceFromFields(fields.map(function (entry) { return { releaseId: entry.release.value, evidenceClass: entry.evidenceClass.value, coverage: entry.coverage.value, observedAt: entry.observedAt.value, page: entry.page.value, quote: entry.quote.value }; }), releases); } };
  }
  var exported = { instant: instant, localInput: localInput, evidenceFromFields: evidenceFromFields, createEvidenceEditor: createEvidenceEditor };
  if (typeof module !== 'undefined' && module.exports) module.exports = exported;
  else global.AssuranceEvidenceControls = exported;
})(typeof window !== 'undefined' ? window : globalThis);
