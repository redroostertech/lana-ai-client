/**
 * One admin rule for metric goals: the client holds no role list. Lex.Auth
 * asks the backend (GET /api/v1/modules/metric-goals/permission), which
 * answers with the same rule requireAdminRole enforces on the goal writes.
 * Until it answers, and on any failure, the Goal actions stay hidden.
 */

const fs = require('fs');
const path = require('path');

const SOURCE = fs.readFileSync(path.join(__dirname, '../../src/js/lex/lex.auth.js'), 'utf8');

function loadAuth(user, get) {
  const window = {};
  const api = { user, get: get || jest.fn() };
  new Function('window', 'api', SOURCE)(window, api);
  return { auth: window.Lex.Auth, api };
}

test('the backend answer decides, for any role name', async () => {
  for (const [role, allowed] of [['organization_admin', true], ['org_admin', false]]) {
    const { auth, api } = loadAuth({ id: 'u-1', roles: [role] }, jest.fn(async () => ({ can_edit_goals: allowed })));
    expect(auth.canEditMetricGoals()).toBe(false);
    await expect(auth.loadMetricGoalPermission()).resolves.toBe(allowed);
    expect(auth.canEditMetricGoals()).toBe(allowed);
    expect(api.get).toHaveBeenCalledWith('/api/v1/modules/metric-goals/permission');
  }
});

test('the client keeps no role list of its own', () => {
  expect(SOURCE).not.toMatch(/GOAL_ADMIN_ROLES|'super_admin'/);
});

test('a failed check or no signed-in user hides the Goal actions', async () => {
  const failed = loadAuth({ id: 'u-1' }, jest.fn(async () => { throw new Error('offline'); })).auth;
  await expect(failed.loadMetricGoalPermission()).resolves.toBe(false);
  expect(failed.canEditMetricGoals()).toBe(false);
  const signedOut = loadAuth(null).auth;
  await expect(signedOut.loadMetricGoalPermission()).resolves.toBe(false);
  expect(signedOut.canEditMetricGoals()).toBe(false);
});

test('the answer is asked once per signed-in person', async () => {
  const get = jest.fn(async () => ({ data: { can_edit_goals: true } }));
  const { auth, api } = loadAuth({ id: 'u-1' }, get);
  await auth.loadMetricGoalPermission();
  await auth.loadMetricGoalPermission();
  expect(get).toHaveBeenCalledTimes(1);
  expect(auth.canEditMetricGoals()).toBe(true);
  api.user = { id: 'u-2' };
  expect(auth.canEditMetricGoals()).toBe(false);
});
