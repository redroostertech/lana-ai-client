#!/usr/bin/env node

/**
 * Fix collection variables with proper test credentials
 */

const fs = require('fs');
const path = require('path');

const COLLECTION_PATH = path.join(__dirname, '..', 'postman', 'LANA-AI-API.postman_collection.json');
const ENV_FILE = path.join(__dirname, '.env.test');

// Read test credentials from .env.test
let testEmail = 'michael.westbrooks@redroostertec.com';
let testPassword = 'Test$1234567';

if (fs.existsSync(ENV_FILE)) {
  const envContent = fs.readFileSync(ENV_FILE, 'utf8');
  const emailMatch = envContent.match(/TEST_USER_EMAIL=(.+)/);
  const passwordMatch = envContent.match(/TEST_USER_PASSWORD='([^']+)'/);

  if (emailMatch) testEmail = emailMatch[1].trim();
  if (passwordMatch) testPassword = passwordMatch[1];
}

console.log('Test credentials:');
console.log('  Email:', testEmail);
console.log('  Password:', testPassword.substring(0, 4) + '***');

// Read collection
const collection = JSON.parse(fs.readFileSync(COLLECTION_PATH, 'utf8'));

// Ensure collection variables exist
if (!collection.variable) {
  collection.variable = [];
}

// Update or add test_email
let emailVar = collection.variable.find(v => v.key === 'test_email');
if (emailVar) {
  emailVar.value = testEmail;
} else {
  collection.variable.push({
    key: 'test_email',
    value: testEmail,
    type: 'string'
  });
}

// Update or add test_password
let passwordVar = collection.variable.find(v => v.key === 'test_password');
if (passwordVar) {
  passwordVar.value = testPassword;
} else {
  collection.variable.push({
    key: 'test_password',
    value: testPassword,
    type: 'string'
  });
}

// Write updated collection
fs.writeFileSync(COLLECTION_PATH, JSON.stringify(collection, null, 2), 'utf8');

console.log('\n✓ Collection variables updated');
console.log('\nVariables in collection:');
collection.variable.forEach(v => {
  if (v.key === 'test_password') {
    console.log(`  ${v.key}: ${v.value.substring(0, 4)}***`);
  } else {
    console.log(`  ${v.key}: ${v.value || '(empty)'}`);
  }
});
