'use strict';

// document.generateRedline compares two uploaded versions and writes a
// difference report. It is not the AI redliner, so the builder must call it
// "Compare Versions", matching the backend catalog name.

const fs = require('fs');
const path = require('path');

test('the builder labels document.generateRedline "Compare Versions"', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../src/js/skill-builder.js'), 'utf8');
  const block = src.slice(src.lastIndexOf('{', src.indexOf("actionType: 'document.generateRedline'")), src.indexOf("actionType: 'document.generateRedline'"));
  expect(block).toMatch(/name: 'Compare Versions'/);
  // The node type id stays: saved skills store it.
  expect(block).not.toMatch(/(name|description): '[^']*redline/i);
});
