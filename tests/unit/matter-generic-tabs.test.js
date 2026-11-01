'use strict';

const G = require('../../src/js/shared/matter-generic-tabs.js');

const content = {
  columns: [{ key: 'name', label: 'Name' }, { key: 'value', label: 'Value' }],
  rows: [
    { id: 'r1', cells: { name: 'House', value: '100' }, actions: [{ id: 'edit', label: 'Edit', form: 'provider.update', subject: 'record:r1' }] },
    { id: 'r2', cells: { name: 'Car' } },
  ],
  actions: [{ id: 'add', label: 'Add', form: 'provider.create' }],
  groups: [{ id: 'g', title: 'Group', rows: [{ id: 'rule', actions: [{ label: 'Set', form: 'provider.set', subject: 'rule:x' }, { label: 'No form' }] }] }],
};

describe('matter-generic-tabs', () => {
  test('recordTable flattens server rows and adds an actions column only when a row has actions', () => {
    const model = G.recordTable(content);
    expect(model.columns).toEqual(['name', 'value', 'actions']);
    expect(model.labels).toEqual(['Name', 'Value', 'Actions']);
    expect(model.rows).toEqual([
      { id: 'r1', _index: 0, name: 'House', value: '100', actions: '' },
      { id: 'r2', _index: 1, name: 'Car', value: '', actions: '' },
    ]);
    expect(G.recordTable({ columns: content.columns, rows: [content.rows[1]] }).columns).toEqual(['name', 'value']);
  });

  test('actionAt resolves tab, row and grouped row actions, and ignores actions without a form', () => {
    expect(G.actionAt(content, null, '0', null).form).toBe('provider.create');
    expect(G.actionAt(content, '0', '0', null).subject).toBe('record:r1');
    expect(G.actionAt(content, '0', '0', '0').subject).toBe('rule:x');
    expect(G.actionAt(content, '0', '1', '0')).toBeNull();
    expect(G.actionAt(content, '1', '0', null)).toBeNull();
  });

  test('mergePage appends later pages and carries the next cursor', () => {
    const first = G.mergePage(null, { rows: [{ id: 1 }], next_cursor: 'c2', description: 'D' });
    const merged = G.mergePage(first, { rows: [{ id: 2 }], next_cursor: null });
    expect(merged.rows.map((r) => r.id)).toEqual([1, 2]);
    expect(merged.next_cursor).toBeNull();
    expect(merged.description).toBe('D');
  });

  test('a later group named <id>:after:<cursor> continues its group; control: a look-alike id is a new group', () => {
    const first = G.mergePage(null, { groups: [{ id: 'targets', subtitle: 'More follow.', rows: [{ id: 't1' }] }, { id: 'module:a', rows: [{ id: 'r' }] }] });
    const merged = G.mergePage(first, { groups: [{ id: 'targets:after:c1', rows: [{ id: 't2' }] }, { id: 'targetsx', rows: [{ id: 'x' }] }] });
    expect(merged.groups.map((g) => g.id)).toEqual(['targets', 'module:a', 'targetsx']);
    expect(merged.groups[0].rows.map((r) => r.id)).toEqual(['t1', 't2']);
    expect(merged.groups[0].subtitle).toBeUndefined();
    expect(first.groups[0].rows.map((r) => r.id)).toEqual(['t1']);
  });

  test('downloadName keeps the server name made safe, else builds one; downloadMessage words each refusal', () => {
    expect(G.downloadName('decisions', { id: 'closeout:c1' }, 'closeout-c1.json')).toBe('closeout-c1.json');
    expect(G.downloadName('decisions', { id: 'closeout:c1' }, '../a b.json')).toBe('..-a-b.json');
    expect(G.downloadName('decisions', { id: 'closeout:c1' }, '')).toBe('decisions-closeout-c1.json');
    expect(G.downloadMessage({ status: 403, code: 'TAB_UNAVAILABLE', message: 'Reason.' })).toBe('Reason.');
    expect(G.downloadMessage({ status: 403, code: 'OTHER', message: 'x' })).toBe(G.DOWNLOAD_MESSAGES.forbidden);
    expect(G.downloadMessage({ status: 404 })).toBe(G.DOWNLOAD_MESSAGES.notFound);
    expect(G.downloadMessage({ status: 404, code: 'CLOSEOUT_NOT_ACCEPTED', message: 'Accept this closeout first.' })).toBe('Accept this closeout first.');
    expect(G.downloadMessage({ status: 404, code: 'NOT_FOUND', message: 'Not found' })).toBe(G.DOWNLOAD_MESSAGES.notFound);
    expect(G.downloadMessage({ status: 500 })).toBe(G.DOWNLOAD_MESSAGES.failed);
    expect(G.downloadMessage({ status: 500 })).toBe(G.DOWNLOAD_MESSAGES.failed);
  });

  test('only http and https citation links are followed; tones map to badge colors', () => {
    expect(G.safeLinkUrl('https://example.com/a')).toBe('https://example.com/a');
    expect(G.safeLinkUrl('javascript:alert(1)')).toBeNull();
    expect(G.safeLinkUrl('not a url')).toBeNull();
    expect(G.badgeColor('danger')).toBe('red');
    expect(G.badgeColor('mystery')).toBe('gray');
  });
});
