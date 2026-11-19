'use strict';

/**
 * Calendar page elements hidden with the shared .hidden class stay hidden,
 * even when their own calendar class sets display (the empty Matter row
 * showed on every event because .cal-detail-row { display: grid } won).
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const CSS = fs.readFileSync(path.join(__dirname, '../../src/css/calendar.css'), 'utf8');

function displayOf(markup) {
  // Tailwind's .hidden loads before calendar.css on the page.
  const dom = new JSDOM(`<!doctype html><head><style>.hidden { display: none; }</style><style>${CSS}</style></head><body>${markup}</body>`);
  return dom.window.getComputedStyle(dom.window.document.getElementById('x')).display;
}

test.each(['cal-detail-row', 'cal-legend', 'cal-firm-settings', 'cal-form-row'])('.%s.hidden is not displayed', (cls) => {
  expect(displayOf(`<div id="x" class="${cls} hidden"></div>`)).toBe('none');
});

test('control: a detail row that is not hidden is a grid', () => {
  expect(displayOf('<div id="x" class="cal-detail-row"></div>')).toBe('grid');
});
