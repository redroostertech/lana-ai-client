/**
 * Regression: opening a workspace failed and bounced the user back to the list.
 *
 * loadMatterDetails fans out ten parallel requests while the sidebar polls its
 * own task list. That burst trips the server's limiter:
 *
 *   429 {"error":{"message":"Too many requests. Please try again in 10 seconds.",
 *                 "code":"RATE_LIMIT_EXCEEDED"}}
 *
 * Nothing in the client handled 429, and the caller treated any failure of the
 * first request as fatal — Lex.Nav.go('workspaces.html') — so a temporary
 * throttle threw the user out of the workspace they had just opened.
 */
const fs = require('fs');
const path = require('path');

const retry = require(path.join(__dirname, '../../src/js/shared/request-retry.js'));

/** Build an ApiError-shaped rejection like api.request throws. */
function apiError(message, status, data) {
  const err = new Error(message);
  err.status = status;
  err.data = data || null;
  err.code = (data && (data.code || (data.error && data.error.code))) || null;
  return err;
}

// The exact payload observed in the renderer console.
const RATE_LIMITED = apiError('Too many requests. Please try again in 10 seconds.', 429, {
  error: { message: 'Too many requests. Please try again in 10 seconds.', code: 'RATE_LIMIT_EXCEEDED' }
});

describe('isRateLimited', () => {
  test('detects the live 429 payload', () => {
    expect(retry.isRateLimited(RATE_LIMITED)).toBe(true);
  });

  test('detects by status alone when the body is missing', () => {
    expect(retry.isRateLimited(apiError('', 429, null))).toBe(true);
  });

  test('detects by code when the status is absent', () => {
    expect(retry.isRateLimited(apiError('nope', null, { error: { code: 'RATE_LIMIT_EXCEEDED' } }))).toBe(true);
  });

  test('does not fire on unrelated failures', () => {
    expect(retry.isRateLimited(apiError('Permission required: dashboard:read', 403, null))).toBe(false);
    expect(retry.isRateLimited(apiError('Not found', 404, null))).toBe(false);
    expect(retry.isRateLimited(null)).toBe(false);
  });
});

describe('isAccessDenied', () => {
  // Both shapes observed on matter-scoped routes for MATT-00042.
  const ENVELOPE = apiError('You do not have access to this matter', 403, {
    error: { message: 'You do not have access to this matter', code: 'AUTHORIZATION_ERROR' }
  });
  const BARE = apiError('Access denied to matter', 403, {
    success: false, message: 'Access denied to matter'
  });

  test('detects both 403 body shapes', () => {
    expect(retry.isAccessDenied(ENVELOPE)).toBe(true);
    expect(retry.isAccessDenied(BARE)).toBe(true);
  });

  test('detects the permission-middleware wording', () => {
    expect(retry.isAccessDenied(apiError('Permission required: dashboard:read', 403, null))).toBe(true);
  });

  test('is never confused with a throttle or a missing record', () => {
    expect(retry.isAccessDenied(RATE_LIMITED)).toBe(false);
    expect(retry.isAccessDenied(apiError('Not found', 404, null))).toBe(false);
    expect(retry.isAccessDenied(null)).toBe(false);
  });

  test('access denial is not transient, so it is never retried', () => {
    expect(retry.isTransient(ENVELOPE)).toBe(false);
    expect(retry.shouldRetry(ENVELOPE, 0)).toBe(false);
  });
});

describe('isTransient', () => {
  test.each([429, 500, 502, 503, 504, 408, 0])('status %s is transient', (status) => {
    expect(retry.isTransient(apiError('boom', status, null))).toBe(true);
  });

  test.each([400, 401, 403, 404, 409, 422])('status %s is NOT transient', (status) => {
    // These must still route the user away — a 404 workspace really is gone.
    expect(retry.isTransient(apiError('nope', status, null))).toBe(false);
  });

  test('a null error is not transient', () => {
    expect(retry.isTransient(null)).toBe(false);
    expect(retry.isTransient(undefined)).toBe(false);
  });
});

describe('parseRetryDelayMs', () => {
  function headers(map) {
    return { get: (name) => (map[name] !== undefined ? map[name] : null) };
  }

  test('prefers Retry-After in seconds', () => {
    expect(retry.parseRetryDelayMs(headers({ 'Retry-After': '3' }), null)).toBe(3000);
  });

  test('falls back to the seconds hint in the message', () => {
    // This API sends no Retry-After, so the message is the only source.
    expect(retry.parseRetryDelayMs(null, RATE_LIMITED.data)).toBe(10000);
  });

  test('reads the hint from a bare message body', () => {
    expect(retry.parseRetryDelayMs(null, { message: 'Try again in 4 seconds' })).toBe(4000);
  });

  test('clamps an absurd delay to the ceiling', () => {
    expect(retry.parseRetryDelayMs(headers({ 'Retry-After': '9999' }), null)).toBe(retry.MAX_DELAY_MS);
  });

  test('defaults when there is no hint anywhere', () => {
    expect(retry.parseRetryDelayMs(null, null)).toBe(retry.DEFAULT_DELAY_MS);
    expect(retry.parseRetryDelayMs(headers({}), {})).toBe(retry.DEFAULT_DELAY_MS);
  });

  test('survives a header accessor that throws', () => {
    const hostile = { get: () => { throw new Error('detached'); } };
    expect(() => retry.parseRetryDelayMs(hostile, null)).not.toThrow();
    expect(retry.parseRetryDelayMs(hostile, null)).toBe(retry.DEFAULT_DELAY_MS);
  });

  test('ignores a non-numeric, non-date Retry-After', () => {
    expect(retry.parseRetryDelayMs(headers({ 'Retry-After': 'soon' }), null)).toBe(retry.DEFAULT_DELAY_MS);
  });
});

