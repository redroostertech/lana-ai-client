'use strict';

const Client = require('../../src/js/api/matter-makeup-api.client.js');

function api() {
  return {
    get: jest.fn(async () => ({})), post: jest.fn(async () => ({})),
    put: jest.fn(async () => ({})), patch: jest.fn(async () => ({})),
  };
}

describe('MatterMakeupAPIClient', () => {
  test('request paths and bodies follow the design contract', () => {
    const r = Client.requests;
    expect(r.makeup('M/1')).toEqual({ method: 'GET', path: '/api/v1/matters/M%2F1/makeup' });
    expect(r.tab('M-1', 'assets', 'c 2')).toEqual({ method: 'GET', path: '/api/v1/matters/M-1/tabs/assets?cursor=c%202' });
    expect(r.tab('M-1', 'assets')).toEqual({ method: 'GET', path: '/api/v1/matters/M-1/tabs/assets' });
    expect(r.form('M-1', 'provider.decide', 'record:1').path).toBe('/api/v1/matters/M-1/forms/provider.decide?subject=record%3A1');
    expect(r.submitForm('M-1', 'provider.decide', { request_id: 'r' })).toEqual({ method: 'POST', path: '/api/v1/matters/M-1/forms/provider.decide', body: { request_id: 'r' } });
  });

  test('task action requests: start carries a request id, forms use the action form route', () => {
    const r = Client.requests;
    expect(r.startTaskAction('t1', 'a1', 'req-1')).toEqual({ method: 'POST', path: '/api/v1/tasks/t1/actions/a1/start', body: { request_id: 'req-1' } });
    expect(() => r.startTaskAction('t1', 'a1')).toThrow('request id');
    expect(r.taskActionForm('t1', 'a1')).toEqual({ method: 'GET', path: '/api/v1/tasks/t1/actions/a1/form' });
    expect(r.submitTaskActionForm('t1', 'a1', { request_id: 'r', values: {} })).toEqual({ method: 'POST', path: '/api/v1/tasks/t1/actions/a1/form', body: { request_id: 'r', values: {} } });
  });

  test('sends through the shared api instance', async () => {
    const transport = api();
    const client = new Client(transport);
    await client.startTaskAction('t1', 'a1', 'req-1');
    expect(transport.post).toHaveBeenCalledWith('/api/v1/tasks/t1/actions/a1/start', { request_id: 'req-1' });
    await client.getTab('M-1', 'assets');
    expect(transport.get).toHaveBeenCalledWith('/api/v1/matters/M-1/tabs/assets');
  });

  test('getMakeup: the view model; null only when the makeup is genuinely unavailable (404, network); anything else rejects', async () => {
    const transport = api();
    const client = new Client(transport);
    const model = { makeup: { key: 'standard' }, tabs: [{ id: 'notes', kind: 'notes', available: true }] };
    transport.get.mockResolvedValueOnce(model);
    await expect(client.getMakeup('M-1')).resolves.toBe(model);

    transport.get.mockRejectedValueOnce(Object.assign(new Error('Not found'), { status: 404 }));
    await expect(client.getMakeup('M-1')).resolves.toBeNull();
    // api.js reports a network failure as status 0.
    transport.get.mockRejectedValueOnce(Object.assign(new Error('Network error occurred'), { status: 0 }));
    await expect(client.getMakeup('M-1')).resolves.toBeNull();

    // Control arms: a server error, a refusal, an unseeded server and a malformed answer are errors, never the standard tabs.
    for (const status of [500, 503, 403, 401]) {
      transport.get.mockRejectedValueOnce(Object.assign(new Error('boom'), { status }));
      await expect(client.getMakeup('M-1')).rejects.toMatchObject({ status });
    }
    transport.get.mockResolvedValueOnce({ unexpected: true });
    await expect(client.getMakeup('M-1')).rejects.toThrow('without tabs');
    expect(Client.isUnavailable({ status: 408 })).toBe(false);
  });

  test('tabPage: content, unavailable with the reason, or built in', () => {
    const tab = { id: 'assets', kind: 'records', label: 'Assets', available: true };
    expect(Client.tabPage({ tab, available: true, rows: [{ id: 'r1' }], next_cursor: null }))
      .toEqual({ state: 'content', content: { rows: [{ id: 'r1' }], next_cursor: null } });
    expect(Client.tabPage({ tab: { ...tab, available: false, reason: 'Off' }, available: false, reason: 'Off' }))
      .toEqual({ state: 'unavailable', reason: 'Off' });
    expect(Client.tabPage({ tab, available: true, built_in: true })).toEqual({ state: 'built_in' });
  });

  test('makeup switch, readiness, runs and causation requests', () => {
    const r = Client.requests;
    expect(r.listMakeups()).toEqual({ method: 'GET', path: '/api/v1/matter-makeups' });
    expect(r.switchMakeup('M-1', { makeup_key: 'standard', version: 2, reason: 'Upgrade' })).toEqual({
      method: 'PUT', path: '/api/v1/matters/M-1/makeup', body: { makeup_key: 'standard', version: 2, reason: 'Upgrade' },
    });
    expect(() => r.switchMakeup('M-1', { makeup_key: 'standard' })).toThrow('reason');
    expect(r.readiness('M-1', 'agent:matter-review')).toEqual({ method: 'GET', path: '/api/v1/matters/M-1/makeup/readiness?runnable=agent%3Amatter-review' });
    expect(r.runs('M-1')).toEqual({ method: 'GET', path: '/api/v1/matters/M-1/activity/runs' });
    expect(r.runs('M-1', 'c2').path).toBe('/api/v1/matters/M-1/activity/runs?cursor=c2');
    expect(r.causation('agent_run', 'r/1')).toEqual({ method: 'GET', path: '/api/v1/runs/agent_run/r%2F1/causation' });
  });

  test('agent start uses the agents app start path with matter scope', () => {
    const r = Client.requests;
    expect(r.startAgent('matter-review', 'uuid-1', { title: 'Matter review', definitionId: 'd1' })).toEqual({
      method: 'POST', path: '/api/v1/agents/matter-review/runs',
      body: { input: {}, title: 'Matter review', scope: 'workspace', matter_id: 'uuid-1', definition_id: 'd1' },
    });
    expect(r.startAgent('a', 'uuid-1').body).toEqual({ input: {}, title: '', scope: 'workspace', matter_id: 'uuid-1' });
    expect(() => r.startAgent('a', '')).toThrow('matter');
  });

  test('skill toggle: PATCH toggle, and the first enable creates the binding after a 404', async () => {
    const r = Client.requests;
    expect(r.toggleSkill('M-1', 'auto-1', true)).toEqual({ method: 'PATCH', path: '/api/v1/matters/M-1/automations/auto-1/toggle', body: { is_enabled: true } });
    expect(r.enableSkill('M-1', 'auto-1')).toEqual({ method: 'POST', path: '/api/v1/matters/M-1/automations', body: { automation_id: 'auto-1' } });

    const transport = api();
    const client = new Client(transport);
    await client.setSkillEnabled('M-1', 'auto-1', false);
    expect(transport.patch).toHaveBeenCalledWith('/api/v1/matters/M-1/automations/auto-1/toggle', { is_enabled: false });
    expect(transport.post).not.toHaveBeenCalled();

    transport.patch.mockRejectedValueOnce(Object.assign(new Error('Not found'), { status: 404 }));
    await client.setSkillEnabled('M-1', 'auto-1', true);
    expect(transport.post).toHaveBeenCalledWith('/api/v1/matters/M-1/automations', { automation_id: 'auto-1' });

    // Turning off a skill with no binding, or any other failure, is not retried as a create.
    transport.post.mockClear();
    transport.patch.mockRejectedValueOnce(Object.assign(new Error('Not found'), { status: 404 }));
    await expect(client.setSkillEnabled('M-1', 'auto-1', false)).rejects.toMatchObject({ status: 404 });
    transport.patch.mockRejectedValueOnce(Object.assign(new Error('Forbidden'), { status: 403 }));
    await expect(client.setSkillEnabled('M-1', 'auto-1', true)).rejects.toMatchObject({ status: 403 });
    expect(transport.post).not.toHaveBeenCalled();
  });

  test('switch sends PUT through the shared api instance', async () => {
    const transport = api();
    const client = new Client(transport);
    await client.switchMakeup('M-1', { makeup_key: 'probate', reason: 'Scope' });
    expect(transport.put).toHaveBeenCalledWith('/api/v1/matters/M-1/makeup', { makeup_key: 'probate', reason: 'Scope' });
  });
});
