import {
  badge,
  drawerSection,
  drawerStatGrid,
  hydrateLexDataTable,
  lexDataTable,
  lexEmpty,
  sectionIntro,
  surface
} from '../shared/ui.js';
import { escapeAttribute, escapeHtml, formatDate, formatLabel, normalizeText } from '../shared/utils.js';

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

export function renderApprovals(context) {
  const approvalRows = context.state.approvals.map((approval) => ({
    approval_id: approvalId(approval),
    title: approval.title || approval.approval_type || 'Approval',
    description: approval.description || '',
    source_type: formatLabel(approval.source_type || approval.sourceType || 'automation_execution'),
    approval_type: formatLabel(approval.approval_type || approval.approvalType || approval.type || 'automation_action'),
    priority: formatLabel(approval.priority || 'normal'),
    _approval: approval
  }));
  context.els.viewContent.innerHTML = `
    ${sectionIntro({
      eyebrow: 'Human Review',
      title: 'Approvals stay clear and close to the work.',
      copy: 'This queue should remain simple: what needs attention, how urgent it is, and what decision has to be made.',
      badges: [
        badge(`${context.state.approvals.length} approvals in queue`, context.state.approvals.length ? 'warning' : '')
      ]
    })}

    <div class="runs-history-layout no-detail">
      ${surface({
        title: 'Approval Queue',
        subtitle: 'Pending decisions waiting on a person, not another automation.',
        body: lexDataTable({
          id: 'automationApprovalsTable',
          columns: ['title', 'description', 'source_type', 'approval_type', 'priority'],
          labels: ['Title', 'Description', 'Source', 'Type', 'Priority'],
          emptyText: 'No approvals found',
          sortBy: 'priority',
          sortDir: 'desc',
          idKey: 'approval_id',
          limit: 20,
          ariaLabel: 'Approval queue'
        })
      })}

      ${renderApprovalDetailsPanel(context)}
    </div>
  `;

  hydrateLexDataTable('automationApprovalsTable', approvalRows, async (row) => {
    if (row?.approval_id && typeof context.loadApprovalDetail === 'function') {
      await context.loadApprovalDetail(row.approval_id, row._approval || null);
      context.renderCurrentView();
    }
  });
}
