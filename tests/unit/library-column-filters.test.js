'use strict';

const filters = require('../../src/js/shared/library-column-filters.js');

describe('library-column-filters', () => {
  const now = new Date('2026-10-20T15:30:00.000Z');

  test('Last edited ranges map to updated_after / updated_before', () => {
    expect(filters.editedRangeBounds('7d', now)).toEqual({ after: '2026-10-13T15:30:00.000Z', before: '' });
    expect(filters.editedRangeBounds('30d', now)).toEqual({ after: '2026-09-20T15:30:00.000Z', before: '' });
    expect(filters.editedRangeBounds('older', now)).toEqual({ after: '', before: '2026-09-20T15:30:00.000Z' });
    expect(filters.editedRangeBounds(undefined, now)).toEqual({ after: '', before: '' });
    expect(filters.editedRangeBounds('bogus', now)).toEqual({ after: '', before: '' });
  });

  test('"Today" starts at local midnight', () => {
    const local = new Date(now.getTime());
    local.setHours(0, 0, 0, 0);
    expect(filters.editedRangeBounds('today', now)).toEqual({ after: local.toISOString(), before: '' });
  });

  test('every range option has bounds', () => {
    filters.EDITED_RANGE_OPTIONS.forEach((option) => {
      const bounds = filters.editedRangeBounds(option.value, now);
      expect(bounds.after || bounds.before).toBeTruthy();
    });
  });

  test('workspace options use matter_id values, workspace names, deduped and sorted', () => {
    expect(filters.workspaceOptions([
      { matter_id: 'MATT-2', name: 'beta' },
      { matter_id: 'MATT-10', name: 'Alpha 10' },
      { matter_id: 'MATT-9', name: 'Alpha 9' },
      { matter_id: 'MATT-2', name: 'beta again' },
      { name: 'no id' }
    ])).toEqual([
      { value: 'MATT-9', label: 'Alpha 9' },
      { value: 'MATT-10', label: 'Alpha 10' },
      { value: 'MATT-2', label: 'beta' }
    ]);
  });

  test('workspaces sharing a name are told apart by id', () => {
    expect(filters.workspaceOptions([
      { matter_id: '10399', name: 'Acme Executive Separation' },
      { matter_id: '10539', name: 'Acme Executive Separation' },
      { matter_id: 'M-1', name: 'Solo' }
    ]).map((o) => o.label)).toEqual(['Acme Executive Separation · 10399', 'Acme Executive Separation · 10539', 'Solo']);
  });

  test('loadWorkspaceOptions pages through every workspace', async () => {
    const pages = { 1: ['A', 'B'], 2: ['C'] };
    const api = { get: async (url) => {
      const page = Number(new URL('http://x' + url).searchParams.get('page'));
      return { matters: (pages[page] || []).map((n) => ({ matter_id: n, name: n })), pagination: { total_pages: 2 } };
    } };
    await expect(filters.loadWorkspaceOptions(api)).resolves.toEqual(['A', 'B', 'C'].map((n) => ({ value: n, label: n })));
  });

  test('loadWorkspaceOptions reads every workspace and degrades to [] on failure', async () => {
    const calls = [];
    const api = { get: async (url) => { calls.push(url); return { matters: [{ matter_id: 'M-1', name: 'One' }] }; } };
    await expect(filters.loadWorkspaceOptions(api)).resolves.toEqual([{ value: 'M-1', label: 'One' }]);
    expect(calls[0]).toContain('/api/v1/storage/matters?');
    await expect(filters.loadWorkspaceOptions({ get: async () => { throw new Error('down'); } })).resolves.toEqual([]);
    await expect(filters.loadWorkspaceOptions(null)).resolves.toEqual([]);
  });
});
