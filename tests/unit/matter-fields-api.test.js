'use strict';

// The matter "Edit Custom Fields" drawer writes through the typed matter-field
// endpoints. PUT /matters/:id/settings refuses custom_fields and
// custom_field_definitions, so no request built here may go there.

const MatterFields = require('../../src/js/shared/matter-fields.js');
const MatterFieldsAPIClient = require('../../src/js/api/matter-fields-api.client.js');

const SERVER_DEFINITIONS = {
  status: 'success',
  data: {
    definitions: [
      { id: 'd-1', field_key: 'case_number', field_label: 'Case Number', field_type: 'text', is_required: true, options: [], default_value: null },
      { id: 'd-2', field_key: 'stage', field_label: 'Stage', field_type: 'select', is_required: false, options: ['Open', 'Closed'], default_value: null },
      { id: 'd-3', field_key: 'estate_value', field_label: 'Estate Value', field_type: 'currency', is_required: false, options: [], default_value: null }
    ],
    total: 3
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

function fakeApi(overrides = {}) {
  return {
    get: jest.fn(async (path) => (path.indexOf('/field-values') !== -1 ? SERVER_VALUES : SERVER_DEFINITIONS)),
    post: jest.fn(async (path, body) => ({ status: 'success', data: Object.assign({ id: 'd-new' }, body) })),
    patch: jest.fn(async () => ({ status: 'success', data: {} })),
    put: jest.fn(async () => ({ status: 'success', data: { values: [] } })),
    delete: jest.fn(async () => ({ status: 'success', data: {} })),
    ...overrides
  };
}

function loadedState() {
  return MatterFields.toDrawerState(SERVER_DEFINITIONS, SERVER_VALUES);
}

describe('matter-fields model', () => {
  test('maps definitions and values into the drawer state', () => {
    const state = loadedState();
    expect(state.definitions).toEqual([
      { id: 'd-1', key: 'case_number', display_name: 'Case Number', type: 'text', required: true, options: [], default_value: null },
      { id: 'd-2', key: 'stage', display_name: 'Stage', type: 'select', required: false, options: ['Open', 'Closed'], default_value: null },
      { id: 'd-3', key: 'estate_value', display_name: 'Estate Value', type: 'currency', required: false, options: [], default_value: null }
    ]);
    expect(state.values).toEqual([
      { key: 'case_number', value: 'A-100' },
      { key: 'stage', value: '' },
      { key: 'estate_value', value: 250000 }
    ]);
  });

  test('an unchanged drawer builds no requests', () => {
    const base = loadedState();
    const plan = MatterFields.planSave(base, MatterFields.cloneState(base));
    expect(plan.errors).toEqual([]);
    expect(MatterFields.buildSaveRequests('MATT-1', plan)).toEqual([]);
  });

  test('builds org-level definition writes, then one bulk value write for this matter', () => {
    const base = loadedState();
    const edit = MatterFields.cloneState(base);
    edit.definitions[0].display_name = 'Court Case Number';       // label change
    edit.definitions[1].options = ['Open', 'Pending', 'Closed'];  // option change
    edit.definitions.splice(2, 1);                                // remove estate_value
    edit.definitions.push({ key: 'filing_date', display_name: 'Filing Date', type: 'date', required: false, options: [] });
    edit.values = [
      { key: 'case_number', value: '' },          // clear
      { key: 'stage', value: 'Pending' },         // set
      { key: 'estate_value', value: 1 },          // field removed: not written
      { key: 'filing_date', value: '2026-11-01' } // value on a new field
    ];

    const plan = MatterFields.planSave(base, edit);
    expect(plan.errors).toEqual([]);
    const requests = MatterFields.buildSaveRequests('MATT-1', plan);

    expect(requests).toEqual([
      {
        method: 'POST',
        path: '/api/v1/matter-field-definitions',
        body: { field_key: 'filing_date', field_label: 'Filing Date', field_type: 'date', is_required: false }
      },
      { method: 'PATCH', path: '/api/v1/matter-field-definitions/d-1', body: { field_label: 'Court Case Number' } },
      { method: 'PATCH', path: '/api/v1/matter-field-definitions/d-2', body: { options: ['Open', 'Pending', 'Closed'] } },
      { method: 'DELETE', path: '/api/v1/matter-field-definitions/d-3' },
      {
        method: 'PUT',
        path: '/api/v1/matters/MATT-1/field-values',
        body: {
          values: [
            { field_key: 'case_number', value: null },
            { field_key: 'stage', value: 'Pending' },
            { field_key: 'filing_date', value: '2026-11-01' }
          ]
        }
      }
    ]);
    requests.forEach((r) => expect(r.path).not.toMatch(/\/settings/));
  });

  test('a choice field sends its options and a multiselect value as a list', () => {
    const base = { definitions: [], values: [] };
    const edit = {
      definitions: [{ key: 'assets', display_name: 'Assets', type: 'multiselect', required: true, options: ['House', 'Car'] }],
      values: [{ key: 'assets', value: ['Car'] }]
    };
    const requests = MatterFields.buildSaveRequests('MATT 2', MatterFields.planSave(base, edit));
    expect(requests[0].body).toEqual({
      field_key: 'assets', field_label: 'Assets', field_type: 'multiselect', is_required: true, options: ['House', 'Car']
    });
    expect(requests[1]).toEqual({
      method: 'PUT',
      path: '/api/v1/matters/MATT%202/field-values',
      body: { values: [{ field_key: 'assets', value: ['Car'] }] }
    });
  });

  test('numbers typed as text are unchanged values, booleans are values not blanks', () => {
    const base = loadedState();
    const edit = MatterFields.cloneState(base);
    edit.values[2].value = '250000';
    expect(MatterFields.buildSaveRequests('MATT-1', MatterFields.planSave(base, edit))).toEqual([]);

    const b = { definitions: [{ id: 'd-9', key: 'signed', display_name: 'Signed', type: 'boolean', required: false, options: [] }], values: [{ key: 'signed', value: '' }] };
    const e = MatterFields.cloneState(b);
    e.values[0].value = false;
    expect(MatterFields.buildSaveRequests('M', MatterFields.planSave(b, e))[0].body).toEqual({
      values: [{ field_key: 'signed', value: false }]
    });
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
  test('loadDrawer reads definitions and this matter\'s values from the typed endpoints', async () => {
    const api = fakeApi();
    const state = await new MatterFieldsAPIClient(api).loadDrawer('MATT-1');
    expect(api.get).toHaveBeenCalledWith('/api/v1/matter-field-definitions?limit=500');
    expect(api.get).toHaveBeenCalledWith('/api/v1/matters/MATT-1/field-values');
    expect(state.definitions.length).toBe(3);
  });

  test('saveDrawer sends each request in order and never the settings endpoint', async () => {
    const api = fakeApi();
    const client = new MatterFieldsAPIClient(api);
    const base = await client.loadDrawer('MATT-1');
    const edit = MatterFields.cloneState(base);
    edit.definitions.push({ key: 'notes', display_name: 'Notes', type: 'text', required: false, options: [] });
    edit.values.push({ key: 'notes', value: 'hello' });

    await client.saveDrawer('MATT-1', base, edit);

    expect(api.post).toHaveBeenCalledWith('/api/v1/matter-field-definitions',
      { field_key: 'notes', field_label: 'Notes', field_type: 'text', is_required: false });
    expect(api.put).toHaveBeenCalledWith('/api/v1/matters/MATT-1/field-values',
      { values: [{ field_key: 'notes', value: 'hello' }] });
    expect(api.post.mock.invocationCallOrder[0]).toBeLessThan(api.put.mock.invocationCallOrder[0]);
    const allPaths = [].concat(api.put.mock.calls, api.post.mock.calls).map((c) => c[0]);
    allPaths.forEach((p) => expect(p).not.toMatch(/\/settings/));
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
