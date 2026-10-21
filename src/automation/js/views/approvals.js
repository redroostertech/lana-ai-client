import {
  badge,
  createServerTableStore,
  dateTimeCell,
  drawerSection,
  drawerStatGrid,
  invalidateServerTable,
  lexEmpty,
  matterLinkCell,
  mountServerTable,
  mutedCell,
  nameCell,
  sectionIntro,
  serverTableSection,
  textCell
} from '../shared/ui.js';
import { escapeAttribute, escapeHtml, formatDate, formatLabel, normalizeText } from '../shared/utils.js';

const TABLE_ID = 'automationApprovalsTable';
const TOOLBAR_PREFIX = 'automationApprovals';
const Queries = () => window.AutomationTableQueries;

const PRIORITY_COLORS = { urgent: 'error', high: 'warning', normal: 'info', low: '' };

function approvalId(approval) {
  return approval.approval_id || approval.id || approval.title || approval.approval_type || '';
}

function statusClass(status) {
  const normalized = normalizeText(status || 'pending');
  if (normalized === 'approved') return 'success';
  if (normalized === 'rejected' || normalized === 'expired' || normalized === 'cancelled') return 'error';
  if (normalized === 'pending') return 'warning';
  return '';
}

function renderPayload(payload) {
  if (!payload || (typeof payload === 'object' && !Array.isArray(payload) && !Object.keys(payload).length)) {
    return '<p class="muted">No additional payload was provided.</p>';
  }

  if (typeof payload === 'object' && !Array.isArray(payload)) {
    const entries = Object.entries(payload);
    const flat = entries.every(([, value]) => value === null || typeof value !== 'object');
    if (flat) {
      return `
        ${drawerStatGrid(entries.map(([key, value]) => ({
          label: formatLabel(key) || key,
          value: value === null || value === undefined ? '--' : String(value)
        })))}
      `;
    }
  }

  let value = '';
  try {
    value = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
  } catch (_error) {
    value = String(payload);
  }
  return `<pre class="automation-detail-code">${escapeHtml(value)}</pre>`;
}

function renderApprovalDetailsPanel(context) {
  const approval = context.state.selectedApprovalDetail;
  if (!context.state.selectedApprovalId || !approval) return '';

  const id = approvalId(approval);
  const sourceType = approval.source_type || approval.sourceType || 'automation_execution';
  const approvalType = approval.approval_type || approval.approvalType || approval.type || 'automation_action';
  const status = approval.status || 'pending';
  const isPending = normalizeText(status) === 'pending';

  return `
    <lex-drawer
      heading="${escapeAttribute(approval.title || approvalType || 'Approval')}"
      subtitle="${escapeAttribute(id)}"
      side="right"
      width="xl"
      open
      data-approval-detail-drawer
    >
      <div class="automation-detail-drawer approval-detail-content">

      <div class="badge-row">
        ${badge(formatLabel(status || 'pending'), statusClass(status))}
        ${badge(formatLabel(sourceType || 'automation'))}
        ${badge(formatLabel(approvalType || 'review'))}
      </div>

      ${approval.description ? `<p>${escapeHtml(approval.description)}</p>` : ''}

      ${drawerSection({
        title: 'Decision',
        body: isPending
          ? `
            <label class="automation-detail-field">
              <span class="sr-only">Decision note</span>
              <textarea
                data-approval-comment
                rows="3"
                placeholder="Optional decision note"
              ></textarea>
            </label>
            <div class="row-actions">
              <lex-btn variant="primary" size="sm" data-approval-action="approve" data-approval-id="${escapeAttribute(id)}" ${context.state.approvalActioning ? 'disabled' : ''}>Approve</lex-btn>
              <lex-btn variant="ghost" size="sm" data-approval-action="reject" data-approval-id="${escapeAttribute(id)}" ${context.state.approvalActioning ? 'disabled' : ''}>Reject</lex-btn>
            </div>
          `
          : lexEmpty({
            message: 'Decision already recorded',
            description: 'This approval is no longer pending.',
            icon: 'inbox'
          })
      })}

      ${drawerSection({
        title: 'Request',
        body: drawerStatGrid([
          { label: 'Requester', value: approval.requester_name || approval.requesterName || 'Unknown' },
          { label: 'Assigned To', value: approval.assigned_to_name || approval.assignedToName || 'Unassigned' },
          { label: 'Priority', value: formatLabel(approval.priority || 'normal') },
          { label: 'Created', value: formatDate(approval.created_at || approval.createdAt) },
          { label: 'Expires', value: formatDate(approval.expires_at || approval.expiresAt) },
          { label: 'Source ID', value: approval.source_id || approval.sourceId || '--' }
        ])
      })}

      ${drawerSection({
        title: 'Payload',
        body: renderPayload(approval.payload)
      })}
      </div>
    </lex-drawer>
  `;
}

