'use strict';

// The matter "Edit Custom Fields" drawer writes through the typed matter-field
// endpoints. A field lives in the organization library but applies only to
// the matters that attached it: the drawer lists this matter's attached
// fields, creates new ones (library + attach here), attaches existing ones
// from the library, and detaches. PUT /matters/:id/settings refuses custom
// fields, so no request built here may go there.

const MatterFields = require('../../src/js/shared/matter-fields.js');
const MatterFieldsAPIClient = require('../../src/js/api/matter-fields-api.client.js');

const SERVER_ATTACHED = {
  status: 'success',
  data: {
    matter_id: 'MATT-1',
    can_manage_library: true,
    fields: [
      { id: 'd-1', field_key: 'case_number', field_label: 'Case Number', field_type: 'text', is_required: true, options: [], default_value: null },
      { id: 'd-2', field_key: 'stage', field_label: 'Stage', field_type: 'select', is_required: false, options: ['Open', 'Closed'], default_value: 'Open' },
      { id: 'd-3', field_key: 'estate_value', field_label: 'Estate Value', field_type: 'currency', is_required: false, options: [], default_value: null }
    ]
  }
};

const SERVER_VALUES = {
  status: 'success',
  data: {
    matter_id: 'MATT-1',
    values: [
      { field_key: 'case_number', field_label: 'Case Number', field_type: 'text', value: 'A-100' },
      { field_key: 'estate_value', field_label: 'Estate Value', field_type: 'currency', value: 250000 }
    ]
  }
};

const SERVER_LIBRARY = {
  status: 'success',
  data: {
    definitions: [
      { id: 'd-1', field_key: 'case_number', field_label: 'Case Number', field_type: 'text', is_required: true, options: [], attached: true },
      { id: 'd-9', field_key: 'trustee', field_label: 'Trustee', field_type: 'text', is_required: false, options: [], attached: false }
    ],
    total: 2, limit: 200, offset: 0
  }
};

function fakeApi(overrides = {}) {
  return {
    get: jest.fn(async (path) => {
      if (path.indexOf('/field-values') !== -1) return SERVER_VALUES;
      if (path.indexOf('/field-library') !== -1) return SERVER_LIBRARY;
      return SERVER_ATTACHED;
    }),
    post: jest.fn(async (path, body) => ({ status: 'success', data: Object.assign({ id: 'd-new' }, body) })),
    patch: jest.fn(async () => ({ status: 'success', data: {} })),
    put: jest.fn(async () => ({ status: 'success', data: { values: [] } })),
    delete: jest.fn(async () => ({ status: 'success', data: {} })),
    ...overrides
  };
}

function loadedState() {
  return MatterFields.toDrawerState(SERVER_ATTACHED, SERVER_VALUES);
}

