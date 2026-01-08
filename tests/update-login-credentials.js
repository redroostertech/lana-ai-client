#!/usr/bin/env node

/**
 * Update Login request to use test credentials from environment
 */

const fs = require('fs');
const path = require('path');

const COLLECTION_PATH = path.join(__dirname, '..', 'postman', 'LANA-AI-API.postman_collection.json');
const ENV_FILE = path.join(__dirname, '.env.test');

// Read test credentials from .env.test
let testEmail = 'user@example.com';
let testPassword = 'password123';

if (fs.existsSync(ENV_FILE)) {
  const envContent = fs.readFileSync(ENV_FILE, 'utf8');
  const emailMatch = envContent.match(/TEST_USER_EMAIL=(.+)/);
  const passwordMatch = envContent.match(/TEST_USER_PASSWORD='?([^'\n]+)'?/);

  if (emailMatch) testEmail = emailMatch[1].trim();
  if (passwordMatch) testPassword = passwordMatch[1].trim().replace(/^'|'$/g, '');
}

console.log('Test credentials:', testEmail);

// Read collection
const collection = JSON.parse(fs.readFileSync(COLLECTION_PATH, 'utf8'));

// Find and update Login request
function findRequestByPath(items, pathSegments) {
  if (!items || !Array.isArray(items)) return null;

  for (const item of items) {
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

const loginRequest = findRequestByPath(collection.item, ['1. Authentication & Sessions', 'Authentication', 'Login']);

if (loginRequest && loginRequest.request && loginRequest.request.body) {
  // Update the request body with actual test credentials
  const bodyData = {
    email: testEmail,
    password: testPassword
  };

  loginRequest.request.body.raw = JSON.stringify(bodyData, null, 2);
  console.log('✓ Login request body updated with test credentials');
} else {
  console.log('⚠ Login request not found or has no body');
}

// Write updated collection
fs.writeFileSync(COLLECTION_PATH, JSON.stringify(collection, null, 2), 'utf8');

console.log('✓ Collection updated successfully!');