// Rows keep raw values; the renderers format them.
export function mapApprovalRow(approval) {
  return {
    approval_id: approvalId(approval),
    title: approval.title || formatLabel(approval.approval_type || '') || 'Approval',
    description: approval.description || '',
    source_type: approval.source_type || approval.sourceType || '',
    approval_type: approval.approval_type || approval.approvalType || approval.type || '',
    priority: String(approval.priority || 'normal').toLowerCase(),
    matter: approval.matter_id || approval.client_matter_id || '',
    matter_name: approval.matter_name || '',
    created_at: approval.created_at || approval.createdAt || '',
    expires_at: approval.expires_at || approval.expiresAt || '',
    _approval: approval
  };
}

function approvalsStore(context) {
  context.state.tables = context.state.tables || {};
  if (!context.state.tables.approvals) {
    context.state.tables.approvals = {
      ...createServerTableStore(),
      facets: null,
      workspaces: [],
      seenMatters: [],
      total: null
    };
  }
  return context.state.tables.approvals;
}

export function invalidateApprovalsTable(context) {
  invalidateServerTable(context.state.tables?.approvals);
}

function cellRenderers() {
  const Q = Queries();
  const label = (value) => (value ? textCell(Q.humanizeLabel(value)) : mutedCell());
  return {
    title: (value, row) => nameCell(value, row.description),
    source_type: label,
    approval_type: label,
    priority: (value) => badge(Q.humanizeLabel(value || 'normal'), PRIORITY_COLORS[value] || ''),
    matter: (value, row) => matterLinkCell(value, row.matter_name, 'Matter'),
    created_at: dateTimeCell,
    expires_at: dateTimeCell
  };
}

// Highest first, as the toolbar and column list them.
function priorityOptions() {
  const Q = Queries();
  return Q.optionsFromValues([...Q.PRIORITIES].reverse());
}

function filterOptions(store) {
  const Q = Queries();
  const shared = window.LanaLibraryColumnFilters;
  const types = store.facets?.approval_types?.length ? store.facets.approval_types : Q.APPROVAL_TYPES;
  const sources = store.facets?.source_types?.length ? store.facets.source_types : Q.APPROVAL_SOURCE_TYPES;
  const map = {
    title: { text: true, placeholder: 'Title contains...' },
    source_type: { options: Q.optionsFromValues(sources) },
    approval_type: { options: Q.optionsFromValues(types) },
    priority: { options: priorityOptions() }
  };
  // The inbox filters one matter at a time.
  const matters = store.workspaces.length ? store.workspaces : store.seenMatters;
  if (matters.length) map.matter = { single: true, options: matters };
  if (shared) {
    map.created_at = { single: true, options: shared.EDITED_RANGE_OPTIONS };
    map.expires_at = { single: true, options: shared.EDITED_RANGE_OPTIONS };
  }
  return map;
}

function applyFilterOptions(store) {
  const table = document.getElementById(TABLE_ID);
  if (table && typeof table.setColumnFilterOptions === 'function') {
    table.setColumnFilterOptions(filterOptions(store));
  }
}

// Type and source values in use (built-in lists when the facet route is
// missing), and the workspace list for the Matter column.
function loadFilterSources(context, store) {
  if (store.sourcesRequested) return;
  store.sourcesRequested = true;
  context.fetchJson('/api/approvals/inbox/facets', { headers: context.authHeaders() })
    .then((response) => {
      const Q = Queries();
      store.facets = {
        approval_types: Q.facetValues(response, 'approval_types'),
        source_types: Q.facetValues(response, 'source_types')
      };
      applyFilterOptions(store);
    })
    .catch(() => {
      store.facets = null;
    });
  const shared = window.LanaLibraryColumnFilters;
  if (shared && window.api) {
    // Approvals carry the workspace uuid (matter_id), so filter by id.
    shared.loadWorkspaces(window.api).then((matters) => {
      store.workspaces = shared.workspaceOptions(matters, 'id');
      applyFilterOptions(store);
    }).catch(() => {});
  }
}

