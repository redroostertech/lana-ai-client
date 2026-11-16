const fs = require('fs');
const path = require('path');

const { requestedSubject } = require(path.join(__dirname, '../../src/js/shared/live-poller.js'));
const { createRunDetailRequests } = require(path.join(__dirname, '../../src/automation/js/shared/run-detail-requests.js'));

// The automation app's run detail wiring (app.js openRunDetail,
// loadRunDetail, openLinkedRun), now one module app.js builds once.
function setup(fetchDetail) {
  const subject = requestedSubject();
  const applied = [];
  const calls = [];
  const requests = createRunDetailRequests({
    subject,
    fetchDetail: (id) => { calls.push(['fetch', id, subject.current()]); return fetchDetail(id); },
    apply: (id, payload) => applied.push([id, payload])
  });
  return { subject, applied, calls, requests };
}

describe('automation run detail requests', () => {
  test('openRunDetail records the run before it fetches, then applies it', async () => {
    const { applied, calls, requests } = setup(async (id) => `detail-${id}`);
    await requests.openRunDetail('B');
    // At fetch time the requested run was already B.
    expect(calls).toEqual([['fetch', 'B', 'B']]);
    expect(applied).toEqual([['B', 'detail-B']]);
  });

  test('loadRunDetail skips a run that was not requested: no fetch, nothing applied', async () => {
    const { subject, applied, calls, requests } = setup(async (id) => `detail-${id}`);
    subject.request('B');
    await requests.loadRunDetail('A');
    expect(calls).toEqual([]);
    expect(applied).toEqual([]);
    // control: the requested run is read and applied
    await requests.loadRunDetail('B');
    expect(applied).toEqual([['B', 'detail-B']]);
  });

  test('a linked run that cannot be opened is forgotten, like every other close', async () => {
    const { subject, requests } = setup(async () => { throw new Error('404'); });
    subject.request('A');
    expect(await requests.openLinkedRun('A')).toEqual({ ok: false });
    expect(subject.current()).toBeNull();
    // control: a linked run that opens stays requested
    const ok = setup(async (id) => `detail-${id}`);
    ok.subject.request('A');
    expect(await ok.requests.openLinkedRun('A')).toEqual({ ok: true });
    expect(ok.subject.isRequested('A')).toBe(true);
  });

  test('app.js routes its run detail reads through this module', () => {
    const source = fs.readFileSync(path.join(__dirname, '../../src/automation/app.js'), 'utf8');
    expect(source).toMatch(/createRunDetailRequests\(/);
    expect(source).not.toMatch(/fetchJson\(`\/api\/executions\/\$\{executionId\}`/);
  });
});
