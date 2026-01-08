#!/usr/bin/env node

/**
 * Update Postman collection to properly use authentication
 * This script ensures all requests inherit bearer token auth from collection level
 */

const fs = require('fs');
const path = require('path');

const COLLECTION_PATH = path.join(__dirname, '..', 'postman', 'LANA-AI-API.postman_collection.json');

// Endpoints that should NOT require authentication
const NO_AUTH_ENDPOINTS = [
  '/api/v1/auth/login',
  '/api/v1/auth/request-password-reset',
  '/api/v1/auth/reset-password',
  '/api/v1/auth/activate',
  '/api/v1/session/create-anonymous',
  '/health'
];

// Endpoints that should validate tokens but not require full auth
const PUBLIC_ENDPOINTS = [
  '/api/v1/auth/service/validate',
  '/api/v1/storage/shared/'
];

function shouldUseAuth(url) {
  if (!url || !url.path) return true;

  const urlPath = '/' + url.path.join('/');

  // Check if it's a no-auth endpoint
  for (const endpoint of NO_AUTH_ENDPOINTS) {
    if (urlPath.includes(endpoint)) {
      return false;
    }
  }

  return true;
}

function processRequest(request) {
  if (!request || !request.url) return;

  const needsAuth = shouldUseAuth(request.url);

  if (needsAuth) {
    // Set to inherit from collection-level auth
    request.auth = {
      type: 'bearer',
      bearer: [
        {
          key: 'token',
          value: '{{token}}',
          type: 'string'
        }
      ]
    };
  } else {
    // Explicitly set to no auth for login/public endpoints
    request.auth = {
      type: 'noauth'
    };
  }
}

function processItems(items) {
  if (!items || !Array.isArray(items)) return;

  for (const item of items) {
    // If item has nested items (folder), process recursively
    if (item.item && Array.isArray(item.item)) {
      processItems(item.item);
    }

    // If item has a request, process it
    if (item.request) {
      processRequest(item.request);
    }
  }
}

// Read collection
console.log('Reading Postman collection...');
const collection = JSON.parse(fs.readFileSync(COLLECTION_PATH, 'utf8'));

// Update requests
console.log('Updating authentication settings...');
processItems(collection.item);

// Ensure collection-level auth is set
collection.auth = {
  type: 'bearer',
  bearer: [
    {
      key: 'token',
      value: '{{token}}',
      type: 'string'
    }
  ]
};

// Ensure token variable exists
if (!collection.variable) {
  collection.variable = [];
}

const tokenVar = collection.variable.find(v => v.key === 'token');
if (!tokenVar) {
  collection.variable.push({
    key: 'token',
    value: '',
    type: 'string'
  });
}

// Write updated collection
console.log('Writing updated collection...');
fs.writeFileSync(COLLECTION_PATH, JSON.stringify(collection, null, 2), 'utf8');

console.log('✓ Postman collection updated successfully!');
console.log('');
console.log('Authentication configured for:');
console.log('  • All authenticated endpoints → Bearer {{token}}');
console.log('  • Login/public endpoints → No auth');
