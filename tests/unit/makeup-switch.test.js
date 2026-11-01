'use strict';

const S = require('../../src/js/shared/makeup-switch.js');

const view = { makeup: { key: 'standard', name: 'Standard', version: 1, latest_version: 2 }, tabs: [] };
const list = S.makeupList({
  makeups: [
    { key: 'standard', name: 'Standard', description: null, latest_version: 2, scope: 'system' },
    { key: 'probate', name: 'Probate', description: 'Court filings', latest_version: 3, scope: 'organization' },
    { name: 'no key' },
  ],
});

describe('makeup switch', () => {
  test('explains that switching hides and deletes nothing', () => {
    expect(S.EXPLANATION).toContain('Nothing is deleted');
    expect(S.EXPLANATION).toContain('hidden');
  });

  test('permission: hidden only when the server says no or there is no makeup', () => {
    expect(S.canConfigure(view)).toBe(true);
    expect(S.canConfigure({ ...view, can_configure_makeup: true })).toBe(true);
    expect(S.canConfigure({ ...view, can_configure_makeup: false })).toBe(false);
    expect(S.canConfigure(null)).toBe(false);
    expect(S.canConfigure({ tabs: [] })).toBe(false);
  });

  test('current makeup and the opt-in upgrade offer', () => {
    const current = S.currentMakeup(view);
    expect(current).toEqual({ key: 'standard', name: 'Standard', version: 1, latestVersion: 2 });
    expect(S.upgradeOffer(current)).toEqual({ version: 2, text: 'Version 2 of Standard is available. This matter uses version 1.' });
    expect(S.upgradeOffer(S.currentMakeup({ makeup: { key: 'standard', version: 2, latest_version: 2 } }))).toBeNull();
    expect(S.upgradeOffer(S.currentMakeup({ makeup: { key: 'standard', version: 2 } }))).toBeNull();
    expect(S.currentMakeup({ makeup: {} })).toBeNull();
  });

  test('list mapping reads { makeups } and drops rows without a key', () => {
    expect(list).toEqual([
      { key: 'standard', name: 'Standard', description: '', latestVersion: 2, scope: 'system' },
      { key: 'probate', name: 'Probate', description: 'Court filings', latestVersion: 3, scope: 'organization' },
    ]);
    expect(S.makeupList({ data: { makeups: [{ key: 'a' }] } })).toEqual([]);
    expect(S.makeupList(null)).toEqual([]);
    expect(S.makeupOptions(list, S.currentMakeup(view))[0]).toMatchObject({ value: 'standard', label: 'Standard (current)' });
  });

  test('plan: same makeup upgrades only when newer; another makeup switches at its latest version', () => {
    const current = S.currentMakeup(view);
    expect(S.switchPlan(current, 'standard', list)).toMatchObject({ kind: 'upgrade', makeupKey: 'standard', version: 2 });
    expect(S.switchPlan(S.currentMakeup({ makeup: { key: 'standard', name: 'Standard', version: 2, latest_version: 2 } }), 'standard', list).kind).toBe('none');
    expect(S.switchPlan(current, 'probate', list)).toEqual({ kind: 'switch', makeupKey: 'probate', version: 3, text: 'Switch this matter to Probate, version 3.' });
    expect(S.switchPlan(current, '', list).kind).toBe('none');
    expect(S.switchPlan(null, 'unknown', list)).toMatchObject({ kind: 'switch', makeupKey: 'unknown', version: null });
  });

  test('body requires a reason; control arm with a reason sends it', () => {
    const plan = S.switchPlan(S.currentMakeup(view), 'probate', list);
    expect(S.switchBody(plan, '   ')).toEqual({ ok: false, error: expect.stringContaining('reason') });
    expect(S.switchBody(plan, ' Client changed scope ')).toEqual({ ok: true, body: { makeup_key: 'probate', reason: 'Client changed scope', version: 3 } });
    expect(S.switchBody({ kind: 'switch', makeupKey: 'x', version: null }, 'why')).toEqual({ ok: true, body: { makeup_key: 'x', reason: 'why' } });
    expect(S.switchBody({ kind: 'none', text: 'Choose a makeup.' }, 'why')).toEqual({ ok: false, error: 'Choose a makeup.' });
  });

  test('switch answers: switched, upgraded, and unchanged (a resend that finished the setup) with effects', () => {
    expect(S.switchResultView({ outcome: 'switched', effects: { status: 'complete', skills_disabled: 0, starter_tasks_created: 0 } }, { kind: 'switch' }))
      .toEqual({ kind: 'success', text: 'Makeup changed, setup complete', incomplete: false });
    expect(S.switchResultView({ outcome: 'switched', effects: { status: 'complete', skills_disabled: 1, starter_tasks_created: 2 } }, { kind: 'upgrade' }).text)
      .toBe('Makeup upgraded, setup complete (1 skill turned off, 2 starter tasks added)');
    expect(S.switchResultView({ outcome: 'unchanged', effects: { status: 'complete', skills_disabled: 0, starter_tasks_created: 1 } }, { kind: 'switch' }).text)
      .toBe('The makeup setup is complete (1 starter task added)');
  });

  test('effects.status incomplete is not worded as done', () => {
    const view = S.switchResultView({ outcome: 'switched', effects: { status: 'incomplete' } }, { kind: 'switch' });
    expect(view).toMatchObject({ kind: 'warning', incomplete: true });
    expect(view.text).toContain('Finish setup');
  });

  test('409 MAKEUP_SWITCH_IN_PROGRESS is resent unchanged with a growing wait, then thrown', async () => {
    const busy = { status: 409, code: 'MAKEUP_SWITCH_IN_PROGRESS', data: { error: { code: 'MAKEUP_SWITCH_IN_PROGRESS', retryable: true } } };
    const waits = [];
    const wait = async (ms) => { waits.push(ms); };
    const body = { makeup_key: 'probate', reason: 'why', version: 3 };

    const send = jest.fn().mockRejectedValueOnce(busy).mockRejectedValueOnce(busy).mockResolvedValueOnce({ outcome: 'switched' });
    await expect(S.sendSwitch(send, body, { delays: [10, 20, 40], wait })).resolves.toEqual({ outcome: 'switched' });
    expect(send).toHaveBeenCalledTimes(3);
    send.mock.calls.forEach((call) => expect(call[0]).toBe(body));
    expect(waits).toEqual([10, 20]);

    waits.length = 0;
    const always = jest.fn().mockRejectedValue(busy);
    await expect(S.sendSwitch(always, body, { delays: [10, 20], wait })).rejects.toBe(busy);
    expect(always).toHaveBeenCalledTimes(3);
    expect(waits).toEqual([10, 20]);
    expect(S.needsFinish(busy)).toBe(true);
    expect(S.switchErrorMessage(busy)).toContain('Finish setup');

    // Control arm: a refusal that is not retryable is thrown at once.
    const refused = { status: 403, code: 'MAKEUP_CONFIGURE_FORBIDDEN', data: { error: { code: 'MAKEUP_CONFIGURE_FORBIDDEN' } } };
    const once = jest.fn().mockRejectedValue(refused);
    await expect(S.sendSwitch(once, body, { delays: [10], wait })).rejects.toBe(refused);
    expect(once).toHaveBeenCalledTimes(1);
    expect(S.needsFinish(refused)).toBe(false);
    // The 409 is recognized by its retryable mark or its code.
    expect(S.isInProgress({ status: 409, data: { error: { retryable: true } } })).toBe(true);
    expect(S.isInProgress({ status: 409, code: 'MAKEUP_SWITCH_IN_PROGRESS' })).toBe(true);
    expect(S.isInProgress({ status: 409, code: 'OTHER' })).toBe(false);
    expect(S.isInProgress(new Error('offline'))).toBe(false);
  });

  test('errors', () => {
    const incomplete = { status: 503, code: 'MAKEUP_SWITCH_INCOMPLETE' };
    expect(S.isIncomplete(incomplete)).toBe(true);
    expect(S.isIncomplete({ status: 503, data: { error: { code: 'MAKEUP_SWITCH_INCOMPLETE' } } })).toBe(true);
    // Control arms: another 503 is not a recorded switch.
    expect(S.isIncomplete({ status: 503, code: 'MAKEUPS_NOT_SEEDED' })).toBe(false);
    expect(S.switchErrorMessage(incomplete)).toContain('Finish setup');
    expect(S.switchErrorMessage({ status: 403, code: 'MAKEUP_CONFIGURE_FORBIDDEN' })).toContain('permission');
    expect(S.switchErrorMessage({ status: 404 })).toContain('not available');
    expect(S.switchErrorMessage({ status: 400, message: 'Unknown makeup version' })).toBe('Unknown makeup version');
    expect(S.switchErrorMessage({ status: 503, code: 'MAKEUPS_NOT_SEEDED' })).toContain('Try again');
    expect(S.switchErrorMessage({ status: 500 })).toContain('Try again');
  });
});
