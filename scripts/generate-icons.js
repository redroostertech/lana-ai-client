#!/usr/bin/env node

/**
 * Lex Icons Generator
 *
 * Reads SVG files from lucide-static and generates a self-contained
 * lex.icons.js file with zero runtime dependencies.
 *
 * Usage:
 *   node scripts/generate-icons.js            # Curated icons from manifest
 *   node scripts/generate-icons.js --all       # All 1,900+ Lucide icons
 *   node scripts/generate-icons.js --list      # Print available icon names
 *
 * The generated file exposes:
 *   Lex.Icons.get(name, size?)   — returns SVG string (default 24px)
 *   Lex.Icons.has(name)          — check if icon exists
 *   Lex.Icons.list()             — array of all icon names
 *   Lex.Icons.render(name, opts) — returns SVG with custom class/size/color
 */

const fs = require('fs');
const path = require('path');

// ── Config ──────────────────────────────────────────────────────

const ICONS_DIR = path.join(__dirname, '..', 'node_modules', 'lucide-static', 'icons');
const OUTPUT_FILE = path.join(__dirname, '..', 'src', 'js', 'lex', 'lex.icons.js');
const MANIFEST_FILE = path.join(__dirname, 'icon-manifest.json');

// ── Helpers ─────────────────────────────────────────────────────

function getAvailableIcons() {
  return fs.readdirSync(ICONS_DIR)
    .filter(f => f.endsWith('.svg'))
    .map(f => f.replace('.svg', ''))
    .sort();
}

function readIcon(name) {
  const filePath = path.join(ICONS_DIR, `${name}.svg`);
  if (!fs.existsSync(filePath)) {
    console.warn(`  ⚠ Icon not found: ${name}`);
    return null;
  }
  let svg = fs.readFileSync(filePath, 'utf-8');

  // Strip license comment
  svg = svg.replace(/<!--[\s\S]*?-->\s*/, '');

  // Collapse newlines to single space (preserve attribute separation)
  svg = svg.replace(/\n\s*/g, ' ').trim();

  // Remove fixed width/height (we'll set these dynamically via get/render)
  svg = svg.replace(/\s+width="\d+"/, '');
  svg = svg.replace(/\s+height="\d+"/, '');

  // Remove the default lucide class (users set their own via render())
  svg = svg.replace(/\s+class="[^"]*"/, '');

  return svg;
}

function minifySvg(svg) {
  // Collapse multiple spaces
  return svg.replace(/\s{2,}/g, ' ').trim();
}

// ── List mode ───────────────────────────────────────────────────

if (process.argv.includes('--list')) {
  const icons = getAvailableIcons();
  console.log(`\nAvailable Lucide icons (${icons.length}):\n`);

  // Print in columns
  const cols = 4;
  const colWidth = 30;
  for (let i = 0; i < icons.length; i += cols) {
    const row = icons.slice(i, i + cols).map(n => n.padEnd(colWidth)).join('');
    console.log('  ' + row);
  }
  console.log();
  process.exit(0);
}

// ── Determine icon set ──────────────────────────────────────────

const useAll = process.argv.includes('--all');
let iconNames;

if (useAll) {
  iconNames = getAvailableIcons();
  console.log(`\n🎨 Generating ALL ${iconNames.length} Lucide icons...\n`);
} else {
  // Load manifest
  if (!fs.existsSync(MANIFEST_FILE)) {
    console.error(`\n❌ Icon manifest not found: ${MANIFEST_FILE}`);
    console.error('   Create it or run with --all to include all icons.\n');
    process.exit(1);
  }
  iconNames = JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf-8'));
  console.log(`\n🎨 Generating ${iconNames.length} curated icons from manifest...\n`);
}

// ── Build icon map ──────────────────────────────────────────────

const icons = {};
let skipped = 0;

for (const name of iconNames) {
  const svg = readIcon(name);
  if (svg) {
    icons[name] = minifySvg(svg);
  } else {
    skipped++;
  }
}

const iconCount = Object.keys(icons).length;
console.log(`  ✓ ${iconCount} icons processed${skipped ? ` (${skipped} skipped)` : ''}`);

// ── Estimate size ───────────────────────────────────────────────

const jsonIcons = JSON.stringify(icons, null, 0);
const estimatedKB = Math.round(jsonIcons.length / 1024);
console.log(`  ✓ Estimated output size: ~${estimatedKB} KB`);

// ── Read lucide version ─────────────────────────────────────────

