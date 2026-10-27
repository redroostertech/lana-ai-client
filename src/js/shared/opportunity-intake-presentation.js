(function (global) {
'use strict';
const escapeHtml = value => String(value == null ? '' : value).split('&').join('&amp;').split('<').join('&lt;')
  .split('>').join('&gt;').split('"').join('&quot;').split("'").join('&#39;');
// Display admission only. The authenticated backend owns the count/rate contract.
const INTAKE = 'core.funnel-analysis-attribution.conversion_by_source';
const coverageFields = ['eligible_record_count', 'counted_record_count', 'excluded_record_count', 'unresolved_identity_count',
  'duplicate_identity_count', 'unknown_clock_count', 'unknown_source_count', 'conflicting_source_count',
  'won_count', 'lost_count', 'closed_count', 'nonclosed_count', 'unknown_status_count'];
const coverageLabels = ['Eligible records', 'Counted records', 'Excluded records', 'Unresolved identities',
  'Duplicate identities', 'Unknown dates', 'Unknown sources', 'Conflicting sources', 'Won', 'Lost', 'Closed', 'Nonclosed', 'Unknown status'];
const count = value => Number.isSafeInteger(value) && value >= 0;
const instant = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const rate = value => value === null || (Number.isFinite(value) && value >= 0 && value <= 100);
function isOpportunityIntake(metric) {
  return [metric?.key, metric?.metric_key, metric?.calculation?.ref, metric?.metadata?.canonical_metric_key].includes(INTAKE);
}
function validReceipt(receipt) {
  return receipt?.version === 'opportunity-intake-observation-v1' && receipt.aggregation === 'whole_window'
    && receipt.frequency === null && receipt.currency === null && ['complete', 'partial', 'missing'].includes(receipt.status)
    && typeof receipt.organization_id === 'string' && typeof receipt.timezone === 'string'
    && [receipt.as_of, receipt.window?.start, receipt.window?.end_exclusive, receipt.interval?.start, receipt.interval?.end_exclusive].every(instant)
    && receipt.window.start < receipt.window.end_exclusive && receipt.interval.start === receipt.window.start
    && receipt.interval.end_exclusive <= receipt.window.end_exclusive && receipt.interval.end_exclusive <= receipt.as_of
    && receipt.coverage && coverageFields.every(key => count(receipt.coverage[key]))
    && Array.isArray(receipt.observations) && new Set(receipt.observations.map(row => row?.source_key)).size === receipt.observations.length
    && receipt.observations.every(row => row && typeof row.source_key === 'string' && typeof row.label === 'string'
      && ['known', 'unknown', 'conflicting'].includes(row.source_kind)
      && ['record_count', 'won_count', 'lost_count', 'closed_count', 'nonclosed_count', 'unknown_status_count'].every(key => count(row[key]))
      && rate(row.rate) && (row.closed_count !== 0 || row.rate === null)
      && row.period_start === receipt.interval.start && row.period_end_exclusive === receipt.interval.end_exclusive);
}
function opportunityIntakePresentation(metric) {
  if (!isOpportunityIntake(metric)) { return null; }
  const receipt = metric.metadata?.observation_receipt;
  const unavailable = { receipt: null, status: 'unverified' };
  if (metric.error || metric.override || metric.manual_override || metric.metadata?.override || metric.metadata?.manual_override
    || metric.metadata?.canonical_metric_key !== INTAKE || metric.metadata?.definition_version !== 'opportunity-intake-closed-win-rate-v1'
    || metric.metadata?.provenance !== 'calculated' || metric.metadata?.organization_id !== receipt?.organization_id
    || metric.currency !== null || metric.unit !== 'percent' || metric.format !== 'distribution'
    || metric.aggregation !== 'report_window' || !validReceipt(receipt) || metric.status !== receipt.status) { return unavailable; }
  const fields = ['value', 'current'].filter(field => Object.prototype.hasOwnProperty.call(metric, field));
  if (!fields.length || fields.some(field => {
    const rows = metric[field];
    return !Array.isArray(rows) || rows.length !== receipt.observations.length || rows.some((row, index) => {
      const source = receipt.observations[index];
      return !row || row.key !== source.source_key || row.label !== source.label || row.source_kind !== source.source_kind
        || row.count !== source.record_count || row.value !== source.rate
        || ['won_count', 'lost_count', 'closed_count', 'nonclosed_count', 'unknown_status_count'].some(key => row[key] !== source[key]);
    });
  })) { return unavailable; }
  return { receipt, status: receipt.status };
}
const showRate = value => value === null ? 'Unavailable' : escapeHtml(String(value)) + '%';
function renderReceipt(receipt) {
  const table = receipt.observations.map(row => '<tr>' + [row.label, row.source_key, row.won_count, row.lost_count,
    row.closed_count, row.nonclosed_count, row.unknown_status_count].map(value => '<td>' + escapeHtml(String(value)) + '</td>').join('')
    + '<td>' + showRate(row.rate) + '</td></tr>').join('');
  return '<p>Current recorded won / (won + lost), by opportunity intake source; not contact acquisition, booking or historical transitions.</p>'
    + '<p>Reporting period: ' + escapeHtml(receipt.window.start) + ' to ' + escapeHtml(receipt.window.end_exclusive)
    + ' (exclusive). Observed through ' + escapeHtml(receipt.interval.end_exclusive) + '; as of ' + escapeHtml(receipt.as_of)
    + ' (' + escapeHtml(receipt.timezone) + '). Coverage: ' + escapeHtml(receipt.status) + '.</p>'
    + '<p>No closed denominator means unavailable, not zero. Nonclosed and unknown outcomes remain visible.</p>'
    + '<table><thead><tr><th>Intake source</th><th>Qualified identity</th><th>Won</th><th>Lost</th><th>Closed (won + lost)</th>'
    + '<th>Nonclosed</th><th>Unknown status</th><th>Closed win rate</th></tr></thead><tbody>' + table + '</tbody></table>'
    + '<p>' + coverageFields.map((key, index) => coverageLabels[index] + ': ' + receipt.coverage[key]).join('. ') + '.</p>';
}
function renderOpportunityIntake(presentation, metric = {}) {
  if (!presentation?.receipt) { return '<p class="muted">Opportunity intake evidence unavailable. No verified rate displayed.</p>'; }
  let html = '<section class="opportunity-intake">' + renderReceipt(presentation.receipt);
  if (metric.comparison) {
    const comparison = metric.comparison, prior = opportunityIntakePresentation(comparison.prior);
    if (prior?.receipt && JSON.stringify(comparison.current?.metadata?.observation_receipt) === JSON.stringify(presentation.receipt)
      && ['organization_id', 'as_of', 'timezone', 'declaration_digest'].every(key => prior.receipt[key] === presentation.receipt[key])
      && Array.isArray(comparison.rows) && comparison.rows.every(row => row && typeof row.label === 'string' && typeof row.key === 'string'
        && rate(row.current_rate) && rate(row.prior_rate) && (row.change_points === null || Number.isFinite(row.change_points)))) {
      html += '<h4>Prior report (' + escapeHtml(comparison.mode) + ')</h4>' + renderReceipt(prior.receipt)
        + '<table><thead><tr><th>Intake source</th><th>Qualified identity</th><th>Current rate</th><th>Prior rate</th><th>Change (percentage points)</th></tr></thead><tbody>'
        + comparison.rows.map(row => '<tr><td>' + escapeHtml(row.label) + '</td><td>' + escapeHtml(row.key)
          + '</td><td>' + showRate(row.current_rate) + '</td><td>' + showRate(row.prior_rate) + '</td><td>'
          + (row.change_points === null ? 'Unavailable' : escapeHtml(String(row.change_points))) + '</td></tr>').join('') + '</tbody></table>';
    } else { html += '<p>Comparison evidence unavailable.</p>'; }
  }
  if (Array.isArray(metric.timeSeries) && metric.timeSeries.length) {
    const recent = metric.timeSeries.slice(-12);
    html += '<h4>Calendar-period rates</h4><p>Showing latest ' + recent.length + ' of ' + metric.timeSeries.length
      + ' buckets. Each rate uses its own closed denominator; buckets are not averaged into the report.</p>';
    for (const bucket of recent) {
      const view = opportunityIntakePresentation(bucket);
      html += view?.receipt && ['organization_id', 'as_of', 'timezone', 'declaration_digest'].every(key => view.receipt[key] === presentation.receipt[key])
        ? renderReceipt(view.receipt) : '<p>Calendar-period evidence unavailable.</p>';
    }
  }
  return html + '</section>';
}

function renderCard(metric) {
  const view = opportunityIntakePresentation(metric);
  if (!view) { return null; }
  return '<lex-card heading="' + escapeHtml(metric.name || metric.title || 'Opportunity intake') + '">' + renderOpportunityIntake(view, metric)
    + (view.receipt && metric.hasDrilldown && metric.drilldown?.enabled
      ? '<button type="button" data-intake-details="' + escapeHtml(metric.key || metric.metric_key) + '">Details</button>' : '') + '</lex-card>';
}
function bindDetails(container, open) {
  container.querySelectorAll('[data-intake-details]').forEach(button => button.addEventListener('click', () => open(button.dataset.intakeDetails)));
}
function visualization(viz, data, renderSibling, open) {
  const resolve = ref => typeof ref === 'string' ? (data.metrics || []).find(metric => metric.key === ref) : ref;
  const metrics = (viz.metrics || []).map(resolve).filter(Boolean);
  if (!metrics.some(isOpportunityIntake)) { return null; }
  const container = document.createElement('div');
  container.innerHTML = metrics.filter(isOpportunityIntake).map(renderCard).join('');
  bindDetails(container, open);
  const chartData = metrics.filter(isOpportunityIntake).flatMap(metric => (opportunityIntakePresentation(metric).receipt?.observations || [])
    .filter(row => row.rate !== null).map(row => ({ source_name: row.label + ' (' + row.source_key + ')', closed_win_rate: row.rate })));
  if (['bar_chart', 'grouped_bar_chart'].includes(viz.type) && chartData.length) {
    const chart = renderSibling({ ...viz, type: 'grouped_bar_chart', metrics: [], data: chartData,
      series: [{ type: 'bar', field: 'closed_win_rate', label: 'Closed win rate (%)', color: '#3b82f6' }] });
    if (chart) { container.appendChild(chart); }
  }
  const siblings = (viz.metrics || []).filter(ref => !isOpportunityIntake(resolve(ref)));
  if (siblings.length) { const rendered = renderSibling({ ...viz, metrics: siblings }); if (rendered) { container.appendChild(rendered); } }
  return container;
}
function renderDrilldownSummary(data, context = {}) {
  if (data?.metadata?.canonical_metric_key !== INTAKE) { return null; }
  const summary = data.summary, receipt = summary?.observation_receipt;
  const sameInstant = (a, b) => Number.isFinite(Date.parse(a)) && Date.parse(a) === Date.parse(b);
  if (!validReceipt(receipt) || summary.coverage_status !== receipt.status || data.status !== receipt.status
    || summary.period_start !== receipt.window.start || summary.period_end_exclusive !== receipt.window.end_exclusive
    || summary.observed_end_exclusive !== receipt.interval.end_exclusive || summary.as_of !== receipt.as_of || summary.timezone !== receipt.timezone
    || JSON.stringify(summary.coverage) !== JSON.stringify(receipt.coverage)
    || (context.organizationId && context.organizationId !== receipt.organization_id)
    || (context.periodStart && !sameInstant(context.periodStart, receipt.window.start))
    || (context.periodEnd && !sameInstant(context.periodEnd, receipt.window.end_exclusive))) { return renderOpportunityIntake(null); }
  const selected = summary.applied_filters?.source_key;
  if (selected != null && !receipt.observations.some(row => row.source_key === selected)) { return renderOpportunityIntake(null); }
  return '<lex-card heading="Whole-report intake evidence"><p>Full reporting window before contribution filters or paging. Selected source: '
    + escapeHtml(selected || 'All') + '.</p>' + renderReceipt(receipt) + '</lex-card>';
}
const api = { INTAKE, isOpportunityIntake, opportunityIntakePresentation, renderOpportunityIntake, renderCard, bindDetails, visualization, renderDrilldownSummary };
if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
if (global) { global.OpportunityIntakePresentation = api; }
})(typeof window !== 'undefined' ? window : globalThis);
