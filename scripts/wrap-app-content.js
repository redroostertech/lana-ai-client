#!/usr/bin/env node
/**
 * Wrap Page Content with #app-content
 *
 * This script wraps the main page content with <div id="app-content">
 * for FOUC prevention, but only for files that have the preloader.
 */

const fs = require('fs');
const path = require('path');

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

function wrapContent(filePath) {
  try {
    let content = fs.readFileSync(filePath, 'utf8');

    // Check if has preloader but not app-content wrapper
    const hasPreloader = content.includes('id="lana-preloader"');

    if (!hasPreloader) {
      return false; // Skip files without preloader
    }

    // Remove HTML comments from content before checking for wrapper
    const contentWithoutComments = content.replace(/<!--[\s\S]*?-->/g, '');

    // Check for actual div with id="app-content", not in comments
    const hasWrapper = /<div[^>]+id=["']app-content["'][^>]*>/.test(contentWithoutComments);

    if (hasWrapper) {
      console.log(`  ⏭️  Skipped (already wrapped): ${path.relative(process.cwd(), filePath)}`);
      return false;
    }

    // Find where preloader ends (after its closing </div>)
    const preloaderMatch = content.match(/<div id="lana-preloader">[\s\S]*?<\/div>/);
    if (!preloaderMatch) {
      console.log(`  ⚠️  Warning: Could not find preloader closing tag: ${path.relative(process.cwd(), filePath)}`);
      return false;
    }

    const preloaderEnd = content.indexOf('</div>', preloaderMatch.index + preloaderMatch[0].length - 10);

    // Find the next significant content after preloader (skip whitespace and comments)
    let contentStartIndex = preloaderEnd + 6; // After </div>

    // Skip whitespace, newlines, and HTML comments
    while (contentStartIndex < content.length) {
      const char = content[contentStartIndex];
      if (char === ' ' || char === '\n' || char === '\r' || char === '\t') {
        contentStartIndex++;
        continue;
      }
      if (content.substr(contentStartIndex, 4) === '<!--') {
        const commentEnd = content.indexOf('-->', contentStartIndex);
        if (commentEnd > -1) {
          contentStartIndex = commentEnd + 3;
          continue;
        }
      }
      break;
    }

    // Find </body> tag
    const bodyEndMatch = content.match(/<\/body>/i);
    if (!bodyEndMatch) {
      console.log(`  ⚠️  Warning: No </body> tag found: ${path.relative(process.cwd(), filePath)}`);
      return false;
    }

    const bodyEndIndex = bodyEndMatch.index;

    // Find the last closing tag before </body> to insert our closing </div>
    let insertCloseIndex = bodyEndIndex;

    // Backtrack to find meaningful content (skip whitespace)
    while (insertCloseIndex > contentStartIndex && /\s/.test(content[insertCloseIndex - 1])) {
      insertCloseIndex--;
    }

    // Build new content
    const before = content.substring(0, contentStartIndex);
    const mainContent = content.substring(contentStartIndex, insertCloseIndex);
    const after = content.substring(insertCloseIndex);

    const newContent = before +
                      '\n  <!-- App content - wrapped for FOUC prevention -->\n' +
                      '  <div id="app-content">\n' +
                      mainContent +
                      '\n  </div>\n' +
                      after;

    // Remove the TODO comment if it exists
    const finalContent = newContent.replace(/<!-- TODO: Wrap main page content.*?-->\n\s*/g, '');

    fs.writeFileSync(filePath, finalContent, 'utf8');
    console.log(`  ✅ Wrapped content: ${path.relative(process.cwd(), filePath)}`);
    return true;

  } catch (error) {
    console.error(`  ❌ Error processing ${filePath}:`, error.message);
    return false;
  }
}

// Main execution
console.log('🔄 Wrapping content with #app-content...\n');

const srcDir = path.join(__dirname, '../src');
const publicHtmlDir = path.join(__dirname, '../public_html');

const htmlFiles = [
  ...findHTMLFiles(srcDir),
  ...findHTMLFiles(publicHtmlDir)
];

console.log(`Found ${htmlFiles.length} HTML files\n`);

let wrappedCount = 0;
let skippedCount = 0;

for (const file of htmlFiles) {
  const result = wrapContent(file);
  if (result) {
    wrappedCount++;
  } else {
    const content = fs.readFileSync(file, 'utf8');
    const contentWithoutComments = content.replace(/<!--[\s\S]*?-->/g, '');
    if (/<div[^>]+id=["']app-content["'][^>]*>/.test(contentWithoutComments)) {
      skippedCount++;
    }
  }
}

console.log(`\n✅ Complete!`);
console.log(`   Wrapped: ${wrappedCount}`);
console.log(`   Skipped: ${skippedCount}`);
console.log(`   Total: ${htmlFiles.length}`);
