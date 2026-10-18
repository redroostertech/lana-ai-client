// Secondary display checks only; the authenticated backend owns query authority.
(function (global) {
'use strict';
const PEOPLE = 'core.growth-intake-performance.lead_source_distribution';
const MONEY = 'core.funnel-analysis-attribution.top_performing_sources';
const DEFINITION = 'proven-person-acquisition-whole-window-v1';
const counts = ['eligible_record_count', 'person_membership_count', 'unresolved_record_count', 'unknown_clock_count',
  'unknown_channel_person_count', 'conflicting_person_count', 'won_count', 'covered_won_count',
  'unknown_amount_count', 'unknown_currency_count', 'unattributed_won_count', 'duplicate_identity_count'];
const escapeHtml = value => String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const count = value => Number.isSafeInteger(value) && value >= 0;
const instant = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const decimal = value => typeof value === 'string' && /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(value);
function isAcquisitionSource(metric) {
  return [metric?.key, metric?.metric_key, metric?.calculation?.ref, metric?.calculation?.spec?.metricKey,
    metric?.calculation?.spec?.ref, metric?.calculation?.spec?.kind, metric?.metadata?.canonical_metric_key]
    .some(key => key === PEOPLE || key === MONEY);
}
function expectedRows(receipt, money) {
  const rows = [], keys = new Set();
  let people = 0, won = 0, covered = 0;
  for (const row of receipt.observations) {
    if (!row || typeof row.channel_key !== 'string' || !row.channel_key || keys.has(row.channel_key)
      || typeof row.label !== 'string' || !['known', 'unknown', 'conflicting'].includes(row.channel_kind)
      || !count(row.person_count) || !count(row.won_count) || !Array.isArray(row.currency_totals)
      || row.period_start !== receipt.interval.start || row.period_end_exclusive !== receipt.interval.end_exclusive) return null;
    keys.add(row.channel_key); people += row.person_count; won += row.won_count;
    if (row.channel_kind === 'known') {
      let key;
      try { key = JSON.parse(row.channel_key); } catch (_) { return null; }
      if (!Array.isArray(key) || key[0] !== 'acquisition' || key[1] !== receipt.organization_id || key[key.length - 1] !== row.label
        || !((key.length === 4 && key[2] === 'native') || (key.length === 6 && key[2] === 'source'))) return null;
    } else if (row.channel_key !== row.channel_kind + '_acquisition'
      || row.label !== (row.channel_kind === 'unknown' ? 'Unknown' : 'Conflicting source')) return null;
    const currencies = new Set();
    let coveredInRow = 0;
    for (const total of row.currency_totals) {
      if (!total || typeof total.currency !== 'string' || !/^[A-Z]{3}$/.test(total.currency)
        || currencies.has(total.currency) || !count(total.count) || !total.count || !decimal(total.amount)) return null;
      currencies.add(total.currency); covered += total.count; coveredInRow += total.count;
      if (money) rows.push({ key: row.channel_key, label: row.label, channel_kind: row.channel_kind,
        currency: total.currency, count: total.count, value: total.amount });
    }
    if (coveredInRow > row.won_count) return null;
    if (!money && row.person_count) rows.push({ key: row.channel_key, label: row.label, channel_kind: row.channel_kind,
      currency: null, count: row.person_count, value: row.person_count });
  }
  const c = receipt.coverage;
  return people === c.person_membership_count && won === c.won_count && covered === c.covered_won_count ? rows : null;
}
function matches(rows, expected, status) {
  if (status === 'missing') return rows === null && expected.length === 0;
  if (!Array.isArray(rows) || rows.length !== expected.length) return false;
  const issued = new Map(expected.map(row => [JSON.stringify([row.key, row.currency]), row]));
  for (const row of rows) {
    if (!row) return false;
    const id = JSON.stringify([row.key, row.currency]), original = issued.get(id);
    if (!original || Object.keys(original).some(key => row[key] !== original[key])) return false;
    issued.delete(id);
  }
  return issued.size === 0;
}
function acquisitionSourcePresentation(metric) {
  if (!isAcquisitionSource(metric)) return null;
  const unavailable = { status: 'unverified', receipt: null };
  const metadata = metric.metadata, receipt = metadata?.observation_receipt, key = metadata?.canonical_metric_key;
  if (![PEOPLE, MONEY].includes(key) || metadata?.definition_version !== DEFINITION || metadata.provenance !== 'calculated'
    || [metric.key, metric.metric_key, metric.calculation?.ref].some(identity => [PEOPLE, MONEY].includes(identity) && identity !== key)
    || metric.error || metric.override || metric.manual_override || metadata.override || metadata.manual_override
    || receipt?.version !== 'acquisition-source-observation-v1' || receipt.organization_id !== metadata.organization_id
    || typeof receipt.organization_id !== 'string' || !receipt.organization_id || !instant(receipt.as_of)
    || !instant(receipt.window?.start) || !instant(receipt.window?.end_exclusive)
    || !instant(receipt.interval?.start) || !instant(receipt.interval?.end_exclusive)
    || receipt.window.start >= receipt.window.end_exclusive || receipt.interval.start !== receipt.window.start
    || receipt.interval.start >= receipt.interval.end_exclusive
    || receipt.interval.end_exclusive !== (receipt.as_of < receipt.window.end_exclusive ? receipt.as_of : receipt.window.end_exclusive)
    || typeof receipt.timezone !== 'string' || !receipt.timezone || receipt.aggregation !== 'whole_window' || receipt.frequency !== null
    || !['complete', 'partial', 'missing'].includes(receipt.status) || metric.status !== receipt.status
    || metric.unit !== (key === MONEY ? 'currency' : 'people') || metric.format !== 'distribution' || metric.currency !== null
    || metric.aggregation !== 'report_window' || !receipt.coverage || !counts.every(field => count(receipt.coverage[field]))
    || !Array.isArray(receipt.observations)) return unavailable;
  const c = receipt.coverage;
  const partial = ['unresolved_record_count', 'unknown_clock_count', 'unknown_channel_person_count', 'conflicting_person_count',
    'unknown_amount_count', 'unknown_currency_count', 'unattributed_won_count', 'duplicate_identity_count'].some(field => c[field] > 0);
  if (receipt.status !== (!c.eligible_record_count ? 'missing' : partial ? 'partial' : 'complete')
    || counts.some(field => c[field] > c.eligible_record_count) || c.covered_won_count > c.won_count) return unavailable;
  const expected = expectedRows(receipt, key === MONEY);
  const fields = ['current', 'value'].filter(field => Object.prototype.hasOwnProperty.call(metric, field));
  if (!expected || !fields.length || fields.some(field => !matches(metric[field], expected, receipt.status))) return unavailable;
  return { status: receipt.status, receipt, rows: metric[fields[0]], money: key === MONEY };
}
function origin(key) {
  try {
    const value = JSON.parse(key);
    if (value[0] === 'acquisition' && value[2] === 'native') return 'Native';
    if (value[0] === 'acquisition' && value[2] === 'source') return String(value[4]) + ' / ' + String(value[3]);
  } catch (_) { /* Unknown and conflicting buckets have no source namespace. */ }
  return 'Not attributed';
}
function renderAcquisitionSource(presentation) {
  if (!presentation?.receipt) return '<p class="muted">Acquisition-source evidence unavailable. No verified value displayed.</p>';
  const { receipt, rows, status, money } = presentation;
  const coverage = status === 'partial' ? 'Partial coverage: unknown and conflicting attribution are shown separately.'
    : status === 'missing' ? 'No usable evidence for this period; missing is not zero.' : 'Complete coverage of admitted records.';
  const table = rows?.length ? '<div class="overflow-x-auto"><table class="w-full text-sm text-left"><thead><tr><th>Acquisition channel</th>'
    + '<th>Source system / integration</th><th>' + (money ? 'Currency</th><th>Won opportunity value</th><th>Covered won opportunities' : 'People')
    + '</th></tr></thead><tbody>' + rows.map(row => '<tr>' + [row.label, origin(row.key),
      ...(money ? [row.currency, row.value, row.count] : [row.value])].map(value => '<td>' + escapeHtml(value) + '</td>').join('') + '</tr>').join('')
    + '</tbody></table></div>' : '<p>No covered ' + (money ? 'won amounts' : 'people') + ' to display.</p>';
  return '<section class="acquisition-source"><p>Current acquisition attribution applied to creation cohorts; not historical attribution or marketing ROI.</p>'
    + '<p>Reporting period: ' + escapeHtml(receipt.window.start) + ' to ' + escapeHtml(receipt.window.end_exclusive)
    + ' (exclusive). Observed as of ' + escapeHtml(receipt.as_of) + ' (' + escapeHtml(receipt.timezone) + ').</p><p>'
    + coverage + '</p>' + table + '<p>Proven people: ' + receipt.coverage.person_membership_count + '. Unresolved records: '
    + receipt.coverage.unresolved_record_count + '. Unknown-channel people: ' + receipt.coverage.unknown_channel_person_count
    + '. Conflicting-source people: ' + receipt.coverage.conflicting_person_count + '. Unknown record dates: '
    + receipt.coverage.unknown_clock_count + '. Ambiguous identities: ' + receipt.coverage.duplicate_identity_count + '.</p>'
    + (money ? '<p>Won opportunities with unknown amount: ' + receipt.coverage.unknown_amount_count
      + '. Unknown currency: ' + receipt.coverage.unknown_currency_count + '. Covered won opportunities: '
      + receipt.coverage.covered_won_count + '.</p>' : '')
    + (money ? '<p>Signed won amounts, including negatives. Currencies remain separate; no combined total or conversion.</p>' : '') + '</section>';
}
function renderCard(metric) {
  const presentation = acquisitionSourcePresentation(metric);
  if (!presentation) return null;
  return '<lex-card heading="' + escapeHtml(metric.name || metric.title || 'Acquisition sources') + '">'
    + renderAcquisitionSource(presentation) + (presentation.receipt && metric.hasDrilldown && metric.drilldown?.enabled
      ? '<button type="button" data-acquisition-details="' + escapeHtml(metric.key || metric.metric_key) + '">Details</button>' : '') + '</lex-card>';
}
function bindDetails(container, open) {
  container.querySelectorAll('[data-acquisition-details]').forEach(button => button.addEventListener('click', () => open(button.dataset.acquisitionDetails)));
}
function renderDrilldownSummary(data, context = {}) {
  const key = data?.metadata?.canonical_metric_key;
  if (![PEOPLE, MONEY].includes(key)) return null;
  const summary = data.summary, receipt = summary?.observation_receipt;
  const unavailable = () => renderAcquisitionSource(null);
  const sameInstant = (left, right) => Number.isFinite(Date.parse(left)) && Date.parse(left) === Date.parse(right);
  const currencyCode = value => typeof value === 'string' && value.length === 3
    && [...value].every(letter => letter.charCodeAt(0) >= 65 && letter.charCodeAt(0) <= 90);
  // Display guards only. Never derive a headline from the filtered page or
  // turn a detail response into a fabricated calculation receipt.
  if (receipt?.version !== 'acquisition-source-observation-v1' || receipt.aggregation !== 'whole_window'
    || (context.organizationId && context.organizationId !== receipt.organization_id)
    || (context.periodStart && !sameInstant(context.periodStart, receipt.window?.start))
    || (context.periodEnd && !sameInstant(context.periodEnd, receipt.window?.end_exclusive))
    || !['complete', 'partial', 'missing'].includes(summary.coverage_status)
    || summary.coverage_status !== receipt.status || data.status !== receipt.status
    || summary.period_start !== receipt.window?.start || summary.period_end_exclusive !== receipt.window?.end_exclusive
    || summary.observed_end_exclusive !== receipt.interval?.end_exclusive || summary.as_of !== receipt.as_of
    || summary.timezone !== receipt.timezone || !instant(summary.as_of)
    || !summary.coverage || !counts.every(field => count(summary.coverage[field]))
    || JSON.stringify(summary.coverage) !== JSON.stringify(receipt.coverage)
    || !Array.isArray(summary.currency_totals) || JSON.stringify(summary.currency_totals) !== JSON.stringify(receipt.currency_totals)
    || summary.currency_totals.some(total => !total || !currencyCode(total.currency) || !decimal(total.amount) || !count(total.count))
    || !Array.isArray(receipt.observations) || receipt.observations.some(row => !row || typeof row !== 'object')) return unavailable();
  const filters = summary.applied_filters || {}, channel = filters.channel_key == null ? null
    : receipt.observations.find(row => row.channel_key === filters.channel_key);
  if ((filters.channel_key != null && !channel) || (filters.currency != null && !currencyCode(filters.currency))) return unavailable();
  const labels = ['Eligible records', 'Proven people', 'Unresolved records', 'Unknown record dates', 'Unknown-channel people',
    'Conflicting-source people', 'Won opportunities', 'Covered won opportunities', 'Unknown amount', 'Unknown currency',
    'Unattributed won opportunities', 'Ambiguous identities'];
  const totals = key === MONEY ? summary.currency_totals.map(total => '<p>' + escapeHtml(total.currency) + ': '
    + escapeHtml(total.amount) + ' (' + total.count + ' covered won opportunities)</p>').join('') : '';
  return '<lex-card heading="Whole-report totals"><p>Coverage: ' + escapeHtml(summary.coverage_status)
    + '. These totals cover the whole reporting window, not the selected page or filters.</p>'
    + (summary.coverage_status === 'missing' ? '<p>Missing evidence is not zero.</p>' : '') + totals
    + '<p>' + counts.map((field, index) => labels[index] + ': ' + summary.coverage[field]).join('. ') + '.</p>'
    + '<p>Reporting period: ' + escapeHtml(summary.period_start) + ' to ' + escapeHtml(summary.period_end_exclusive)
    + ' (exclusive). Observed through ' + escapeHtml(summary.observed_end_exclusive) + '; as of ' + escapeHtml(summary.as_of)
    + ' (' + escapeHtml(summary.timezone) + ').</p><p>Selected channel: ' + escapeHtml(channel ? channel.label : 'All')
    + (channel ? ' (' + escapeHtml(origin(channel.channel_key)) + ')' : '') + '. Selected currency: ' + escapeHtml(filters.currency || 'All') + '.</p>'
    + (key === MONEY ? '<p>Signed won amounts, including negatives. Currencies remain separate; no combined total or conversion.</p>' : '') + '</lex-card>';
}
function visualization(viz, data, renderSibling, open) {
  const resolve = ref => typeof ref === 'string' ? (data.metrics || []).find(metric => metric.key === ref) : ref;
  const metrics = (viz.metrics || []).map(resolve).filter(Boolean);
  if (!metrics.some(isAcquisitionSource)) return null;
  const container = document.createElement('div'); container.innerHTML = metrics.filter(isAcquisitionSource).map(renderCard).join('');
  bindDetails(container, open);
  const siblings = (viz.metrics || []).filter(ref => !isAcquisitionSource(resolve(ref)));
  if (siblings.length) { const rendered = renderSibling({ ...viz, metrics: siblings }); if (rendered) container.appendChild(rendered); }
  return container;
}
const api = { PEOPLE, MONEY, isAcquisitionSource, acquisitionSourcePresentation, renderAcquisitionSource, renderDrilldownSummary, renderCard, bindDetails, visualization };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (global) global.AcquisitionSourcePresentation = api;
})(typeof window !== 'undefined' ? window : globalThis);
