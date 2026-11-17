'use strict';

/**
 * DataState.fromApiError: the one reader of the data state a failed API
 * call carries. A 400 invalid_request carries it in error.details; other
 * failures carry it on the body. Anything else is not a data state.
 */

const fs = require('fs');
const path = require('path');

const win = {};
new Function('window', fs.readFileSync(path.join(__dirname, '../../src/js/shared/data-state.js'), 'utf8'))(win);
const { fromApiError } = win.DataState;

const state = { data_state: 'invalid_request', data_state_reason: 'Pick a smaller window.' };

test('a 400 carries its data state in error.details', () => {
  expect(fromApiError({ status: 400, data: { success: false, error: { code: 'INVALID', details: state } } })).toEqual(state);
});

test('a body with a data state is the data state', () => {
  const body = { success: false, data_state: 'timeout', data_state_reason: 'Took too long.' };
  expect(fromApiError({ status: 504, data: body })).toBe(body);
});

test('details on the body are read too', () => {
  expect(fromApiError({ data: { details: state } })).toEqual(state);
});

test('an error with no data state is null', () => {
  expect(fromApiError(new Error('Network down'))).toBeNull();
  expect(fromApiError({ data: { error: { details: { data_state: 'ok' } } } })).toBeNull();
  expect(fromApiError(null)).toBeNull();
});
