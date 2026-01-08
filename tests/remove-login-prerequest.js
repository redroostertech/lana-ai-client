#!/usr/bin/env node

/**
 * Remove the pre-request script from Login that's causing issues
 */

const fs = require('fs');
const path = require('path');

const COLLECTION_PATH = path.join(__dirname, '..', 'postman', 'LANA-AI-API.postman_collection.json');

// Read collection
const collection = JSON.parse(fs.readFileSync(COLLECTION_PATH, 'utf8'));

// Find Login request
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

if (loginRequest && loginRequest.event) {
  // Remove pre-request script, keep only test script
  loginRequest.event = loginRequest.event.filter(e => e.listen !== 'prerequest');
  console.log('✓ Removed pre-request script from Login');
}

// Write updated collection
fs.writeFileSync(COLLECTION_PATH, JSON.stringify(collection, null, 2), 'utf8');

console.log('✓ Collection updated!');
