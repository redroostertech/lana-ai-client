import { badge, filterCollection, listItem, resourceSurface, sectionIntro } from '../shared/ui.js';
import { normalizeText } from '../shared/utils.js';

function matchesApprovalState(approval, filterState) {
  if (filterState === 'all') return true;
  return normalizeText(approval.priority || 'normal') === normalizeText(filterState);
}

function priorityClass(priority) {
  if (priority === 'high' || priority === 'urgent') return 'warning';
  if (priority === 'medium') return '';
  return '';
}

export function renderApprovals(context) {
  const visibleApprovals = filterCollection(
    context.state.approvals,
    context.state.filters.approvals,
    (approval) => [approval.title, approval.approval_type, approval.description, approval.source_type, approval.priority],
    (approval, filters) => matchesApprovalState(approval, filters.state)
  );

  context.els.viewContent.innerHTML = `
    ${sectionIntro({
      eyebrow: 'Human Review',
      title: 'Approvals stay clear and close to the work.',
      copy: 'This queue should remain simple: what needs attention, how urgent it is, and what decision has to be made.',
      badges: [
        badge(`${context.state.approvals.length} approvals in queue`, context.state.approvals.length ? 'warning' : '')
      ]
    })}

    ${resourceSurface({
      title: 'Approval Queue',
      subtitle: 'Pending decisions waiting on a person, not another automation.',
      viewKey: 'approvals',
      searchPlaceholder: 'Search approvals by title, priority, or source',
      totalCount: context.state.approvals.length,
      visibleCount: visibleApprovals.length,
      filterDefs: [
        {
          field: 'state',
          label: 'Priority',
          options: [
            ['all', 'All'],
            ['urgent', 'Urgent'],
            ['high', 'High'],
            ['medium', 'Medium'],
            ['normal', 'Normal']
          ]
        }
      ],
      filters: context.state.filters.approvals,
      items: visibleApprovals.map((approval) => listItem({
        title: approval.title || approval.approval_type || 'Approval',
        detailLines: [approval.description || approval.source_type || ''],
        aside: `<div class="badge-row">${badge(approval.priority || 'normal', priorityClass(approval.priority))}</div>`
      })),
      emptyMessage: 'No approvals match the current filter.'
    })}
  `;
}
