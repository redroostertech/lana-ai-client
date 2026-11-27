'use strict';

/**
 * Fix data in LANA (js/shared/data-fixes.js): fixes stay in LANA, the CRM
 * keeps its value, and syncs never undo a fix. Controls show only when the
 * signed-in person may correct (permissions.can_correct) and the row says
 * it is editable; conflict actions need permissions.can_resolve_conflicts.
 * Everything is driven by the row's hints (edit, outcome_edit, conflict),
 * never by the card key.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

const SRC = path.join(__dirname, '..', '..', 'src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');
const F = require(path.join(SRC, 'js/shared/data-fixes.js'));
const settle = async () => { for (let i = 0; i < 6; i += 1) await new Promise((r) => setImmediate(r)); };

const missingAmount = {
  record_id: 'cd-1', client_name: 'Jordan Smith', refs: [{ object: 'deal', id: 'cd-1' }],
  edit: { record_id: 'cd-1', field_key: 'monetaryValue', standard_key: 'amount', current_value: null, editable: true },
  outcome_edit: { status: 'open', decided_on: null, allowed: ['won', 'lost'] },
};
const conflicted = {
  record_id: 'cd-2', client_name: 'Casey Lee', source_name: 'ActionStep',
  conflict: { flag_annotation_id: 'f-9', detected_at: '2026-11-21T10:00:00Z', fields: [{ field_key: 'monetaryValue', standard_key: 'amount', lana_value: 4500, previous_source_value: 4500, new_source_value: 3000 }] },
};
const can = { can_correct: true, can_resolve_conflicts: true };

describe('who sees which controls', () => {
  test('amount and outcome: permission AND an editable row', () => {
    expect(F.canCorrect(can, missingAmount.edit)).toBe(true);
    expect(F.canCorrect({ can_correct: false }, missingAmount.edit)).toBe(false);
    expect(F.canCorrect(can, Object.assign({}, missingAmount.edit, { editable: false }))).toBe(false);
    expect(F.canCorrect(null, missingAmount.edit)).toBe(false);
  });
  test('conflict actions need can_resolve_conflicts', () => {
    expect(F.canResolve(can, conflicted.conflict)).toBe(true);
    expect(F.canResolve({ can_correct: true }, conflicted.conflict)).toBe(false);
    expect(F.canResolve(can, null)).toBe(false);
  });
});

describe('request bodies', () => {
  test('an amount fix uses the standard key and a number', () => {
    expect(F.amountBody(missingAmount.edit, '4,500')).toEqual({ fields: [{ standard_key: 'amount', value: 4500 }] });
    expect(F.amountBody({ field_key: 'monetaryValue' }, '10')).toEqual({ fields: [{ field_key: 'monetaryValue', value: 10 }] });
    expect(F.amountBody(missingAmount.edit, 'abc')).toBe(null);
    expect(F.amountBody(missingAmount.edit, '-5')).toBe(null);
  });
  test('won or lost with a day goes in one POST with outcome', () => {
    expect(F.outcomeBody(missingAmount.outcome_edit, 'won', '2026-11-20')).toEqual({ fields: [], outcome: { status: 'won', decided_on: '2026-11-20' } });
    expect(F.outcomeBody(missingAmount.outcome_edit, 'won', '')).toBe(null);
    expect(F.outcomeBody(missingAmount.outcome_edit, 'maybe', '2026-11-20')).toBe(null);
  });
  test('a 400 lists the allowed values in plain words', () => {
    expect(F.errorText({ status: 400, data: { error: { details: { allowed: ['won', 'lost'] } } } })).toBe('That value is not allowed. Allowed values: won, lost.');
    expect(F.errorText({ status: 400, data: { allowed_values: ['USD'] } })).toBe('That value is not allowed. Allowed values: USD.');
    expect(F.errorText({ status: 403 })).toBe('You don\'t have permission to fix this record.');
    expect(F.errorText({ status: 500 })).toBe('Could not save. Try again in a moment.');
  });
});

describe('after a save', () => {
  test('the row updates in place from the record the server returns', () => {
    const row = JSON.parse(JSON.stringify(missingAmount));
    F.applyRecord(row, { record_id: 'cd-1', object: 'deal', amount: 4500, status: 'won', won_on: '2026-11-20', corrected_fields: ['amount'], conflict_fields: [] });
    expect(row).toMatchObject({ amount: 4500, status: 'won', won_on: '2026-11-20', fixed_in_lana: { fields: ['amount'] } });
    expect(row.edit.current_value).toBe(4500);
    expect(row.conflict).toBeUndefined();
  });
  test('the refetch waits expected_within_seconds', () => {
    expect(F.refreshDelayMs({ refresh: { queued: true, expected_within_seconds: 4 } })).toBe(4000);
    expect(F.refreshDelayMs({})).toBe(5000);
  });
  test('conflict actions name the source', () => {
    expect(F.conflictLabels(conflicted)).toEqual({ keep: 'Keep LANA\'s value', use: 'Use ActionStep\'s value' });
    expect(F.conflictLabels({ conflict: {} })).toEqual({ keep: 'Keep LANA\'s value', use: 'Use the source\'s value' });
  });
});

describe('controls in the page', () => {
  function boot(api, confirmAnswer = true) {
    const dom = new JSDOM('<!doctype html><body><div id="host"></div></body>', { runScripts: 'outside-only' });
    const w = dom.window;
    w.api = api;
    w.Lex = { Modal: { confirmAsync: jest.fn(() => Promise.resolve(confirmAnswer)) } };
    w.eval(read('js/shared/data-fixes.js'));
    return w;
  }
  const saved = { record: { record_id: 'cd-1', amount: 4500, corrected_fields: ['amount'], conflict_fields: [] }, refresh: { queued: true, expected_within_seconds: 3 } };

  test('nothing renders without permission or an editable row', () => {
    expect(F.controlsHtml(missingAmount, { can_correct: false })).toBe('');
    expect(F.controlsHtml(Object.assign({}, missingAmount, { edit: Object.assign({}, missingAmount.edit, { editable: false }), outcome_edit: null }), can)).toBe('');
  });

  test('inline amount: Save posts the fix, shows "Saved. Updating...", and reports the record', async () => {
    const api = { createCorrection: jest.fn(() => Promise.resolve({ data: saved })) };
    const w = boot(api);
    const host = w.document.getElementById('host');
    host.innerHTML = F.controlsHtml(missingAmount, can);
    const onSaved = jest.fn();
    w.DataFixes.bind(host, { onSaved });
    host.querySelector('[data-dfix-input="amount"]').value = '4500';
    host.querySelector('[data-dfix-action="amount"]').click();
    await settle();
    expect(api.createCorrection).toHaveBeenCalledWith('cd-1', { fields: [{ standard_key: 'amount', value: 4500 }] });
    expect(host.querySelector('[data-dfix-status]').textContent).toBe('Saved. Updating...');
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ dataId: 'cd-1', record: saved.record, delayMs: 3000 }));
  });

  test('Mark as won needs a day, then sends one POST with the outcome', async () => {
    const api = { createCorrection: jest.fn(() => Promise.resolve({ data: saved })) };
    const w = boot(api);
    const host = w.document.getElementById('host');
    host.innerHTML = F.controlsHtml(missingAmount, can);
    w.DataFixes.bind(host, {});
    host.querySelector('[data-dfix-action="won"]').click();
    await settle();
    expect(api.createCorrection).not.toHaveBeenCalled();
    expect(host.querySelector('[data-dfix-status]').textContent).toBe('Pick the day it was decided.');
    host.querySelector('[data-dfix-input="decided_on"]').value = '2026-11-20';
    host.querySelector('[data-dfix-action="won"]').click();
    await settle();
    expect(api.createCorrection).toHaveBeenCalledWith('cd-1', { fields: [], outcome: { status: 'won', decided_on: '2026-11-20' } });
  });

  test('a 400 shows the allowed values', async () => {
    const api = { createCorrection: jest.fn(() => Promise.reject(Object.assign(new Error('x'), { status: 400, data: { error: { details: { allowed: ['won', 'lost'] } } } }))) };
    const w = boot(api);
    const host = w.document.getElementById('host');
    host.innerHTML = F.controlsHtml(missingAmount, can);
    w.DataFixes.bind(host, {});
    host.querySelector('[data-dfix-input="amount"]').value = '10';
    host.querySelector('[data-dfix-action="amount"]').click();
    await settle();
    expect(host.querySelector('[data-dfix-status]').textContent).toBe('That value is not allowed. Allowed values: won, lost.');
  });

  test('a conflict shows both values; using the source asks first, keeping LANA does not', async () => {
    const api = { resolveConflict: jest.fn(() => Promise.resolve({ data: saved })) };
    const w = boot(api, false);
    const host = w.document.getElementById('host');
    host.innerHTML = F.controlsHtml(conflicted, can);
    expect(host.textContent).toContain('Amount: LANA $4,500, ActionStep $3,000');
    w.DataFixes.bind(host, {});
    host.querySelector('[data-dfix-action="use-source"]').click();
    await settle();
    expect(w.Lex.Modal.confirmAsync).toHaveBeenCalled();
    expect(api.resolveConflict).not.toHaveBeenCalled();
    host.querySelector('[data-dfix-action="keep-lana"]').click();
    await settle();
    expect(api.resolveConflict).toHaveBeenCalledWith('cd-2', 'f-9', 'lana');
  });

  test('a fix already in LANA can be changed (PUT) or undone (DELETE, after confirming)', async () => {
    const row = Object.assign({}, missingAmount, { fixed_in_lana: { fields: ['amount'], annotation_id: 'a-5' } });
    const api = { updateCorrection: jest.fn(() => Promise.resolve({ data: saved })), deleteCorrection: jest.fn(() => Promise.resolve({ data: saved })) };
    const w = boot(api, true);
    const host = w.document.getElementById('host');
    host.innerHTML = F.controlsHtml(row, can);
    w.DataFixes.bind(host, {});
    host.querySelector('[data-dfix-input="amount"]').value = '5000';
    host.querySelector('[data-dfix-action="amount"]').click();
    await settle();
    expect(api.updateCorrection).toHaveBeenCalledWith('cd-1', 'a-5', { fields: [{ standard_key: 'amount', value: 5000 }] });
    host.querySelector('[data-dfix-action="undo"]').click();
    await settle();
    expect(w.Lex.Modal.confirmAsync).toHaveBeenCalled();
    expect(api.deleteCorrection).toHaveBeenCalledWith('cd-1', 'a-5');
  });
});

test('api.js methods for corrections and conflicts', async () => {
  const context = { console, URLSearchParams, AbortController, FormData: class {}, setTimeout, clearTimeout, setInterval, clearInterval, fetch: jest.fn(),
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, document: { addEventListener() {}, body: {}, getElementById: () => null },
    location: { protocol: 'http:', origin: 'http://client.test', pathname: '/app.html' }, LanaConfig: {},
    LanaTime: { nowMs: () => 1000, millisecondsSince: () => 0, MS_PER_MINUTE: 60000 } };
  context.window = context;
  context.globalThis = context;
  vm.runInNewContext(read('js/api.js'), context);
  const api = context.window.api;
  api.post = jest.fn().mockResolvedValue({});
  api.put = jest.fn().mockResolvedValue({});
  api.delete = jest.fn().mockResolvedValue({});
  await api.createCorrection('cd 1', { fields: [] });
  expect(api.post).toHaveBeenCalledWith('/api/v1/connected-data/cd%201/corrections', { fields: [] });
  await api.updateCorrection('cd-1', 'a-5', { fields: [] });
  expect(api.put).toHaveBeenCalledWith('/api/v1/connected-data/cd-1/corrections/a-5', { fields: [] });
  await api.deleteCorrection('cd-1', 'a-5');
  expect(api.delete).toHaveBeenCalledWith('/api/v1/connected-data/cd-1/corrections/a-5');
  await api.resolveConflict('cd-1', 'f-9', 'source');
  expect(api.post).toHaveBeenLastCalledWith('/api/v1/connected-data/cd-1/conflicts/f-9/resolve', { keep: 'source' });
});