async function fetchApprovalsPage(context, query, search) {
  const Q = Queries();
  const params = Q.approvalsParams(query, search);
  const response = await context.fetchJson(`/api/approvals/inbox?${params.toString()}`, { headers: context.authHeaders() });
  const approvals = response?.approvals || response?.data || [];
  context.state.approvals = approvals;
  return {
    rows: approvals.map(mapApprovalRow),
    pagination: Q.tablePagination(response, query, approvals.length)
  };
}

// Until the workspace list loads, the Matter filter offers the matters seen on loaded pages.
function rememberSeenMatters(store, rows) {
  let changed = false;
  rows.forEach((row) => {
    if (row.matter && !store.seenMatters.some((option) => option.value === row.matter)) {
      store.seenMatters.push({ value: row.matter, label: row.matter_name || row.matter });
      changed = true;
    }
  });
  if (changed && !store.workspaces.length) applyFilterOptions(store);
}

function bannerBadge(store) {
  const total = store.total;
  return `<span id="automationApprovalsTotalBadge">${badge(
    total === null ? 'Loading approvals' : `${total} ${total === 1 ? 'approval' : 'approvals'} in queue`,
    total ? 'warning' : ''
  )}</span>`;
}

function updateBannerBadge(store, result) {
  store.total = Number(result.pagination?.total) || 0;
  const current = document.getElementById('automationApprovalsTotalBadge');
  if (!current) return;
  const wrapper = document.createElement('div');
  wrapper.innerHTML = bannerBadge(store);
  current.replaceWith(wrapper.firstElementChild);
}

export function renderApprovals(context) {
  const store = approvalsStore(context);
  const Q = Queries();

  context.els.viewContent.innerHTML = `
    ${sectionIntro({
      eyebrow: 'Human Review',
      title: 'Approvals stay clear and close to the work.',
      copy: 'This queue should remain simple: what needs attention, how urgent it is, and what decision has to be made.',
      badges: [bannerBadge(store)]
    })}

    ${serverTableSection({
      prefix: TOOLBAR_PREFIX,
      store,
      title: 'Approval Queue',
      searchLabel: 'Search and filter approvals',
      searchPlaceholder: 'Search approvals...',
      sortOptions: [
        { value: 'created_at', label: 'Created' },
        { value: 'expires_at', label: 'Expires' },
        { value: 'priority', label: 'Priority' },
        { value: 'title', label: 'Title' },
        { value: 'source_type', label: 'Source' },
        { value: 'approval_type', label: 'Type' }
      ],
      filter: { label: 'Priority', key: 'priority', options: priorityOptions() },
      table: {
        id: TABLE_ID,
        columns: ['title', 'source_type', 'approval_type', 'priority', 'matter', 'created_at', 'expires_at'],
        labels: ['Title', 'Source', 'Type', 'Priority', 'Matter', 'Created', 'Expires'],
        sortableColumns: Object.keys(Q.APPROVALS_SORT_BY),
        sortBy: 'created_at',
        sortDir: 'desc',
        idKey: 'approval_id',
        emptyText: 'No approvals waiting',
        ariaLabel: 'Approval queue'
      }
    })}

    ${renderApprovalDetailsPanel(context)}
  `;

  mountServerTable({
    id: TABLE_ID,
    prefix: TOOLBAR_PREFIX,
    store,
    fetchPage: (query, search) => fetchApprovalsPage(context, query, search),
    renderers: cellRenderers(),
    filterOptions: () => filterOptions(store),
    filterKey: 'priority',
    noun: ['approval', 'approvals'],
    emptyText: {
      base: 'No approvals waiting',
      filtered: 'No matching approvals. Try a different search or filter.'
    },
    errorText: 'Approvals could not be loaded. Check your connection and try again.',
    onLoaded: (result) => {
      rememberSeenMatters(store, result.rows);
      updateBannerBadge(store, result);
    },
    onRowClick: async (row) => {
      if (row?.approval_id && typeof context.loadApprovalDetail === 'function') {
        await context.loadApprovalDetail(row.approval_id, row._approval || null);
        context.renderCurrentView();
      }
    }
  });
  loadFilterSources(context, store);
}
