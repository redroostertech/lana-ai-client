'use strict';

/**
 * Which product this client is running as, and the LANA One look.
 *
 * One client codebase ships in two apps: the LANA client itself (flavor
 * "lana", the default) and LANA One, which bundles this client with its own
 * backend (flavor "lana-one"). The pages are written for "lana" and are left
 * untouched in that flavor. In "lana-one" the preload calls
 * applyBrandToDocument(), which swaps the logos, titles, favicons and the
 * legacy page loader as the page is parsed, before it is painted.
 *
 * The flavor is fixed at build time by `lanaFlavor` in the app's package.json
 * (the client's says "lana"; LANA One's says "lana-one", and a packaged LANA
 * One runs this code with its own package.json). An unpackaged app also reads
 * LANA_FLAVOR, so either look can be run locally. A packaged app ignores it,
 * so a stray variable cannot rebrand a customer's app.
 */

const DEFAULT_FLAVOR = 'lana';

const FLAVORS = {
  lana: { id: 'lana', name: 'LANA AI' },
  'lana-one': { id: 'lana-one', name: 'LANA One' },
};

/** The product name as the plain client writes it in titles and labels. */
const LANA_NAMES = /LANA AI|LanaAI|Lana AI/g;

// The LANA One mark (build/brand/lana-one), for inline use.
const MARK_VIEWBOX = '358 382 539 539';
const MARK_PATHS = [
  'M358,384 L731,384 L731,474 L450,474 L450,767 L358,767Z',
  'M897,919 L524,919 L524,829 L805,829 L805,536 L897,536Z',
  'M550,578 L624,537 L661,537 L661,780 L602,780 L602,600 L550,627Z',
];
const DARK_INK = '#111111';
const LIGHT_INK = '#F5F5F4';

// Favicon whose ink follows the browser theme.
const FAVICON_SVG = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='${MARK_VIEWBOX}'>`
  + `<style>g{fill:${DARK_INK}}@media (prefers-color-scheme: dark){g{fill:${LIGHT_INK}}}</style>`
  + `<g>${MARK_PATHS.map((d) => `<path d='${d}'/>`).join('')}</g></svg>`;
const FAVICON_HREF = 'data:image/svg+xml,' + encodeURIComponent(FAVICON_SVG);

// The plain client's "L" favicon (embed.html, doc-studio); other apps' favicons are kept.
const LANA_FAVICON_SIGNATURE = 'M22 16h8v25h15v7H22z';

/**
 * @param {object} params
 * @param {object} [params.env] - process.env
 * @param {object} [params.packageJson] - the running app's package.json
 * @param {boolean} [params.isPackaged] - app.isPackaged
 * @returns {string} a key of FLAVORS
 */
function resolveFlavor({ env = {}, packageJson = {}, isPackaged = false } = {}) {
  if (!isPackaged) {
    const fromEnv = String(env.LANA_FLAVOR || '').trim().toLowerCase();
    if (FLAVORS[fromEnv]) return fromEnv;
  }
  const stamped = String(packageJson.lanaFlavor || '').trim().toLowerCase();
  return FLAVORS[stamped] ? stamped : DEFAULT_FLAVOR;
}

function brandFor(flavor) {
  return FLAVORS[flavor] || FLAVORS[DEFAULT_FLAVOR];
}

/** img/logo-light.png -> img/lana-one/logo-light.png, keeping any ../ prefix. */
function lanaOneLogo(src) {
  const m = /^(.*\bimg\/)(logo-(?:light|dark)\.png)([?#].*)?$/.exec(src || '');
  return m ? m[1] + 'lana-one/' + m[2] + (m[3] || '') : null;
}

function rename(text) {
  return text.replace(LANA_NAMES, FLAVORS['lana-one'].name);
}

function brandElement(el) {
  const tag = el.tagName;
  if (tag === 'IMG') {
    const swapped = lanaOneLogo(el.getAttribute('src'));
    if (swapped) {
      el.setAttribute('src', swapped);
      el.setAttribute('alt', FLAVORS['lana-one'].name);
    }
  } else if (tag === 'LINK') {
    const rel = (el.getAttribute('rel') || '').toLowerCase().split(/\s+/);
    const href = el.getAttribute('href') || '';
    if (rel.includes('icon') && decodeURIComponent(href).includes(LANA_FAVICON_SIGNATURE)) {
      el.setAttribute('href', FAVICON_HREF);
    }
  } else if (tag === 'TITLE') {
    const renamed = rename(el.textContent);
    if (renamed !== el.textContent) el.textContent = renamed;
  } else if (el.id === 'lana-preloader') {
    el.style.background = DARK_INK;
  } else if (tag === 'svg' && el.classList && el.classList.contains('preloader-logo')) {
    brandLegacyPreloaderLogo(el);
  } else if (el.classList && el.classList.contains('preloader-text')) {
    const renamed = rename(el.textContent);
    if (renamed !== el.textContent) el.textContent = renamed;
  }
}

function brandLegacyPreloaderLogo(svg) {
  if (svg.getAttribute('data-lana-one') === '1') return;
  const ns = 'http://www.w3.org/2000/svg';
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  svg.setAttribute('viewBox', MARK_VIEWBOX);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', FLAVORS['lana-one'].name);
  svg.setAttribute('data-lana-one', '1');
  for (const d of MARK_PATHS) {
    const p = svg.ownerDocument.createElementNS(ns, 'path');
    p.setAttribute('d', d);
    p.setAttribute('fill', LIGHT_INK);
    svg.appendChild(p);
  }
}

const SELECTOR = 'img, link[rel], title, #lana-preloader, svg.preloader-logo, .preloader-text';

function brandTree(root) {
  if (root.nodeType !== 1 && root.nodeType !== 9) return;
  if (root.nodeType === 1 && root.matches(SELECTOR)) brandElement(root);
  for (const el of root.querySelectorAll(SELECTOR)) brandElement(el);
}

/**
 * Give a page the LANA One look, now and for everything added later (Lex
 * components render after load, and lex-app sets document.title itself).
 * Does nothing for any other flavor.
 *
 * @param {Document} doc
 * @param {string} flavor
 * @returns {MutationObserver|null}
 */
function applyBrandToDocument(doc, flavor) {
  if (flavor !== 'lana-one') return null;
  const Observer = doc.defaultView && doc.defaultView.MutationObserver;
  if (!Observer) return null;
  brandTree(doc);
  const observer = new Observer((records) => {
    for (const r of records) {
      if (r.type === 'childList') {
        if (r.target.nodeName === 'TITLE') brandElement(r.target);
        for (const n of r.addedNodes) brandTree(n);
      } else if (r.type === 'characterData') {
        const parent = r.target.parentNode;
        if (parent && parent.nodeType === 1) brandElement(parent);
      } else if (r.type === 'attributes') {
        brandElement(r.target);
      }
    }
  });
  observer.observe(doc, {
    childList: true, subtree: true, characterData: true,
    attributes: true, attributeFilter: ['src', 'href'],
  });
  return observer;
}

module.exports = {
  DEFAULT_FLAVOR, FLAVORS, MARK_VIEWBOX, MARK_PATHS, FAVICON_HREF,
  resolveFlavor, brandFor, lanaOneLogo, applyBrandToDocument,
};
