'use strict';

/**
 * Locates a LANA-AI checkout for the backend contract suites
 * (tests/unit/*-backend-contract.test.js) and answers errors the way the
 * backend error handler does.
 *
 * The backend is LANA_BACKEND_DIR when set (the only place looked at), else
 * the sibling worktree .runtime/lana-estate-rulebook, else a sibling LANA-AI/.
 * The first one holding every required file wins. When none does, the suite
 * is skipped with a warning saying where it looked, except in CI (CI set to
 * anything but empty, false or 0; npm run test:ci sets it):
 * there it fails loudly, so a missing backend never passes as green.
 */

const fs = require('fs');
const path = require('path');

const CLIENT_ROOT = path.resolve(__dirname, '..', '..');

/** CI is set when it holds a value other than empty, false or 0 (npm run test:ci sets it). */
function inCi() {
  const value = String(process.env.CI || '').trim().toLowerCase();
  return value !== '' && value !== 'false' && value !== '0';
}

/**
 * @param {string[]} required - backend-relative paths the suite reads
 * @returns {{ dir: string|null, path(rel): string, require(rel): any, describe: Function }}
 */
function findBackend(required) {
  const candidates = process.env.LANA_BACKEND_DIR
    ? [path.resolve(process.env.LANA_BACKEND_DIR)]
    : [path.resolve(CLIENT_ROOT, '..', 'lana-estate-rulebook'), path.resolve(CLIENT_ROOT, '..', 'LANA-AI')];
  const dir = candidates.find((candidate) => required.every((rel) => fs.existsSync(path.join(candidate, rel)))) || null;
  if (!dir) {
    console.warn('[backend contract] Skipped: no LANA-AI checkout with ' + required.join(', ') + ' at ' + candidates.join(', ')
      + '. Set LANA_BACKEND_DIR to a backend worktree to run it.');
  }
  const resolve = (relative) => path.join(dir, relative);
  const missing = (name) => {
    describe(name, () => {
      test('needs a LANA-AI checkout (set LANA_BACKEND_DIR)', () => {
        throw new Error('[backend contract] No LANA-AI checkout with ' + required.join(', ') + ' at ' + candidates.join(', ')
          + '. In CI the backend must be present: set LANA_BACKEND_DIR.');
      });
    });
  };
  let describeSuite = describe;
  if (!dir) { describeSuite = inCi() ? missing : describe.skip; }
  return {
    dir,
    path: resolve,
    require: (relative) => require(resolve(relative)),
    describe: describeSuite,
  };
}

/**
 * The api error the client's api.js would reject with for `error`, as the
 * backend error handler answers it: { status, code, data: body }.
 */
function answerOf(handler, error) {
  const res = { statusCode: 200, headersSent: false, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  handler(error, { path: '/x', method: 'POST' }, res, () => {});
  const apiError = Object.assign(new Error(res.body.error.message), { status: res.statusCode, data: res.body });
  apiError.code = res.body.error.code;
  return apiError;
}

/**
 * Keeps the backend's tracing in memory: its tracer and trace repository
 * (the seams the backend's own tracing tests mock) are replaced, so no step
 * or trace reaches chat_traces or sse_events. Call it before requiring the
 * backend code under test. With no trace in scope (these suites open none)
 * a step records nothing; `recorded` lists any step row that was written,
 * kept outside jest mocks so clearAllMocks does not empty it.
 *
 * @param {(relative: string) => string} pathOf - the checkout's path()
 * @returns {{ recorded: Array<{ traceId: string, eventType: string }> }}
 */
function hermeticTracing(pathOf) {
  const recorded = [];
  const tracer = {
    startTrace: async () => null,
    endTrace: async () => {},
    recordSSEEvent: (trace, row) => { recorded.push({ traceId: trace && trace.traceId, eventType: row && row.eventType }); },
  };
  jest.doMock(pathOf('src/shared/tracing/tracer'), () => ({ getTracer: async () => tracer }));
  jest.doMock(pathOf('src/repositories/trace.repository'), () => function TraceRepository() {});
  return { recorded };
}

module.exports = { findBackend, answerOf, hermeticTracing, inCi };
