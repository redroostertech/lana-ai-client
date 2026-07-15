'use strict';

const {
  normalizeAdminUsersResponse
} = require('../../src/js/admin/admin-users.pagination');

describe('admin users pagination response normalization', () => {
  test('uses nested API pagination totals instead of the current page length', () => {
    const result = normalizeAdminUsersResponse({
      users: Array.from({ length: 19 }, (_, index) => ({ id: `user-${index}` })),
      pagination: {
        page: 1,
        page_size: 20,
        total_count: 34,
        total_pages: 2,
        has_next: true
      }
    });

    expect(result.users).toHaveLength(19);
    expect(result.total).toBe(34);
  });

  test('preserves legacy top-level totals', () => {
    expect(normalizeAdminUsersResponse({
      data: [{ id: 'user-1' }],
      total: 5
    })).toEqual({
      users: [{ id: 'user-1' }],
      total: 5
    });
  });

  test('supports legacy array responses', () => {
    expect(normalizeAdminUsersResponse([{ id: 'user-1' }])).toEqual({
      users: [{ id: 'user-1' }],
      total: 1
    });
  });
});