describe('jitter', () => {
  test('spreads retries around the base delay', () => {
    // randomValue is injectable so this is deterministic.
    expect(retry.jitter(1000, 0.5)).toBe(1000); // midpoint = no shift
    expect(retry.jitter(1000, 0)).toBeLessThan(1000);
    expect(retry.jitter(1000, 0.999)).toBeGreaterThan(1000);
  });

  test('stays within the jitter band and never goes negative', () => {
    for (let r = 0; r <= 1; r += 0.05) {
      const value = retry.jitter(1000, r);
      expect(value).toBeGreaterThanOrEqual(750);
      expect(value).toBeLessThanOrEqual(1250);
    }
    expect(retry.jitter(0, 0)).toBe(0);
  });
});

describe('shouldRetry', () => {
  test('retries a rate limit up to the cap, then stops', () => {
    expect(retry.shouldRetry(RATE_LIMITED, 0)).toBe(true);
    expect(retry.shouldRetry(RATE_LIMITED, retry.MAX_ATTEMPTS - 1)).toBe(true);
    expect(retry.shouldRetry(RATE_LIMITED, retry.MAX_ATTEMPTS)).toBe(false);
  });

  test('never retries a permission or not-found error', () => {
    expect(retry.shouldRetry(apiError('Permission required', 403, null), 0)).toBe(false);
    expect(retry.shouldRetry(apiError('Not found', 404, null), 0)).toBe(false);
  });
});

describe('api.request wires the retry at the chokepoint', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../src/js/api.js'), 'utf8');

  test('retries a 429 and passes the attempt count forward', () => {
    expect(source).toContain('response.status === 429');
    expect(source).toContain('retryPolicy.shouldRetry');
    expect(source).toContain('__rateLimitAttempt: attempt');
  });

  test('uses the server hint and jitters it', () => {
    expect(source).toContain('retryPolicy.jitter(retryPolicy.parseRetryDelayMs(response.headers, result))');
  });

  test('degrades safely when the module is absent', () => {
    // Guarded so a page that does not load request-retry.js keeps working.
    expect(source).toContain("(typeof RequestRetry !== 'undefined') ? RequestRetry : null");
  });
});

describe('access denied shows a blocking dialog, not a silent bounce', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../src/js/workspace-details.js'), 'utf8');
  const modalFn = source.slice(
    source.indexOf('function showAccessDeniedModal'),
    source.indexOf('async function loadMatterDetails')
  );

  test('a 403 routes to the dialog instead of Lex.Nav.go', () => {
    expect(source).toContain('RequestRetry.isAccessDenied(loadError)');
    expect(source).toContain('showAccessDeniedModal(matterId)');
  });

  test('the only action is a CTA back to the list', () => {
    expect(modalFn).toContain("modal.confirmText = 'Back to Workspaces'");
    // Falsy cancelText is what suppresses the cancel button in lex-modal.
    expect(modalFn).toContain("modal.cancelText = ''");
  });

  test('every exit path lands on the list, so it cannot be dismissed in place', () => {
    // lex-modal always renders the X and always binds ESC, so confirm/cancel/
    // close must all be wired to the same destination.
    expect(modalFn).toContain("['lex-confirm', 'lex-cancel', 'lex-close']");
    expect(modalFn).toContain('modal.closeOnOverlay = false');
    expect(modalFn).toContain("Lex.Nav.go(LIST_PAGE)");
  });

  test('falls back to the list if the modal component is unavailable', () => {
    expect(modalFn).toMatch(/if \(!window\.Lex \|\| !Lex\.Modal/);
  });

  test('escapes the matter id it renders', () => {
    expect(modalFn).toContain('escapeHtml(idLabel)');
    expect(modalFn).not.toContain("+ idLabel +");
  });
});

describe('workspace open no longer bounces on a transient failure', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../src/js/workspace-details.js'), 'utf8');

  test('keeps the user on the page when the failure is transient', () => {
    expect(source).toContain('RequestRetry.isTransient(loadError)');
    const guard = source.slice(source.indexOf('RequestRetry.isTransient(loadError)'));
    const bounce = guard.indexOf("Lex.Nav.go('workspaces.html')");
    const earlyReturn = guard.indexOf('return;');
    // The early return must come before the redirect.
    expect(earlyReturn).toBeGreaterThan(-1);
    expect(earlyReturn).toBeLessThan(bounce);
  });

  test('still redirects on a genuine failure', () => {
    expect(source).toContain("Lex.Nav.go('workspaces.html')");
  });

  test('captures the rejection reason instead of discarding it', () => {
    expect(source).toContain("results[0].status === 'rejected' ? results[0].reason : null");
  });
});

describe('every page that loads api.js also loads the retry policy first', () => {
  const srcDir = path.join(__dirname, '../../src');

  function htmlFiles(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return htmlFiles(full);
      return entry.name.endsWith('.html') ? [full] : [];
    });
  }

  const pages = htmlFiles(srcDir).filter((file) =>
    /<script src="[^"]*js\/api\.js"><\/script>/.test(fs.readFileSync(file, 'utf8'))
  );

  test('there are pages to check', () => {
    expect(pages.length).toBeGreaterThan(0);
  });

  test.each(pages.map((p) => path.relative(srcDir, p)))(
    '%s loads request-retry.js before api.js',
    (relative) => {
      const text = fs.readFileSync(path.join(srcDir, relative), 'utf8');
      const retryAt = text.indexOf('shared/request-retry.js');
      const apiAt = text.search(/<script src="[^"]*js\/api\.js"><\/script>/);

      expect(retryAt).toBeGreaterThan(-1);
      expect(retryAt).toBeLessThan(apiAt);
    }
  );
});
