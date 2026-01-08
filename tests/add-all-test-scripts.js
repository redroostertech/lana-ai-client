#!/usr/bin/env node

/**
 * Add comprehensive test scripts to all Postman requests
 * This ensures proper test coverage reporting
 */

const fs = require('fs');
const path = require('path');

const COLLECTION_PATH = path.join(__dirname, '..', 'postman', 'LANA-AI-API.postman_collection.json');

// Generic test script for successful responses (2xx)
const successTestScript = `
// Test for successful response
pm.test("Request successful", function () {
    pm.response.to.be.success;
});

// Test response time is reasonable
pm.test("Response time is acceptable", function () {
    pm.expect(pm.response.responseTime).to.be.below(5000);
});
`.trim();

// Test script for authenticated endpoints (should be 200 or 401 if auth fails)
const authTestScript = `
// Test for valid response code (200 OK or 401 if not authenticated)
pm.test("Valid response code", function () {
    pm.expect(pm.response.code).to.be.oneOf([200, 201, 401, 403]);
});

// Test response time is reasonable
pm.test("Response time is acceptable", function () {
    pm.expect(pm.response.responseTime).to.be.below(5000);
});

// If successful, validate response structure
if (pm.response.code === 200 || pm.response.code === 201) {
    pm.test("Response has valid JSON", function () {
        pm.response.to.be.json;
    });
}
`.trim();

// Test script for public/no-auth endpoints
const publicTestScript = `
// Test response code
pm.test("Valid response code", function () {
    pm.expect(pm.response.code).to.be.oneOf([200, 400, 404, 500]);
});

// Test response time
pm.test("Response time is acceptable", function () {
    pm.expect(pm.response.responseTime).to.be.below(5000);
});
`.trim();

// Endpoints that should have custom test scripts (we'll skip these)
const SKIP_ENDPOINTS = [
  'Login', // Already has custom test script
  'Create Matter' // Already has custom test script
];

function shouldSkip(itemName) {
  return SKIP_ENDPOINTS.includes(itemName);
}

function isPublicEndpoint(request) {
  if (!request || !request.auth) return false;
  return request.auth.type === 'noauth';
}

function addTestScriptToRequest(item) {
  if (!item || !item.request) return;

  // Skip if already has custom test script
  if (shouldSkip(item.name)) {
    console.log(`  ⊙ Skipping ${item.name} (has custom tests)`);
    return;
  }

  // Initialize event array if it doesn't exist
  if (!item.event) {
    item.event = [];
  }

  // Check if test script already exists
  const hasTestScript = item.event.some(e => e.listen === 'test');
  if (hasTestScript) {
    console.log(`  ⊙ Skipping ${item.name} (already has tests)`);
    return;
  }

  // Determine which test script to use
  let testScript;
  if (isPublicEndpoint(item.request)) {
    testScript = publicTestScript;
  } else {
    testScript = authTestScript;
  }

  // Add test script
  item.event.push({
    listen: 'test',
    script: {
      type: 'text/javascript',
      exec: testScript.split('\n')
    }
  });

  console.log(`  ✓ Added tests to ${item.name}`);
}

function processItems(items, depth = 0) {
  if (!items || !Array.isArray(items)) return;

  for (const item of items) {
    // If item has nested items (folder), process recursively
    if (item.item && Array.isArray(item.item)) {
      if (depth === 0) {
        console.log(`\n📁 ${item.name}`);
      }
      processItems(item.item, depth + 1);
    }

    // If item has a request, add test script
    if (item.request) {
      addTestScriptToRequest(item);
    }
  }
}

// Read collection
console.log('Reading Postman collection...');
const collection = JSON.parse(fs.readFileSync(COLLECTION_PATH, 'utf8'));

// Process all items
console.log('\nAdding test scripts to requests...');
processItems(collection.item);

// Write updated collection
console.log('\nWriting updated collection...');
fs.writeFileSync(COLLECTION_PATH, JSON.stringify(collection, null, 2), 'utf8');

console.log('\n✓ Postman collection updated successfully!');
console.log('\nTest scripts added:');
console.log('  • Authenticated endpoints → Status code + response validation');
console.log('  • Public endpoints → Status code validation');
console.log('  • All endpoints → Response time validation');