let lucideVersion = 'unknown';
try {
  const pkg = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', 'node_modules', 'lucide-static', 'package.json'), 'utf-8'
  ));
  lucideVersion = pkg.version;
} catch (e) { /* ignore */ }

// ── Generate output ─────────────────────────────────────────────

// Build the icon entries as individual lines for readability
const iconEntries = Object.entries(icons)
  .map(([name, svg]) => `    "${name}": '${svg.replace(/'/g, "\\'")}'`)
  .join(',\n');

const output = `/**
 * Lex Icons — Lucide icon library compiled for local use
 *
 * Generated from lucide-static v${lucideVersion}
 * License: ISC (https://github.com/lucide-icons/lucide/blob/main/LICENSE)
 * Icons: ${iconCount}
 * Generated: ${new Date().toISOString().split('T')[0]}
 *
 * DO NOT EDIT — regenerate with: node scripts/generate-icons.js
 *
 * Fluent API:
 *   Lex.Icons.search                             → SVG at normal (20px)
 *   Lex.Icons.search.small                       → SVG at 16px
 *   Lex.Icons.search.small.accentIcon            → 16px + accent color
 *   Lex.Icons.search.medium.dangerIcon.borderSmall → chained config
 *   Lex.Icons['arrow-right'].large               → kebab-case via bracket
 *   Lex.Icons.arrowRight.large                   → camelCase also works
 *   Lex.Icons.search.size(24)                    → custom pixel size
 *   Lex.Icons.search.borderWidth(1.5)            → custom stroke width
 *
 * Config object:
 *   Lex.Icons.get({ name: 'search', size: 'small', color: 'accentIcon' })
 *
 * Utilities:
 *   Lex.Icons.has('search')                      → true
 *   Lex.Icons.list()                             → ['alert-circle', ...]
 *   Lex.Icons.find('arrow')                      → ['arrow-down', ...]
 *   Lex.Icons.count                              → ${iconCount}
 */
(function () {
  'use strict';

  // ── Generated Icon Data ────────────────────────────────────────

  const _icons = {
${iconEntries}
  };

  // ── Token Maps (synced with lex-tokens.css) ────────────────────

  const SIZE = {
    xxSmall: 12, xSmall: 14, small: 16, normal: 20,
    medium: 24, large: 32, xLarge: 40, xxLarge: 48
  };

  const COLOR = {
    primaryIcon:   'currentColor',
    secondaryIcon: 'var(--lex-icon-secondary)',
    tertiaryIcon:  'var(--lex-icon-tertiary)',
    accentIcon:    'var(--lex-icon-accent)',
    successIcon:   'var(--lex-icon-success)',
    warningIcon:   'var(--lex-icon-warning)',
    dangerIcon:    'var(--lex-icon-danger)',
    infoIcon:      'var(--lex-icon-info)',
    inverseIcon:   'var(--lex-icon-inverse)'
  };

  const STROKE = {
    borderSmall:  '1.5',
    borderNormal: '2',
    borderThick:  '2.5'
  };

  // ── Helpers ────────────────────────────────────────────────────

  function toKebab(str) {
    return str.replace(/([A-Z])/g, function (m) { return '-' + m.toLowerCase(); });
  }

  function resolveName(prop) {
    if (prop in _icons) return prop;
    var kebab = toKebab(prop);
    if (kebab in _icons) return kebab;
    return null;
  }

  // ── Icon Builder (fluent/chainable) ────────────────────────────
  //
  // Each builder is a Proxy around a render function.
  // Accessing a token property returns a NEW builder with that config merged.
  // String coercion (innerHTML, template literals, concatenation) calls render().

  function createBuilder(name, cfg) {
    cfg = cfg || {};
    var _size = cfg.size || 'normal';
    var _color = cfg.color || null;
    var _stroke = cfg.strokeWidth || null;
    var _cls = cfg.className || '';

    function render() {
      var svg = _icons[name];
      if (!svg) return '';

      var sizePx = (typeof _size === 'number') ? _size : (SIZE[_size] || 20);
      var attrs = 'width="' + sizePx + '" height="' + sizePx + '"';

      if (_cls) {
        attrs += ' class="' + _cls + '"';
      }

      // Color: set style="color:..." so stroke="currentColor" picks it up
      if (_color) {
        var colorVal = COLOR[_color] || _color;
        if (colorVal !== 'currentColor') {
          attrs += ' style="color:' + colorVal + '"';
        }
      }

      svg = svg.replace('<svg ', '<svg ' + attrs + ' ');

      // Stroke width override
      if (_stroke) {
        var sw = STROKE[_stroke] || _stroke;
        svg = svg.replace('stroke-width="2"', 'stroke-width="' + sw + '"');
      }

      return svg;
    }

    var builder = new Proxy(render, {
      get: function (target, prop) {
        // String coercion hooks
        if (prop === Symbol.toPrimitive) return function () { return render(); };
        if (prop === 'toString' || prop === 'valueOf') return function () { return render(); };

        // .svg — explicit string getter
        if (prop === 'svg') return render();

        // .size(n) — custom pixel size
        if (prop === 'size') {
          return function (n) {
            return createBuilder(name, { size: n, color: _color, strokeWidth: _stroke, className: _cls });
          };
        }

        // .borderWidth(n) — custom stroke width
        if (prop === 'borderWidth') {
          return function (n) {
            return createBuilder(name, { size: _size, color: _color, strokeWidth: String(n), className: _cls });
          };
        }

        // .className('...') — add CSS class
        if (prop === 'className') {
          return function (cls) {
            return createBuilder(name, { size: _size, color: _color, strokeWidth: _stroke, className: cls });
          };
        }

        // Size tokens: .xxSmall, .small, .normal, .medium, .large, etc.
        if (prop in SIZE) {
          return createBuilder(name, { size: prop, color: _color, strokeWidth: _stroke, className: _cls });
        }

        // Color tokens: .primaryIcon, .accentIcon, .dangerIcon, etc.
        if (prop in COLOR) {
          return createBuilder(name, { size: _size, color: prop, strokeWidth: _stroke, className: _cls });
        }

        // Stroke tokens: .borderSmall, .borderNormal, .borderThick
        if (prop in STROKE) {
          return createBuilder(name, { size: _size, color: _color, strokeWidth: prop, className: _cls });
        }

        return undefined;
      }
    });

    return builder;
  }

  // ── Icons API (Proxy for property-based access) ────────────────

  var _api = {
    /**
     * Get icon by name or config object.
     * @param {string|Object} nameOrConfig - Icon name or { name, size, color, strokeWidth }
     * @returns {string} SVG string
     */
    get: function (nameOrConfig) {
      if (typeof nameOrConfig === 'object' && nameOrConfig !== null) {
        return String(createBuilder(nameOrConfig.name, {
          size: nameOrConfig.size || 'normal',
          color: nameOrConfig.color || null,
          strokeWidth: nameOrConfig.strokeWidth || null,
          className: nameOrConfig.className || ''
        }));
      }
      // Legacy string usage: get('name')
      return String(createBuilder(nameOrConfig));
    },

    /** Check if icon exists (supports kebab-case and camelCase) */
    has: function (name) { return resolveName(name) !== null; },

    /** Get all icon names */
    list: function () { return Object.keys(_icons); },

    /** Search icons by partial name match */
    find: function (query) {
      var q = query.toLowerCase();
      return Object.keys(_icons).filter(function (n) { return n.indexOf(q) !== -1; });
    },

    /** Total number of icons */
    count: ${iconCount},

    /** Lucide version */
    version: '${lucideVersion}',

    /** Exposed token maps for introspection */
    sizes: SIZE,
    colors: COLOR,
    strokes: STROKE
  };

  var Icons = new Proxy(_api, {
    get: function (target, prop) {
      // Known API methods/properties first
      if (prop in target) return target[prop];

      // Symbol properties (iterator, toPrimitive, etc.) — pass through
      if (typeof prop === 'symbol') return undefined;

      // Try as icon name (kebab-case or camelCase)
      var iconName = resolveName(prop);
      if (iconName) return createBuilder(iconName);

      return undefined;
    }
  });

  // ── Expose on Lex namespace ────────────────────────────────────
  if (!window.Lex) window.Lex = {};
  window.Lex.Icons = Icons;
})();
`;

// ── Write file ──────────────────────────────────────────────────

const outputDir = path.dirname(OUTPUT_FILE);
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

fs.writeFileSync(OUTPUT_FILE, output, 'utf-8');

const actualKB = Math.round(fs.statSync(OUTPUT_FILE).size / 1024);
console.log(`  ✓ Written to: ${path.relative(process.cwd(), OUTPUT_FILE)} (${actualKB} KB)`);
console.log(`\n✅ Lex Icons ready — ${iconCount} icons from Lucide v${lucideVersion}\n`);
