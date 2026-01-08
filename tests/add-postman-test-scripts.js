#!/usr/bin/env node

/**
 * Add test scripts to Postman collection
 * This adds automatic token/variable extraction from responses
 */

const fs = require('fs');
const path = require('path');

const COLLECTION_PATH = path.join(__dirname, '..', 'postman', 'LANA-AI-API.postman_collection.json');

// Test script for Login request - saves token and user_id
const loginTestScript = `
// Test that login was successful
pm.test("Login successful", function () {
    pm.response.to.have.status(200);
});

// Save token to collection variable if login succeeded
if (pm.response.code === 200) {
    const jsonData = pm.response.json();

    if (jsonData.token) {
        pm.collectionVariables.set("token", jsonData.token);
        console.log("✓ Token saved to collection variables");
    }

    if (jsonData.user && jsonData.user.id) {
        pm.collectionVariables.set("user_id", jsonData.user.id);
        console.log("✓ User ID saved to collection variables:", jsonData.user.id);
    }

    if (jsonData.session && jsonData.session.id) {
        pm.collectionVariables.set("session_id", jsonData.session.id);
        console.log("✓ Session ID saved to collection variables");
    }
}
`.trim();

// Pre-request script for Login - uses environment variables if available
const loginPreRequestScript = `
// Use test credentials from environment if available
const testEmail = pm.environment.get("test_email") || pm.collectionVariables.get("test_email");
const testPassword = pm.environment.get("test_password") || pm.collectionVariables.get("test_password");

if (testEmail && testPassword) {
    const requestBody = JSON.parse(pm.request.body.raw);
    requestBody.email = testEmail;
    requestBody.password = testPassword;
    pm.request.body.raw = JSON.stringify(requestBody);
    console.log("Using test credentials for", testEmail);
}
`.trim();

// Test script for Create Matter - saves matter_id
const createMatterTestScript = `
if (pm.response.code === 201 || pm.response.code === 200) {
    const jsonData = pm.response.json();

    if (jsonData.matter && jsonData.matter.id) {
        pm.collectionVariables.set("matter_id", jsonData.matter.id);
        console.log("✓ Matter ID saved:", jsonData.matter.id);
    } else if (jsonData.id) {
        pm.collectionVariables.set("matter_id", jsonData.id);
        console.log("✓ Matter ID saved:", jsonData.id);
    }
}
`.trim();

function findRequestByPath(items, pathSegments) {
  if (!items || !Array.isArray(items)) return null;

  for (const item of items) {
    // Check if this is the request we're looking for
    if (item.name === pathSegments[0]) {
      if (pathSegments.length === 1 && item.request) {
        return item;
      }
      if (pathSegments.length > 1 && item.item) {
        return findRequestByPath(item.item, pathSegments.slice(1));
      }
    }
  }
  return null;
}

// Read collection
console.log('Reading Postman collection...');
const collection = JSON.parse(fs.readFileSync(COLLECTION_PATH, 'utf8'));

// Add test script to Login request
console.log('Adding test scripts to Login request...');
const loginRequest = findRequestByPath(collection.item, ['1. Authentication & Sessions', 'Authentication', 'Login']);
if (loginRequest && loginRequest.event) {
  loginRequest.event = [];
}
if (loginRequest) {
  if (!loginRequest.event) {
    loginRequest.event = [];
  }

  // Add test script
  loginRequest.event.push({
    listen: 'test',
    script: {
      type: 'text/javascript',
      exec: loginTestScript.split('\n')
    }
  });

  // Add pre-request script
  loginRequest.event.push({
    listen: 'prerequest',
    script: {
      type: 'text/javascript',
      exec: loginPreRequestScript.split('\n')
    }
  });

  console.log('✓ Login request updated');
} else {
  console.log('⚠ Login request not found');
}

// Add test script to Create Matter request
console.log('Adding test scripts to Create Matter request...');
const createMatterRequest = findRequestByPath(collection.item, ['2. Matters Management', 'Matter Operations', 'Create Matter']);
if (createMatterRequest) {
  if (!createMatterRequest.event) {
    createMatterRequest.event = [];
  }

  createMatterRequest.event.push({
    listen: 'test',
    script: {
      type: 'text/javascript',
      exec: createMatterTestScript.split('\n')
    }
  });

  console.log('✓ Create Matter request updated');
}

// Add test email/password to collection variables
if (!collection.variable) {
  collection.variable = [];
}

// Add test_email and test_password variables
const testEmailVar = collection.variable.find(v => v.key === 'test_email');
if (!testEmailVar) {
  collection.variable.push({
    key: 'test_email',
    value: 'user@example.com',
    type: 'string'
  });
}

const testPasswordVar = collection.variable.find(v => v.key === 'test_password');
if (!testPasswordVar) {
  collection.variable.push({
    key: 'test_password',
    value: 'password123',
    type: 'string'
  });
}

// Write updated collection
console.log('Writing updated collection...');
fs.writeFileSync(COLLECTION_PATH, JSON.stringify(collection, null, 2), 'utf8');

console.log('✓ Postman collection updated successfully!');
console.log('');
console.log('Test scripts added:');
console.log('  • Login → Saves token, user_id, session_id');
console.log('  • Create Matter → Saves matter_id');
