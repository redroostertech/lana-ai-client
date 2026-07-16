'use strict';

/** Native desktop operations are separate from MCP capabilities. Each route
 * and method is fixed in source control; renderer input cannot select either. */
const NATIVE_OPERATIONS = Object.freeze({
  'auth.login': Object.freeze({ method: 'POST', path: () => '/api/v1/auth/login', authenticated: false }),
  'auth.refresh': Object.freeze({ method: 'GET', path: () => '/api/v1/auth/refresh', authenticated: true }),
  'auth.logout': Object.freeze({ method: 'POST', path: () => '/api/v1/auth/logout', authenticated: true }),
  'auth.current': Object.freeze({ method: 'GET', path: () => '/api/v1/auth/me', authenticated: true }),
  'profile.get': Object.freeze({ method: 'GET', path: () => '/api/v1/profile', authenticated: true })
});

function getNativeOperation(operationId) {
  if (!Object.prototype.hasOwnProperty.call(NATIVE_OPERATIONS, operationId)) {
    const error = new Error('Native desktop operation is not available');
    error.code = 'OPERATION_UNAVAILABLE';
    throw error;
  }
  return NATIVE_OPERATIONS[operationId];
}

module.exports = { NATIVE_OPERATIONS, getNativeOperation };
