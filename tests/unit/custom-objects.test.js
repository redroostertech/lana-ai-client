'use strict';

// Custom objects client mapping (src/js/shared/custom-objects.js) and its
// transport: requests go where the backend serves them, an edited type keeps
// its field and option keys, a removed choice is retired (not deleted), a
// protected choice is kept, a create names a key and a change names the
// version it was read at, and the matter drawer offers Remove only for an
// attached type when the server says this person may attach.

const C = require('../../src/js/shared/custom-objects.js');
const CustomObjectsAPIClient = require('../../src/js/api/custom-objects-api.client.js');

const payment = {
  id: 't1', key: 'payment', label: 'Payment', label_plural: 'Payments', version: 3, is_active: true, is_protected: true,
  policy: { record_edit: 'matter_write', record_delete: 'matter_write', field_locks: [] },
  created_by: { id: null, name: 'LANA' }, created_at: '2026-11-01T10:00:00Z', updated_by: { id: 'u1', name: 'Ada Admin' }, updated_at: '2026-11-03T10:00:00Z',
  fields: [
    { key: 'amount', label: 'Amount', kind: 'currency', required: true, currency: 'USD', protected: true },
    { key: 'status', label: 'Status', kind: 'select', required: true, protected: true,
      options: [{ key: 'due', label: 'Due', protected: true }, { key: 'paid', label: 'Paid', protected: true }] },
    { key: 'method', label: 'Method', kind: 'select', options: [{ key: 'check', label: 'Check' }, { key: 'cash', label: 'Cash' }] }
  ]
};

test('requests follow the backend routes', () => {
  expect(C.requests.listTypes(true)).toEqual({ method: 'GET', path: '/api/v1/custom-object-types?include_archived=true' });
  expect(C.requests.updateType('t1', { a: 1 })).toEqual({ method: 'PATCH', path: '/api/v1/custom-object-types/t1', body: { a: 1 } });
  expect(C.requests.matterTypes('M 1', 'pay')).toEqual({ method: 'GET', path: '/api/v1/matters/M%201/object-types?q=pay' });
  expect(C.requests.attach('m1', 't1')).toEqual({ method: 'POST', path: '/api/v1/matters/m1/object-types', body: { type_id: 't1' } });
  expect(C.requests.detach('m1', 't1')).toEqual({ method: 'DELETE', path: '/api/v1/matters/m1/object-types/t1' });
});

test('a change keeps keys, retires a removed choice, keeps protected choices, and names its version', () => {
  const draft = C.draftFromType(payment);
  const method = draft.fields.find((field) => field.key === 'method');
  method.choices = [{ key: 'check', label: 'Check' }, { key: '', label: 'Wire transfer' }];
  const status = draft.fields.find((field) => field.key === 'status');
  status.choices = [{ key: 'due', label: 'Due', protected: true }];
  const body = C.bodyFromDraft(draft);
  expect(body.expected_version).toBe(3);
  expect(body.key).toBeUndefined();
  expect(body.fields.find((field) => field.key === 'method').options).toEqual([
    { key: 'check', label: 'Check' }, { key: 'wire_transfer', label: 'Wire transfer' }, { key: 'cash', label: 'Cash', retired: true }
  ]);
  expect(body.fields.find((field) => field.key === 'status').options).toEqual([
    { key: 'due', label: 'Due', protected: true }, { key: 'paid', label: 'Paid', protected: true }
  ]);
  expect(body.fields.find((field) => field.key === 'amount')).toMatchObject({ protected: true, currency: 'USD' });
});

test('a new type names a key made from its label; a relabeled option keeps no stale key', () => {
  const draft = C.blankDraft();
  draft.label = 'Retainer Draw'; draft.label_plural = 'Retainer draws';
  draft.fields = [{ ...C.blankField(), label: 'Draw Status', kind: 'select', choices: [{ key: '', label: 'Open' }, { key: '', label: 'Closed' }] }];
  const body = C.bodyFromDraft(draft);
  expect(body.key).toBe('retainer_draw');
  expect(body.fields[0]).toMatchObject({ key: 'draw_status', options: [{ key: 'open', label: 'Open' }, { key: 'closed', label: 'Closed' }] });
});

test('renaming a choice keeps its key; only a removed choice is retired', () => {
  const draft = C.draftFromType(payment);
  const method = draft.fields.find((field) => field.key === 'method');
  method.choices = method.choices.map((choice) => (choice.key === 'check' ? { ...choice, label: 'Paper check' } : choice));
  const options = C.bodyFromDraft(draft).fields.find((field) => field.key === 'method').options;
  expect(options).toEqual([{ key: 'check', label: 'Paper check' }, { key: 'cash', label: 'Cash' }]);
});

test('rows show who created and last changed a type, under column names lex-table does not format as dates', () => {
  const dateLike = /(^|_)(created|updated|started|completed|expires|timestamp|date|time)(_|$)|(_at|_on|date|time|timestamp)$/;
  Object.keys(C.typeRows([payment])[0]).forEach((column) => expect(column).not.toMatch(dateLike));
  expect(C.typeRows([payment])[0]).toEqual({
    id: 't1', label: 'Payments', key: 'payment', fields: '3', status: 'Comes with LANA',
    author: 'Created by LANA on 2026-11-01', editor: 'Changed by Ada Admin on 2026-11-03'
  });
});

test('the matter drawer offers Remove only for an attached type, and only when allowed', () => {
  const answer = { can_attach: true, applied: [{ ...payment, applies_by: 'makeup' }, { id: 't2', key: 'retainer', label_plural: 'Retainers', applies_by: 'attached' }],
    available: [{ id: 't3', key: 'fee', label_plural: 'Fees' }] };
  const view = C.matterTypesView(answer);
  expect(view.applied.map((entry) => [entry.key, entry.canRemove])).toEqual([['payment', false], ['retainer', true]]);
  expect(view.available[0].canAdd).toBe(true);
  const readOnly = C.matterTypesView({ ...answer, can_attach: false });
  expect(readOnly.applied.every((entry) => !entry.canRemove)).toBe(true);
  expect(readOnly.available[0].canAdd).toBe(false);
});

test('the client sends what the module builds', async () => {
  const api = { get: jest.fn(async () => ({ types: [payment] })), post: jest.fn(async () => ({ type: payment })), patch: jest.fn(async () => ({ type: payment })), delete: jest.fn() };
  const client = new CustomObjectsAPIClient(api);
  expect(await client.listTypes(false)).toEqual([payment]);
  await client.saveDraft(C.draftFromType(payment));
  expect(api.patch).toHaveBeenCalledWith('/api/v1/custom-object-types/t1', expect.objectContaining({ expected_version: 3 }));
  await client.attach('m1', 't1');
  expect(api.post).toHaveBeenCalledWith('/api/v1/matters/m1/object-types', { type_id: 't1' });
});

test('a refusal shows the server sentence', () => {
  expect(C.errorText({ data: { message: 'This type changed since you opened it.' } })).toBe('This type changed since you opened it.');
  expect(C.errorText(null)).toBe('That did not work. Try again.');
});

test('the editor titles itself with its own element, not the card heading (which rebuilds the card body and drops the values)', () => {
  const fs = require('fs');
  const path = require('path');
  const js = fs.readFileSync(path.join(__dirname, '../../src/js/admin/custom-objects.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '../../src/admin/custom-objects.html'), 'utf8');
  expect(js).not.toMatch(/editorCard'\)\.setAttribute\('heading'/);
  expect(html).toMatch(/id="editorTitle"/);
});
