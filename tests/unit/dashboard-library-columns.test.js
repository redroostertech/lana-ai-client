'use strict';

/**
 * All dashboards table columns (pure): "Who can see it" replaces Audience
 * and Visibility, Area shows only when it differs across rows, Scope becomes
 * a tag next to the name only when a row is not organization-wide.
 */

const path = require('path');
const C = require(path.join(__dirname, '../../src/js/shared/dashboard-library-columns.js'));

const rows = [
  { name: 'Owner', audience: 'owner', visibility: 'Owner only', category: 'legal', scope: 'Organization-wide', state: 'Active' },
  { name: 'Team', audience: 'department', visibility: 'Team access', category: 'legal', scope: 'Organization-wide', state: 'Active' },
];

test('whoCanSee reads visibility_label, else the audience in words', () => {
  expect(C.whoCanSee(rows[0])).toBe('Owner only');
  expect(C.whoCanSee({ audience: 'attorney' })).toBe('Attorney');
  expect(C.whoCanSee({})).toBe('');
});

test('scopeTag only for rows that are not organization-wide', () => {
  expect(C.scopeTag(rows[0])).toBe('');
  expect(C.scopeTag({ scope: 'organization-wide' })).toBe('');
  expect(C.scopeTag({ scope: 'Personal' })).toBe('Personal');
  expect(C.scopeTag({})).toBe('');
});

test('constant Area and State columns are hidden; Audience, Scope and Visibility never show', () => {
  expect(C.tableColumns(rows)).toEqual({
    columns: ['pin', 'name', 'who', 'created_at', 'updated_at', 'actions'],
    labels: [' ', 'Name', 'Who can see it', 'Created', 'Last edited', 'Actions'],
    sortable: ['name', 'who', 'created_at', 'updated_at'],
  });
});

test('Area and State show when they differ across rows', () => {
  const mixed = rows.concat([{ name: 'Funding', category: 'finance', state: 'Draft' }]);
  const cols = C.tableColumns(mixed);
  expect(cols.columns).toEqual(['pin', 'name', 'who', 'category', 'state', 'created_at', 'updated_at', 'actions']);
  expect(cols.labels).toEqual([' ', 'Name', 'Who can see it', 'Area', 'State', 'Created', 'Last edited', 'Actions']);
});

test('one row or none: nothing varies, so only the fixed columns', () => {
  expect(C.tableColumns([rows[0]]).columns).toEqual(['pin', 'name', 'who', 'created_at', 'updated_at', 'actions']);
  expect(C.tableColumns([]).columns).toEqual(['pin', 'name', 'who', 'created_at', 'updated_at', 'actions']);
});
