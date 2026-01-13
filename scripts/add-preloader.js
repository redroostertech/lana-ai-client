#!/usr/bin/env node
/**
 * Add Preloader to All HTML Files
 *
 * This script adds the LanaAI preloader to all HTML files that don't have it yet.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Preloader CSS to add to <head>
const PRELOADER_CSS = `
  <!-- Inline preloader styles - Pure CSS, no dependencies -->
  <style>
    /* Preloader shown immediately, before any JS/CSS loads */
    #lana-preloader {
      position: fixed;
      inset: 0;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      z-index: 99999;
      transition: opacity 0.3s ease-out;
    }

    .preloader-logo {
      width: 80px;
      height: 80px;
      margin-bottom: 24px;
      animation: pulse 2s ease-in-out infinite;
    }

    .preloader-spinner {
      width: 48px;
      height: 48px;
      border: 4px solid rgba(255, 255, 255, 0.3);
      border-top-color: white;
      border-radius: 50%;
      animation: spin 1s linear infinite;
      margin-bottom: 16px;
    }

    .preloader-text {
      color: white;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 16px;
      font-weight: 500;
      letter-spacing: 0.5px;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.85; transform: scale(0.96); }
    }
  </style>
`;

// Preloader HTML to add after <body>
const PRELOADER_HTML = `
  <!-- Pure HTML/CSS Preloader - Shows immediately, hidden by JS when ready -->
  <div id="lana-preloader">
    <svg class="preloader-logo" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="50" cy="50" r="45" fill="white" opacity="0.15"/>
      <circle cx="50" cy="50" r="35" fill="white" opacity="0.3"/>
      <circle cx="50" cy="50" r="25" fill="white"/>
      <text x="50" y="58" font-family="Arial, sans-serif" font-size="28" font-weight="bold" fill="#667eea" text-anchor="middle">L</text>
    </svg>
    <div class="preloader-spinner"></div>
    <div class="preloader-text">Loading LanaAI...</div>
  </div>

`;

function findHTMLFiles(dir) {
  const files = [];

  function walk(directory) {
    const entries = fs.readdirSync(directory, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.html')) {
        files.push(fullPath);
      }
    }
  }

  walk(dir);
  return files;
}

function hasPreloader(content) {
  return content.includes('lana-preloader') || content.includes('id="lana-preloader"');
}

function addPreloader(filePath) {
  try {
    let content = fs.readFileSync(filePath, 'utf8');

    // Check if already has preloader
    if (hasPreloader(content)) {
      console.log(`  ⏭️  Skipped (already has preloader): ${path.relative(process.cwd(), filePath)}`);
      return false;
    }

    // Add CSS before </head>
    if (content.includes('</head>')) {
      content = content.replace('</head>', `${PRELOADER_CSS}\n</head>`);
    } else {
      console.log(`  ⚠️  Warning: No </head> tag found: ${path.relative(process.cwd(), filePath)}`);
      return false;
    }

    // Add HTML after <body> tag
    const bodyMatch = content.match(/<body[^>]*>/);
    if (bodyMatch) {
      const bodyTag = bodyMatch[0];
      content = content.replace(bodyTag, `${bodyTag}${PRELOADER_HTML}`);
    } else {
      console.log(`  ⚠️  Warning: No <body> tag found: ${path.relative(process.cwd(), filePath)}`);
      return false;
    }

    // Find the main content div/container and wrap it with id="app-content" if not already wrapped
    // Look for common patterns but don't break existing structure
    if (!content.includes('id="app-content"') && !content.includes("id='app-content'")) {
      // Try to find main content container after preloader
      // This is tricky - we'll add a comment suggesting manual wrapping
      const insertPoint = content.indexOf('</div>', content.indexOf('lana-preloader') + 100);
      if (insertPoint > -1) {
        content = content.slice(0, insertPoint + 6) +
                  '\n\n  <!-- TODO: Wrap main page content with <div id="app-content"> for FOUC prevention -->\n' +
                  content.slice(insertPoint + 6);
      }
    }

    // Write back
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`  ✅ Added preloader: ${path.relative(process.cwd(), filePath)}`);
    return true;

  } catch (error) {
    console.error(`  ❌ Error processing ${filePath}:`, error.message);
    return false;
  }
}

// Main execution
console.log('🔄 Adding preloader to all HTML files...\n');

const srcDir = path.join(__dirname, '../src');
const publicHtmlDir = path.join(__dirname, '../public_html');

const htmlFiles = [
  ...findHTMLFiles(srcDir),
  ...findHTMLFiles(publicHtmlDir)
];

console.log(`Found ${htmlFiles.length} HTML files\n`);

let addedCount = 0;
let skippedCount = 0;

for (const file of htmlFiles) {
  const result = addPreloader(file);
  if (result) {
    addedCount++;
  } else if (hasPreloader(fs.readFileSync(file, 'utf8'))) {
    skippedCount++;
  }
}

console.log(`\n✅ Complete!`);
console.log(`   Added: ${addedCount}`);
console.log(`   Skipped: ${skippedCount}`);
console.log(`   Total: ${htmlFiles.length}`);
console.log(`\n⚠️  Note: You may need to manually wrap page content with <div id="app-content"> in some files.`);