describe('matter-fields model', () => {
  test('maps this matter\'s attached fields and values into the drawer state', () => {
    const state = loadedState();
    expect(state.definitions).toEqual([
      { id: 'd-1', key: 'case_number', display_name: 'Case Number', type: 'text', required: true, options: [], default_value: null },
      { id: 'd-2', key: 'stage', display_name: 'Stage', type: 'select', required: false, options: ['Open', 'Closed'], default_value: 'Open' },
      { id: 'd-3', key: 'estate_value', display_name: 'Estate Value', type: 'currency', required: false, options: [], default_value: null }
    ]);
    // A default is a hint, never a value: stage stays blank.
    expect(state.values).toEqual([
      { key: 'case_number', value: 'A-100' },
      { key: 'stage', value: '' },
      { key: 'estate_value', value: 250000 }
    ]);
  });

  test('carries whether this person may change library fields', () => {
    expect(loadedState().canManageLibrary).toBe(true);
    const member = MatterFields.toDrawerState({ data: { fields: [], can_manage_library: false } }, SERVER_VALUES);
    expect(member.canManageLibrary).toBe(false);
  });

  test('a person who cannot manage the library sends no field changes, only values and attachments', () => {
    const base = Object.assign(loadedState(), { canManageLibrary: false });
    let edit = MatterFields.cloneState(base);
    edit.definitions[0].display_name = 'Renamed';
    edit.definitions[1].required = true;
    edit = MatterFields.addLibraryField(edit, SERVER_LIBRARY.data.definitions[1]);
    edit.values[1].value = 'Closed';
    const plan = MatterFields.planSave(base, edit);
    expect(plan.updates).toEqual([]);
    expect(plan.attaches).toEqual(['d-9']);
    expect(plan.values).toEqual([{ field_key: 'stage', value: 'Closed' }]);
  });

  test('an admin\'s edit to a field just picked from the library is sent after the attach', () => {
    const base = loadedState();
    let edit = MatterFields.addLibraryField(base, SERVER_LIBRARY.data.definitions[1]);
    const picked = edit.definitions.find((d) => d.id === 'd-9');
    picked.display_name = 'Successor Trustee';
    const plan = MatterFields.planSave(base, edit);
    expect(plan.attaches).toEqual(['d-9']);
    expect(plan.updates).toEqual([{ id: 'd-9', body: { field_label: 'Successor Trustee' } }]);
  });

  test('an unchanged drawer plans nothing', () => {
    const base = loadedState();
    const plan = MatterFields.planSave(base, MatterFields.cloneState(base));
    expect(plan.errors.concat(plan.creates, plan.attaches, plan.updates, plan.detaches, plan.values)).toEqual([]);
    expect(Object.keys(plan).sort()).toEqual(['attaches', 'creates', 'detaches', 'errors', 'updates', 'values']);
    expect(plan).toEqual({ errors: [], creates: [], attaches: [], updates: [], detaches: [], values: [] });
  });

  test('plans creates, attaches of library fields, label edits, detaches and one value write', () => {
    const base = loadedState();
    let edit = MatterFields.cloneState(base);
    edit.definitions[0].display_name = 'Court Case Number';
    edit.definitions[1].options = ['Open', 'Pending', 'Closed'];
    edit.definitions.splice(2, 1); // remove estate_value from this matter
    edit = MatterFields.addLibraryField(edit, SERVER_LIBRARY.data.definitions[1]);
    edit.definitions.push({ key: 'filing_date', display_name: 'Filing Date', type: 'date', required: false, options: [] });
    edit.values.push({ key: 'filing_date', value: '2026-11-01' });
    edit.values[0].value = '';
    edit.values[1].value = 'Pending';
    edit.values.find((v) => v.key === 'trustee').value = 'Ann';

    const plan = MatterFields.planSave(base, edit);
    expect(plan.errors).toEqual([]);
    expect(plan.creates).toEqual([
      { key: 'filing_date', body: { field_key: 'filing_date', field_label: 'Filing Date', field_type: 'date', is_required: false } }
    ]);
    expect(plan.attaches).toEqual(['d-9']);
    expect(plan.updates).toEqual([
      { id: 'd-1', body: { field_label: 'Court Case Number' } },
      { id: 'd-2', body: { options: ['Open', 'Pending', 'Closed'] } }
    ]);
    expect(plan.detaches).toEqual(['d-3']);
    expect(plan.values).toEqual([
      { field_key: 'case_number', value: null },
      { field_key: 'stage', value: 'Pending' },
      { field_key: 'trustee', value: 'Ann' },
      { field_key: 'filing_date', value: '2026-11-01' }
    ]);
  });

  test('a saved field never sends a type change (it would strand stored values)', () => {
    const base = loadedState();
    const edit = MatterFields.cloneState(base);
    edit.definitions[2].type = 'text';
    expect(MatterFields.planSave(base, edit).updates).toEqual([]);
  });

  test('request builders target the typed endpoints, never settings', () => {
    const requests = [
      MatterFields.attachedRequest('MATT 1'),
      MatterFields.valuesRequest('MATT 1'),
      MatterFields.libraryRequest('MATT 1', 'law'),
      MatterFields.createRequest({ field_key: 'x', field_label: 'X', field_type: 'text', is_required: false }),
      MatterFields.attachRequest('MATT 1', 'd-1'),
      MatterFields.detachRequest('MATT 1', 'd-1'),
      MatterFields.updateRequest({ id: 'd-1', body: { field_label: 'Y' } }),
      MatterFields.valuesWriteRequest('MATT 1', [{ field_key: 'x', value: 'v' }])
    ];
    expect(requests).toEqual([
      { method: 'GET', path: '/api/v1/matters/MATT%201/field-attachments' },
      { method: 'GET', path: '/api/v1/matters/MATT%201/field-values' },
      { method: 'GET', path: '/api/v1/matters/MATT%201/field-library?limit=200&q=law' },
      { method: 'POST', path: '/api/v1/matter-field-definitions', body: { field_key: 'x', field_label: 'X', field_type: 'text', is_required: false } },
      { method: 'POST', path: '/api/v1/matters/MATT%201/field-attachments', body: { field_definition_id: 'd-1' } },
      { method: 'DELETE', path: '/api/v1/matters/MATT%201/field-attachments/d-1' },
      { method: 'PATCH', path: '/api/v1/matter-field-definitions/d-1', body: { field_label: 'Y' } },
      { method: 'PUT', path: '/api/v1/matters/MATT%201/field-values', body: { values: [{ field_key: 'x', value: 'v' }] } }
    ]);
  });

  test('library options mark fields this matter already uses as not choosable', () => {
    expect(MatterFields.libraryOptions(SERVER_LIBRARY, loadedState())).toEqual([
      { value: 'd-1', label: 'Case Number (case_number)', description: 'Already on this matter', disabled: true },
      { value: 'd-9', label: 'Trustee (trustee)', description: 'Text', disabled: false }
    ]);
  });

  test('numbers typed as text are unchanged values, booleans are values not blanks', () => {
    const base = loadedState();
    const edit = MatterFields.cloneState(base);
    edit.values[2].value = '250000';
    expect(MatterFields.planSave(base, edit).values).toEqual([]);

    const b = { definitions: [{ id: 'd-9', key: 'signed', display_name: 'Signed', type: 'boolean', required: false, options: [] }], values: [{ key: 'signed', value: '' }] };
    const e = MatterFields.cloneState(b);
    e.values[0].value = false;
    expect(MatterFields.planSave(b, e).values).toEqual([{ field_key: 'signed', value: false }]);
  });

  test('refuses a missing name and duplicate keys before any request', () => {
    const base = { definitions: [], values: [] };
    expect(MatterFields.planSave(base, {
      definitions: [{ key: 'a_field', display_name: ' ', type: 'text', options: [] }], values: []
    }).errors).toEqual(['Every field needs a display name.']);
    expect(MatterFields.planSave(base, {
      definitions: [
        { key: 'dup', display_name: 'One', type: 'text', options: [] },
        { key: 'DUP', display_name: 'Two', type: 'text', options: [] }
      ],
      values: []
    }).errors).toEqual(['Duplicate field keys: dup']);
  });

  describe('library search', () => {
    beforeEach(() => { jest.useFakeTimers(); });
    afterEach(() => { jest.useRealTimers(); });

    test('debounces typing and asks the server with the latest text', async () => {
      const search = jest.fn(async (q) => ({ data: { definitions: [{ id: q }] } }));
      const onResults = jest.fn();
      const box = MatterFields.createLibrarySearch({ search, onResults, delayMs: 250 });
      box.query('t'); box.query('tr'); box.query('tru');
      expect(search).not.toHaveBeenCalled();
      jest.advanceTimersByTime(250);
      await Promise.resolve(); await Promise.resolve();
      expect(search.mock.calls).toEqual([['tru']]);
      expect(onResults).toHaveBeenCalledWith({ data: { definitions: [{ id: 'tru' }] } }, 'tru');
    });

    test('a slow older answer never replaces a newer one', async () => {
      let releaseOld;
      const search = jest.fn((q) => (q === 'old'
        ? new Promise((resolve) => { releaseOld = () => resolve({ data: { definitions: [{ id: 'old' }] } }); })
        : Promise.resolve({ data: { definitions: [{ id: 'new' }] } })));
      const onResults = jest.fn();
      const box = MatterFields.createLibrarySearch({ search, onResults, delayMs: 10 });
      box.query('old'); jest.advanceTimersByTime(10);
      box.query('new'); jest.advanceTimersByTime(10);
      await Promise.resolve(); await Promise.resolve();
      releaseOld(); await Promise.resolve(); await Promise.resolve();
      expect(onResults.mock.calls.map((c) => c[1])).toEqual(['new']);
    });
  });

  test('displayHtml escapes every value shape, including a stored script payload', () => {
    const payload = '<img src=x onerror=alert(1)>';
    const shapes = [
      { type: 'text', value: payload },
      { type: 'text', value: payload + 'x'.repeat(80) },
      { type: 'multiselect', value: [payload, 'b'] },
      { type: 'person', value: { name: payload } },
      { type: 'currency', value: payload }
    ];
    shapes.forEach((field) => {
      const html = MatterFields.displayHtml(field);
      expect(html).not.toMatch(/<img/i);
      expect(html).toContain('&lt;img');
    });
    expect(MatterFields.displayHtml({ type: 'currency', value: 1234.5 })).toBe('$1,234.50');
    expect(MatterFields.displayHtml({ type: 'boolean', value: false })).toBe('No');
    expect(MatterFields.displayHtml({ type: 'multiselect', value: ['House', 'Car'] })).toBe('House, Car');
  });

  test('placeholderFor shows a default as a hint without making it a value', () => {
    expect(MatterFields.placeholderFor({ key: 'stage', display_name: 'Stage', default_value: 'Open' })).toBe('Default: Open');
    expect(MatterFields.placeholderFor({ key: 'stage', display_name: 'Stage', default_value: null })).toBe('Enter Stage');
  });

  test('errorMessage shows the server validation details, not only "Validation failed"', () => {
    const err = new Error('Validation failed');
    err.data = { error: { message: 'Validation failed', details: [{ path: ['field_key'], message: 'field_key must be snake_case' }] } };
    expect(MatterFields.errorMessage(err)).toBe('field_key: field_key must be snake_case');
    const plain = new Error('field_type "select" requires a non-empty options list');
    plain.data = { error: { message: plain.message } };
    expect(MatterFields.errorMessage(plain)).toBe('field_type "select" requires a non-empty options list');
  });

  test('displayFields reads the value rows for the matter dock', () => {
    expect(MatterFields.displayFields(SERVER_VALUES)).toEqual([
      { key: 'case_number', displayName: 'Case Number', value: 'A-100', type: 'text' },
      { key: 'estate_value', displayName: 'Estate Value', value: 250000, type: 'currency' }
    ]);
  });
});

