/**
 * Firm Handbook structured item forms (DOM wiring only).
 *
 * Draws the Lex form for a structured type into a container and reads it
 * back as the plain form object firm-handbook-structured.models.js turns
 * into the API's `data`. Reading an item shows the server's own words (its
 * content), so there is one renderer. All mapping and checks live in the
 * models; styles in css/firm-handbook.css (fh-wh-*, fh-rule-*).
 *
 *   var Forms = window.LanaFirmHandbookStructuredForms;
 *   Forms.render(container, 'work_hours', data, type);
 *   var form = Forms.read(container);
 */
(function (global) {
  'use strict';

  function models() { return global.LanaFirmHandbookStructuredModels; }

  // Lex's escaper when it has loaded; otherwise the same five entities here,
  // so a value is never written into the markup raw.
  var ENTITIES = [['&', '&amp;'], ['<', '&lt;'], ['>', '&gt;'], ['"', '&quot;'], ["'", '&#39;']];
  function esc(value) {
    var text = value === undefined || value === null ? '' : String(value);
    if (global.Lex && global.Lex.Utils && typeof global.Lex.Utils.escapeHtml === 'function') return global.Lex.Utils.escapeHtml(text);
    return ENTITIES.reduce(function (out, pair) { return out.split(pair[0]).join(pair[1]); }, text);
  }

  function attrJson(value) {
    return esc(JSON.stringify(value));
  }

  // ── Work hours: a seven-day grid ──────────────────────────────────

  function renderWorkHours(container, data) {
    var rows = models().toWorkHoursRows(data);
    container.innerHTML = '<div class="fh-wh-head" aria-hidden="true"><span>Day</span><span>Open</span><span>Start</span><span>End</span></div>' +
      rows.map(function (row) {
        return '<div class="fh-wh-row' + (row.open ? '' : ' fh-wh-row--closed') + '" data-day="' + esc(row.day) + '">' +
          '<span class="fh-wh-day">' + esc(row.label) + '</span>' +
          '<lex-toggle size="sm" data-wh-open aria-label="' + esc(row.label) + ' is a working day"' + (row.open ? ' checked' : '') + '></lex-toggle>' +
          '<lex-input type="time" size="sm" data-wh-start aria-label="' + esc(row.label) + ' start" value="' + esc(row.start) + '"></lex-input>' +
          '<lex-input type="time" size="sm" data-wh-end aria-label="' + esc(row.label) + ' end" value="' + esc(row.end) + '"></lex-input>' +
        '</div>';
      }).join('');
  }

  function readWorkHours(container) {
    var rows = container.querySelectorAll('.fh-wh-row');
    var out = [];
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var open = row.querySelector('[data-wh-open]');
      var start = row.querySelector('[data-wh-start]');
      var end = row.querySelector('[data-wh-end]');
      out.push({
        day: row.getAttribute('data-day'),
        open: !!(open && open.checked),
        start: start ? start.value : '',
        end: end ? end.value : ''
      });
    }
    return out;
  }

  // ── Follow-up rule ────────────────────────────────────────────────

  function renderRule(container, data, type) {
    var M = models();
    var form = M.toRuleForm(data);
    var fields = M.matchFieldOptions(type).map(function (f) { return { value: f.value, label: f.label }; });
    var sources = M.sourceOptions(type, form.source);
    var connector = form.matchField === 'appointment_type';
    container.innerHTML =
      '<div class="fh-rule-grid">' +
        '<lex-select data-rule="matchField" label="This rule is for" options="' + attrJson(fields) + '" value="' + esc(form.matchField) + '"></lex-select>' +
        '<div class="fh-rule-source' + (connector ? '' : ' hidden') + '">' +
          '<lex-select data-rule="source" label="Connected app" placeholder="Choose the app" options="' + attrJson(sources) + '" value="' + esc(form.source) + '"></lex-select>' +
        '</div>' +
        '<lex-input data-rule="matchValue" label="Type or calendar value" placeholder="consultation" maxlength="500" value="' + esc(form.matchValue) + '"' +
          ' help="Exactly as it appears on the event or appointment."></lex-input>' +
        '<lex-input data-rule="label" label="Meeting name" placeholder="Consultation" maxlength="200" value="' + esc(form.label) + '"></lex-input>' +
        '<lex-input data-rule="taskTitle" label="Follow-up task" placeholder="Send the engagement letter" maxlength="200" value="' + esc(form.taskTitle) + '"' +
          ' help="Created on the meeting\'s matter for the matter\'s responsible person."></lex-input>' +
      '</div>' +
      '<div class="fh-rule-payment">' +
        '<lex-toggle data-rule="paymentReview" label="Also add a payment review task"' + (form.paymentReview ? ' checked' : '') + '></lex-toggle>' +
        '<div class="fh-rule-payment-fields' + (form.paymentReview ? '' : ' hidden') + '">' +
          '<lex-input data-rule="paymentType" label="Payment type" placeholder="retainer" maxlength="64" value="' + esc(form.paymentType) + '"></lex-input>' +
          '<lex-input data-rule="amount" type="number" label="Amount" placeholder="1500" value="' + esc(form.amount) + '"></lex-input>' +
          '<lex-input data-rule="dueInDays" type="number" label="Due, days after the meeting" placeholder="0" value="' + esc(form.dueInDays) + '"></lex-input>' +
        '</div>' +
      '</div>';
  }

  function readRule(container) {
    function value(name) {
      var node = container.querySelector('[data-rule="' + name + '"]');
      return node ? node.value : '';
    }
    var toggle = container.querySelector('[data-rule="paymentReview"]');
    return {
      matchField: value('matchField'),
      source: value('source'),
      matchValue: value('matchValue'),
      label: value('label'),
      taskTitle: value('taskTitle'),
      paymentReview: !!(toggle && toggle.checked),
      paymentType: value('paymentType'),
      amount: value('amount'),
      dueInDays: value('dueInDays')
    };
  }

  // One listener per container: show or hide the parts a choice controls.
  function bindOnce(container) {
    if (container.getAttribute('data-fh-bound') === 'true') return;
    container.setAttribute('data-fh-bound', 'true');
    container.addEventListener('lex-change', function (event) {
      var target = event.target;
      if (!target || !target.getAttribute) return;
      var value = event.detail ? event.detail.value : undefined;
      if (target.hasAttribute('data-wh-open')) {
        var row = target.closest('.fh-wh-row');
        if (row) row.classList.toggle('fh-wh-row--closed', !value);
        return;
      }
      var field = target.getAttribute('data-rule');
      if (field === 'matchField') {
        var source = container.querySelector('.fh-rule-source');
        if (source) source.classList.toggle('hidden', value !== 'appointment_type');
      }
      if (field === 'paymentReview') {
        var payment = container.querySelector('.fh-rule-payment-fields');
        if (payment) payment.classList.toggle('hidden', !value);
      }
    });
  }

  // ── Public ────────────────────────────────────────────────────────

  /** Draw the form for `kind` with `data` (null: the type's starting data). */
  function render(container, kind, data, type) {
    if (!container) return;
    var start = data || (type && type.default_data) || null;
    container.setAttribute('data-kind', kind);
    bindOnce(container);
    if (kind === models().KIND_WORK_HOURS) renderWorkHours(container, start);
    else if (kind === models().KIND_FOLLOWUP_RULE) renderRule(container, start, type);
    else container.innerHTML = '';
  }

  /** The API `data` from the form: { valid, message, data }. */
  function read(container) {
    var M = models();
    var kind = container ? container.getAttribute('data-kind') : '';
    if (kind === M.KIND_WORK_HOURS) return M.buildWorkHoursData(readWorkHours(container));
    if (kind === M.KIND_FOLLOWUP_RULE) return M.buildRuleData(readRule(container));
    return { valid: false, message: 'Choose a type.' };
  }

  /** The rule form's meeting name (to suggest a title). */
  function ruleLabel(container) {
    var node = container ? container.querySelector('[data-rule="label"]') : null;
    return node ? node.value : '';
  }

  var api = { render: render, read: read, ruleLabel: ruleLabel };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.LanaFirmHandbookStructuredForms = api;
})(typeof window !== 'undefined' ? window : globalThis);
