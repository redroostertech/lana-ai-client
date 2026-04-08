/**
 * E2E Authentication Helper — lana-client
 *
 * Provides authentication utilities for frontend E2E tests:
 * - Login via POST /api/v1/auth/login
 * - Cache JWT token to avoid repeated logins
 * - Export helper functions for tests
 *
 * @module tests/e2e/helpers/auth-helper
 */

'use strict';

var axios = require('axios');

var API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:8080';
var TEST_USER_EMAIL = process.env.LANA_TEST_EMAIL || 'michael.westbrooks@redroostertec.com';
var TEST_USER_PASSWORD = process.env.LANA_TEST_PASSWORD || 'Test$1234567';

var cachedToken = null;
var cachedUserId = null;
var cachedOrgId = null;
var tokenExpiresAt = null;

async function login() {
  if (cachedToken && tokenExpiresAt && Date.now() < tokenExpiresAt) {
    return { token: cachedToken, userId: cachedUserId, organizationId: cachedOrgId };
  }

  var response = await axios.post(API_BASE_URL + '/api/v1/auth/login', {
    email: TEST_USER_EMAIL,
    password: TEST_USER_PASSWORD
  });

  if (!response.data.token) {
    throw new Error('Login failed: No token received');
  }

  cachedToken = response.data.token;
  cachedUserId = response.data.user.id;
  cachedOrgId = response.data.user.organizationId;
  tokenExpiresAt = Date.now() + (23 * 60 * 60 * 1000);

  return { token: cachedToken, userId: cachedUserId, organizationId: cachedOrgId };
}

async function getAuthHeaders() {
  var auth = await login();
  return { Authorization: 'Bearer ' + auth.token };
}

function clearTokenCache() {
  cachedToken = null;
  cachedUserId = null;
  cachedOrgId = null;
  tokenExpiresAt = null;
}

function getBaseUrl() {
  return API_BASE_URL;
}

module.exports = { login, getAuthHeaders, clearTokenCache, getBaseUrl };
