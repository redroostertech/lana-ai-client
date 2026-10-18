// src/js/shared/current-pipeline-presentation.js
// Thin exact-decimal presentation; authenticated server contracts own authority.
(function (global) {
'use strict';
function escapeHtml(value) {
  return String(value).split('&').join('&amp;').split('<').join('&lt;').split('>').join('&gt;')
    .split('"').join('&quot;').split("'").join('&#39;');
}
const KEY = 'core.funnel-analysis-attribution.current_pipeline_value';
const DEFINITION = 'current-open-active-opportunity-stock-evidence-v1';
const coverageKeys = ['admitted_record_count', 'eligible_opportunity_count', 'covered_opportunity_count',
  'unknown_identity_count', 'duplicate_identity_count', 'unknown_status_count', 'unknown_amount_count', 'unknown_currency_count'];
const amountKeys = ['positive_amount', 'negative_amount'];
const countKeys = ['positive_count', 'negative_count', 'zero_count'];
function isCurrentPipeline(metric) {
  return [metric?.key, metric?.metric_key, metric?.calculation?.ref, metric?.calculation?.spec?.metricKey,
    metric?.calculation?.spec?.ref, metric?.calculation?.spec?.kind, metric?.metadata?.canonical_metric_key].includes(KEY);
}
// Secondary display checks only. The authenticated backend owns source and tenant authority.
function decimalText(value) {
  if (typeof value !== 'string' || !value) return false;
  const unsigned = value.startsWith('-') ? value.slice(1) : value;
  const parts = unsigned.split('.');
  return parts.length <= 2 && parts.every(part => part.length && Array.from(part).every(c => c >= '0' && c <= '9'))
    && (parts[0].length === 1 || parts[0][0] !== '0');
}
function currencyText(value) {
  return typeof value === 'string' && value.length === 3 && Array.from(value).every(c => c >= 'A' && c <= 'Z');
}
function validReceipt(receipt, metadata) {
  if (receipt?.version !== 'current-pipeline-observation-v2' || receipt.metric_key !== 'current_pipeline_value'
    || receipt.definition_version !== DEFINITION || receipt.aggregation !== 'current_snapshot'
    || receipt.organization_id !== metadata.organization_id || typeof receipt.organization_id !== 'string'
    || !receipt.organization_id || !['complete', 'partial', 'empty'].includes(receipt.status)
    || typeof receipt.timezone !== 'string' || !receipt.timezone || receipt.conservation_verified !== true
    || typeof receipt.as_of !== 'string' || !Number.isFinite(Date.parse(receipt.as_of))
    || new Date(receipt.as_of).toISOString() !== receipt.as_of || !Array.isArray(receipt.currency_totals)) return false;
  const c = receipt.coverage;
  if (!c || !coverageKeys.every(key => Number.isSafeInteger(c[key]) && c[key] >= 0)
    || c.covered_opportunity_count > c.eligible_opportunity_count
    || c.eligible_opportunity_count + c.unknown_status_count > c.admitted_record_count) return false;
  const currencies = new Set();
  let covered = 0;
  for (const row of receipt.currency_totals) {
    if (!row || typeof row !== 'object' || Array.isArray(row) || !currencyText(row.currency) || currencies.has(row.currency)
      || ![...amountKeys, 'signed_amount'].every(key => decimalText(row[key]))
      || !countKeys.every(key => Number.isSafeInteger(row[key]) && row[key] >= 0)) return false;
    currencies.add(row.currency);
    covered += row.positive_count + row.negative_count + row.zero_count;
  }
  if (covered !== c.covered_opportunity_count) return false;
  const uncertain = c.unknown_status_count + c.unknown_identity_count + c.duplicate_identity_count
    + c.unknown_amount_count + c.unknown_currency_count;
  return receipt.status === (uncertain ? 'partial' : c.eligible_opportunity_count ? 'complete' : 'empty');
}
function matchesRows(rows, receipt) {
  return Array.isArray(rows) && rows.length === receipt.currency_totals.length && rows.every((row, index) => {
    const evidence = receipt.currency_totals[index];
    return row && row.key === evidence.currency && row.label === evidence.currency && row.currency === evidence.currency
      && row.value === evidence.signed_amount && [...amountKeys, ...countKeys].every(key => row[key] === evidence[key]);
  });
}
function currentPipelinePresentation(metric) {
  if (!isCurrentPipeline(metric)) return null;
  const unavailable = { status: 'unverified', receipt: null };
  const metadata = metric.metadata, receipt = metadata?.observation_receipt;
  if (metric.error || metric.override || metric.manual_override || metadata?.override || metadata?.manual_override
    || metadata?.canonical_metric_key !== KEY || metadata.provenance !== 'calculated'
    || metadata.definition_version !== DEFINITION || !validReceipt(receipt, metadata)
    || metric.format !== 'distribution' || metric.unit !== 'currency' || metric.aggregation !== 'current_snapshot'
    || metric.status !== receipt.status) return unavailable;
  const fields = ['current', 'value'].filter(key => Object.prototype.hasOwnProperty.call(metric, key));
  if (!fields.length || fields.some(key => !matchesRows(metric[key], receipt))) return unavailable;
  return { status: receipt.status, receipt, rows: metric[fields[0]] };
}
function renderCurrentPipeline(presentation) {
  if (!presentation?.receipt) return '<p class="muted">Current pipeline evidence unavailable. No certified amount displayed.</p>';
  const { receipt, rows, status } = presentation;
  const label = status === 'partial' ? 'Partial coverage. These are known covered amounts, not a complete pipeline total.'
    : status === 'empty' ? 'No open or active opportunities in the admitted records.' : 'Complete coverage of admitted records.';
  const table = rows.length ? '<div class="overflow-x-auto"><table class="w-full text-sm text-left"><thead><tr>'
    + '<th>Currency</th><th>Signed amount</th><th>Positive amount</th><th>Negative amount</th>'
    + '<th>Positive opportunities</th><th>Negative opportunities</th><th>Zero opportunities</th></tr></thead><tbody>'
    + rows.map(row => '<tr>' + [row.currency, row.value, row.positive_amount, row.negative_amount,
      row.positive_count, row.negative_count, row.zero_count].map(value => '<td>' + escapeHtml(String(value)) + '</td>').join('') + '</tr>').join('')
    + '</tbody></table></div>' : '<p>No covered currency amounts.</p>';
  return '<section class="current-pipeline"><p>Current stock. Observed as of ' + escapeHtml(receipt.as_of)
    + ' (' + escapeHtml(receipt.timezone) + '). This is not a reporting-period total or a source-sync freshness guarantee.</p><p>'
    + label + '</p>' + table + '<p>Covered opportunities: ' + receipt.coverage.covered_opportunity_count
    + '. Eligible opportunities: ' + receipt.coverage.eligible_opportunity_count + '. Unknown status: '
    + receipt.coverage.unknown_status_count + '. Currencies are separate; no combined total or conversion.</p></section>';
}

function renderCard(metric) {
  const presentation = currentPipelinePresentation(metric);
  if (!presentation) return null;
  return '<lex-card heading="' + escapeHtml(metric.name || metric.title || 'Current pipeline') + '">'
    + renderCurrentPipeline(presentation) + (metric.hasDrilldown && metric.drilldown?.enabled
      ? '<button type="button" data-pipeline-details="' + escapeHtml(metric.key || metric.metric_key) + '">Details</button>' : '') + '</lex-card>';
}
function bindDetails(container, open) {
  container.querySelectorAll('[data-pipeline-details]').forEach(button => {
    button.addEventListener('click', () => open(button.dataset.pipelineDetails));
  });
}
function visualization(viz, data, renderSibling, open) {
  const metrics = (viz.metrics || []).map(ref => typeof ref === 'string'
    ? (data.metrics || []).find(metric => metric.key === ref) : ref).filter(Boolean);
  if (!metrics.some(isCurrentPipeline)) return null;
  const container = document.createElement('div');
  container.innerHTML = metrics.filter(isCurrentPipeline).map(renderCard).join('');
  bindDetails(container, open);
  const siblings = (viz.metrics || []).filter(ref => {
    const metric = typeof ref === 'string' ? (data.metrics || []).find(row => row.key === ref) : ref;
    return !isCurrentPipeline(metric);
  });
  if (siblings.length) {
    const rendered = renderSibling({ ...viz, metrics: siblings });
    if (rendered) container.appendChild(rendered);
  }
  return container;
}
function detailOptions(metric, legacyOptions) { return isCurrentPipeline(metric) ? {} : legacyOptions; }
const api = { KEY, isCurrentPipeline, currentPipelinePresentation, renderCurrentPipeline, renderCard, bindDetails, visualization, detailOptions };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (global) global.CurrentPipelinePresentation = api;
})(typeof window !== 'undefined' ? window : globalThis);
