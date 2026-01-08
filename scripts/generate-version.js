#!/usr/bin/env node
/**
 * Version Generation Script
 *
 * Reads version info from package.json and generates:
 * 1. public_html/js/version.js - Frontend version constant
 * 2. src/version.js - Backend version constant
 * 3. .env updates - Environment variable
 *
 * Usage: node scripts/generate-version.js
 */

const fs = require('fs');
const path = require('path');

// Read package.json
const packagePath = path.join(__dirname, '..', 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));

// Extract version info
const version = packageJson.version;
const buildNumber = packageJson.buildNumber || '0';
const releaseType = packageJson.releaseType || 'stable';

// Generate display version
// Examples: v3.0.0, v3.0.0b1, v3.0.0-rc1, v3.0.0-dev
let displayVersion = `${version}`;

if (releaseType && releaseType !== 'stable') {
  const suffix = {
    'beta': 'b',
    'alpha': 'a',
    'rc': 'rc',
    'dev': 'dev',
    'pre-release': 'pre'
  }[releaseType.toLowerCase()] || releaseType;

  displayVersion += `${suffix}${buildNumber}`;
}

// Generate timestamp
const buildDate = new Date().toISOString();

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('📦 LANA AI Version Generator');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`Version:      ${version}`);
console.log(`Build:        ${buildNumber}`);
console.log(`Release Type: ${releaseType}`);
console.log(`Display:      ${displayVersion}`);
console.log(`Build Date:   ${buildDate}`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

// 1. Generate Frontend Version File (public_html/js/version.js)
const frontendVersionContent = `/**
 * LANA AI Version Information
 *
 * AUTO-GENERATED - DO NOT EDIT MANUALLY
 * Generated: ${buildDate}
 *
 * To update version:
 * 1. Edit package.json (version, buildNumber, releaseType)
 * 2. Run: npm run generate-version
 */

window.APP_VERSION = {
  version: '${version}',
  buildNumber: '${buildNumber}',
  releaseType: '${releaseType}',
  displayVersion: '${displayVersion}',
  buildDate: '${buildDate}',

  /**
   * Get full version string
   * @returns {string} e.g., "v3.0.0b1"
   */
  getVersion() {
    return this.displayVersion;
  },

  /**
   * Get detailed version string
   * @returns {string} e.g., "v3.0.0b1 (Build 1, Beta)"
   */
  getDetailedVersion() {
    const type = this.releaseType.charAt(0).toUpperCase() + this.releaseType.slice(1);
    return \`\${this.displayVersion} (Build \${this.buildNumber}, \${type})\`;
  },

  /**
   * Get semantic version (for comparisons)
   * @returns {string} e.g., "3.0.0"
   */
  getSemanticVersion() {
    return this.version;
  }
};

// Also export for module usage
if (typeof module !== 'undefined' && module.exports) {
  module.exports = window.APP_VERSION;
}
`;

const frontendPath = path.join(__dirname, '..', 'public_html', 'js', 'version.js');
fs.writeFileSync(frontendPath, frontendVersionContent);
console.log('✅ Generated: public_html/js/version.js');

// 2. Generate Backend Version File (src/version.js)
const backendVersionContent = `/**
 * LANA AI Version Information
 *
 * AUTO-GENERATED - DO NOT EDIT MANUALLY
 * Generated: ${buildDate}
 *
 * To update version:
 * 1. Edit package.json (version, buildNumber, releaseType)
 * 2. Run: npm run generate-version
 */

module.exports = {
  version: '${version}',
  buildNumber: '${buildNumber}',
  releaseType: '${releaseType}',
  displayVersion: '${displayVersion}',
  buildDate: '${buildDate}',

  /**
   * Get full version string
   * @returns {string} e.g., "v3.0.0b1"
   */
  getVersion() {
    return this.displayVersion;
  },

  /**
   * Get detailed version string
   * @returns {string} e.g., "v3.0.0b1 (Build 1, Beta)"
   */
  getDetailedVersion() {
    const type = this.releaseType.charAt(0).toUpperCase() + this.releaseType.slice(1);
    return \`\${this.displayVersion} (Build \${this.buildNumber}, \${type})\`;
  },

  /**
   * Get semantic version (for comparisons)
   * @returns {string} e.g., "3.0.0"
   */
  getSemanticVersion() {
    return this.version;
  }
};
`;

const backendPath = path.join(__dirname, '..', 'src', 'version.js');
fs.writeFileSync(backendPath, backendVersionContent);
console.log('✅ Generated: src/version.js');

// 3. Copy to src directory as well (for imports)
const srcVersionPath = path.join(__dirname, '..', 'src', 'version.js');
fs.writeFileSync(srcVersionPath, backendVersionContent);
console.log('✅ Generated: src/version.js');

// 4. Update .env file (or create if doesn't exist)
const envPath = path.join(__dirname, '..', '.env');
let envContent = '';

if (fs.existsSync(envPath)) {
  envContent = fs.readFileSync(envPath, 'utf8');

  // Remove existing version lines
  envContent = envContent
    .split('\n')
    .filter(line => !line.startsWith('APP_VERSION=') &&
                    !line.startsWith('APP_BUILD_NUMBER=') &&
                    !line.startsWith('APP_RELEASE_TYPE=') &&
                    !line.startsWith('APP_DISPLAY_VERSION='))
    .join('\n');
}

// Add version info at the top
const versionEnv = `# Version Information (Auto-generated by scripts/generate-version.js)
APP_VERSION=${version}
APP_BUILD_NUMBER=${buildNumber}
APP_RELEASE_TYPE=${releaseType}
APP_DISPLAY_VERSION=${displayVersion}
APP_BUILD_DATE=${buildDate}

`;

envContent = versionEnv + envContent.trim() + '\n';
fs.writeFileSync(envPath, envContent);
console.log('✅ Updated: .env');

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('✨ Version files generated successfully!');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
console.log('Next steps:');
console.log('1. Restart your application');
console.log('2. Version will appear as:', displayVersion);
console.log('3. Check menu footer, login pages, about dialog\n');