describe('MatterFieldsAPIClient', () => {
  test('loadDrawer reads this matter\'s attached fields and values', async () => {
    const api = fakeApi();
    const state = await new MatterFieldsAPIClient(api).loadDrawer('MATT-1');
    expect(api.get).toHaveBeenCalledWith('/api/v1/matters/MATT-1/field-attachments');
    expect(api.get).toHaveBeenCalledWith('/api/v1/matters/MATT-1/field-values');
    expect(api.get).not.toHaveBeenCalledWith(expect.stringContaining('/matter-field-definitions'));
    expect(state.definitions.length).toBe(3);
  });

  test('a new field goes to the library, is attached here, and then gets its value', async () => {
    const api = fakeApi();
    const client = new MatterFieldsAPIClient(api);
    const base = await client.loadDrawer('MATT-1');
    const edit = MatterFields.cloneState(base);
    edit.definitions.push({ key: 'notes', display_name: 'Notes', type: 'text', required: false, options: [] });
    edit.values.push({ key: 'notes', value: 'hello' });

    await client.saveDrawer('MATT-1', base, edit);

    expect(api.post.mock.calls).toEqual([
      ['/api/v1/matter-field-definitions', { field_key: 'notes', field_label: 'Notes', field_type: 'text', is_required: false }],
      ['/api/v1/matters/MATT-1/field-attachments', { field_definition_id: 'd-new' }]
    ]);
    expect(api.put).toHaveBeenCalledWith('/api/v1/matters/MATT-1/field-values', { values: [{ field_key: 'notes', value: 'hello' }] });
    expect(api.post.mock.invocationCallOrder[1]).toBeLessThan(api.put.mock.invocationCallOrder[0]);
    [].concat(api.put.mock.calls, api.post.mock.calls).forEach((c) => expect(c[0]).not.toMatch(/\/settings/));
  });

  test('a create that conflicts (field already in the library) attaches the existing field instead', async () => {
    const conflict = Object.assign(new Error('exists'), { status: 409 });
    const api = fakeApi({
      post: jest.fn(async (path, body) => {
        if (path === '/api/v1/matter-field-definitions') throw conflict;
        return { status: 'success', data: body };
      }),
      get: jest.fn(async (path) => {
        if (path.indexOf('/field-library') !== -1) {
          return { data: { definitions: [{ id: 'd-77', field_key: 'notes_extra', attached: false }, { id: 'd-78', field_key: 'notes', attached: false }] } };
        }
        if (path.indexOf('/field-values') !== -1) return SERVER_VALUES;
        return SERVER_ATTACHED;
      })
    });
    const client = new MatterFieldsAPIClient(api);
    const base = await client.loadDrawer('MATT-1');
    const edit = MatterFields.cloneState(base);
    edit.definitions.push({ key: 'notes', display_name: 'Notes', type: 'text', required: false, options: [] });

    await client.saveDrawer('MATT-1', base, edit);

    expect(api.get).toHaveBeenCalledWith('/api/v1/matters/MATT-1/field-library?limit=200&q=notes');
    expect(api.post).toHaveBeenLastCalledWith('/api/v1/matters/MATT-1/field-attachments', { field_definition_id: 'd-78' });
  });

  test('a key held by an ARCHIVED field reports the server\'s message instead of looping', async () => {
    const conflict = Object.assign(new Error('A field with key "notes" was archived. Ask an admin to restore it, or choose a different key.'), {
      status: 409,
      data: { error: { message: 'A field with key "notes" was archived. Ask an admin to restore it, or choose a different key.' } }
    });
    const api = fakeApi({
      post: jest.fn(async () => { throw conflict; }),
      get: jest.fn(async (path) => {
        if (path.indexOf('/field-library') !== -1) return { data: { definitions: [] } }; // archived: not in the library
        if (path.indexOf('/field-values') !== -1) return SERVER_VALUES;
        return SERVER_ATTACHED;
      })
    });
    const client = new MatterFieldsAPIClient(api);
    const base = await client.loadDrawer('MATT-1');
    const edit = MatterFields.cloneState(base);
    edit.definitions.push({ key: 'notes', display_name: 'Notes', type: 'text', required: false, options: [] });

    await expect(client.saveDrawer('MATT-1', base, edit)).rejects.toMatchObject({
      userMessage: 'A field with key "notes" was archived. Ask an admin to restore it, or choose a different key.'
    });
    expect(api.post).toHaveBeenCalledTimes(1);
  });

  test('an admin edit to a picked field is PATCHed after it is attached', async () => {
    const api = fakeApi();
    const client = new MatterFieldsAPIClient(api);
    const base = await client.loadDrawer('MATT-1');
    const edit = MatterFields.addLibraryField(base, SERVER_LIBRARY.data.definitions[1]);
    edit.definitions.find((d) => d.id === 'd-9').required = true;
    await client.saveDrawer('MATT-1', base, edit);
    expect(api.post).toHaveBeenCalledWith('/api/v1/matters/MATT-1/field-attachments', { field_definition_id: 'd-9' });
    expect(api.patch).toHaveBeenCalledWith('/api/v1/matter-field-definitions/d-9', { is_required: true });
    expect(api.post.mock.invocationCallOrder[0]).toBeLessThan(api.patch.mock.invocationCallOrder[0]);
  });

  test('remove detaches from this matter only; nothing is archived', async () => {
    const api = fakeApi();
    const client = new MatterFieldsAPIClient(api);
    const base = await client.loadDrawer('MATT-1');
    const edit = MatterFields.cloneState(base);
    edit.definitions.splice(0, 1);
    await client.saveDrawer('MATT-1', base, edit);
    expect(api.delete.mock.calls).toEqual([['/api/v1/matters/MATT-1/field-attachments/d-1']]);
  });

  test('saveDrawer rejects with the server message and a fresh baseline after a partial write', async () => {
    const refusal = new Error('Validation failed');
    refusal.data = { error: { message: 'Validation failed', details: [{ path: ['values', 0, 'value'], message: 'Expected a numeric value' }] } };
    const api = fakeApi({ put: jest.fn(async () => { throw refusal; }) });
    const client = new MatterFieldsAPIClient(api);
    const base = await client.loadDrawer('MATT-1');
    const edit = MatterFields.cloneState(base);
    edit.values[2].value = 'lots';

    await expect(client.saveDrawer('MATT-1', base, edit)).rejects.toMatchObject({
      userMessage: 'values.0.value: Expected a numeric value',
      baseline: expect.objectContaining({ definitions: expect.any(Array) })
    });
  });

  test('saveDrawer refuses an invalid drawer without sending anything', async () => {
    const api = fakeApi();
    const client = new MatterFieldsAPIClient(api);
    await expect(client.saveDrawer('MATT-1', { definitions: [], values: [] }, {
      definitions: [{ key: 'x', display_name: '', type: 'text', options: [] }], values: []
    })).rejects.toMatchObject({ userMessage: 'Every field needs a display name.' });
    expect(api.post).not.toHaveBeenCalled();
    expect(api.put).not.toHaveBeenCalled();
  });
});
