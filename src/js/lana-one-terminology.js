/**
 * lana-one-terminology.js
 *
 * EDITION-GATED UI terminology overlay: renames the visible term "matter(s)" ->
 * "workspace(s)" ONLY in the LANA One edition. The org / LANA AI product keeps
 * "matters". This is DISPLAY TEXT ONLY - it never touches API paths, code
 * identifiers, element ids/classes, form values, or href/src. Whole-word \b regex
 * plus skipping inputs/code means matter_id, matterId, currentMatters, and
 * /api/v1/matters are all safe.
 *
 * Loaded on authenticated app pages (via auth-guard.js on the 24 pages that load
 * it, and a direct <script> tag on the few matter-pages that do not). Fully inert
 * when isLanaOne is false, so it is safe to ship in the stock lana-ai-client build.
 */
(function () {
  'use strict';

  // Guard against double-load (auth-guard loader + a direct tag on the same page).
  if (window.__lanaOneTerminologyInit) return;
  window.__lanaOneTerminologyInit = true;

  // Case-preserving, whole-word replacements; plural/longest first. Because \w
  // includes '_', the \b anchors do NOT match inside matter_id / matterId, so code
  // identifiers that might surface in text are left untouched.
  var RULES = [
    // Profession-specific -> general terms (LANA One is a general workspace usable
    // by any professional, so avoid assuming a legal/medical "practice").
    [/\bPractice Areas\b/g, 'Categories'],
    [/\bpractice areas\b/g, 'categories'],
    [/\bPractice Area\b/g, 'Category'],
    [/\bpractice area\b/g, 'category'],
    // "matter" (legal) -> "workspace"
    [/\bMatters\b/g, 'Workspaces'],
    [/\bMATTERS\b/g, 'WORKSPACES'],
    [/\bmatters\b/g, 'workspaces'],
    [/\bMatter\b/g, 'Workspace'],
    [/\bMATTER\b/g, 'WORKSPACE'],
    [/\bmatter\b/g, 'workspace']
  ];
  // Cheap pre-check so we skip the regex work on the vast majority of nodes. Must
  // cover every term RULES can replace, or those nodes get skipped before the swap.
  var HAS = /\b(matters?|practice areas?)\b/i;
  // Protect the common English idiom "no matter" (as in "no matter what") from the
  // singular swap; legal "matter" uses do not follow "no".
  var IDIOM = /\bno matter\b/i;

  function swap(str) {
    if (!str || !HAS.test(str)) return str;
    if (IDIOM.test(str)) return str; // leave idiomatic "no matter ..." alone
    // Leave URLs / API paths alone even if one surfaces as visible text (e.g. an
    // error message showing /api/v1/matters) so we never display a broken path.
    if (/https?:\/\/|\/api\//i.test(str)) return str;
    // Leave template-binding / merge-field syntax ({{matter.name}}) intact so a swap
    // never breaks a data binding or a documented merge-field example.
    if (str.indexOf('{{') !== -1 || str.indexOf('}}') !== -1) return str;
    var out = str;
    for (var i = 0; i < RULES.length; i++) out = out.replace(RULES[i][0], RULES[i][1]);
    return out;
  }

  var SKIP_TAGS = {
    SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEXTAREA: 1, INPUT: 1,
    SELECT: 1, OPTION: 1, CODE: 1, PRE: 1
  };

  function skipEl(el) {
    for (var n = el; n && n.nodeType === 1; n = n.parentNode) {
      if (SKIP_TAGS[n.tagName]) return true;
      if (n.getAttribute && (n.getAttribute('contenteditable') === 'true' || n.hasAttribute('data-no-term-swap'))) return true;
    }
    return false;
  }

  // Visible-string attributes only. Never touch id/class/name/value/href/src/data-*.
  var ATTRS = ['placeholder', 'title', 'aria-label', 'alt'];

  function processTextNode(node) {
    var v = node.nodeValue;
    if (!v || !HAS.test(v)) return;
    if (node.parentNode && skipEl(node.parentNode)) return;
    var nv = swap(v);
    if (nv !== v) node.nodeValue = nv; // only write when something changed
  }

  function processElementAttrs(el) {
    if (!el || el.nodeType !== 1 || SKIP_TAGS[el.tagName]) return;
    if (!el.getAttribute) return;
    for (var i = 0; i < ATTRS.length; i++) {
      var a = ATTRS[i];
      if (el.hasAttribute(a)) {
        var v = el.getAttribute(a);
        if (v && HAS.test(v)) {
          var nv = swap(v);
          if (nv !== v) el.setAttribute(a, nv);
        }
      }
    }
  }

  // Process a node (element subtree or a single text node) for both text + attrs.
  function process(root) {
    if (!root) return;
    if (root.nodeType === 3) { processTextNode(root); return; }
    if (root.nodeType !== 1) return;
    if (skipEl(root)) return;
    processElementAttrs(root);
    var els = root.querySelectorAll ? root.querySelectorAll('*') : [];
    for (var i = 0; i < els.length; i++) {
      if (!skipEl(els[i])) processElementAttrs(els[i]);
    }
    var tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    var t;
    while ((t = tw.nextNode())) processTextNode(t);
  }

  // Batch mutation work into an animation frame; the pass is idempotent (after a
  // swap there is no "matter" left, so re-processing a node is a no-op), so writes
  // triggered by our own edits never loop.
  var queue = [];
  var scheduled = false;
  var raf = window.requestAnimationFrame ? window.requestAnimationFrame.bind(window) : function (fn) { return setTimeout(fn, 16); };
  function flush() {
    scheduled = false;
    var items = queue;
    queue = [];
    for (var i = 0; i < items.length; i++) process(items[i]);
  }
  function schedule(node) {
    queue.push(node);
    if (!scheduled) { scheduled = true; raf(flush); }
  }

  function start() {
    process(document.body);
    var obs = new MutationObserver(function (muts) {
      for (var i = 0; i < muts.length; i++) {
        var m = muts[i];
        if (m.type === 'characterData') {
          schedule(m.target);
        } else if (m.addedNodes && m.addedNodes.length) {
          for (var j = 0; j < m.addedNodes.length; j++) schedule(m.addedNodes[j]);
        }
      }
    });
    obs.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  function run() {
    // Edition gate: act ONLY in the LANA One edition. In the browser / org edition
    // (no electronAPI, or isLanaOne !== true) this is a complete no-op.
    var api = window.electronAPI;
    if (!api || typeof api.getConfig !== 'function') return;
    Promise.resolve(api.getConfig()).then(function (cfg) {
      if (!cfg || cfg.isLanaOne !== true) return;
      if (document.body) start();
      else document.addEventListener('DOMContentLoaded', start);
    }).catch(function () { /* inert on any failure */ });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
  else run();
})();
