/* ==========================================================================
   Lex UI — Core
   AI-Native component framework for the LANA AI platform.
   Zero dependencies. ~250 lines. Built on native Web Components.

   Three tiers:
     Tier 1 (Static)    — Developer writes <lex-*> tags in HTML
     Tier 2 (Dynamic)   — Components bound to API endpoints
     Tier 3 (AI-Native) — LLM structured JSON drives rendering
   ========================================================================== */

(function (global) {
  'use strict';

  const LEX_VERSION = '1.0.0';

  // =========================================================================
  // LexElement — Reactive base class for all Lex components
  // =========================================================================

  class LexElement extends HTMLElement {

    // Override in subclass to declare reactive properties.
    // Example:
    //   static get properties() {
    //     return {
    //       heading: { type: String, default: '' },
    //       count:   { type: Number, default: 0, reflect: true },
    //       items:   { type: Array, default: [] }
    //     };
    //   }
    static get properties() { return {}; }

    constructor() {
      super();
      this._props = {};
      this._initialized = false;
      this._updateScheduled = false;
      this._changedProps = new Map();
      this._originalChildren = null;
      this._eventCleanups = [];

      // Initialize properties with defaults and define getters/setters
      const props = this.constructor.properties;
      for (const [name, config] of Object.entries(props)) {
        const def = config.default !== undefined
          ? (typeof config.default === 'object' ? JSON.parse(JSON.stringify(config.default)) : config.default)
          : null;
        this._props[name] = def;

        Object.defineProperty(this, name, {
          get: () => this._props[name],
          set: (val) => {
            const old = this._props[name];
            const coerced = LexElement._coerce(val, config.type);
            if (old === coerced && typeof coerced !== 'object') return;
            this._props[name] = coerced;
            this._changedProps.set(name, old);
            if (config.reflect) {
              this._reflectToAttribute(name, coerced);
            }
            this._scheduleUpdate();
          },
          configurable: true
        });
      }
    }

    // -----------------------------------------------------------------------
    // Attribute observation — auto-sync attributes to properties
    // -----------------------------------------------------------------------

    static get observedAttributes() {
      return Object.entries(this.properties)
        .filter(([, c]) => c.attribute !== false)
        .map(([name]) => LexElement._propToAttr(name));
    }

    attributeChangedCallback(attr, oldVal, newVal) {
      if (oldVal === newVal) return;
      const propName = LexElement._attrToProp(attr);
      const config = this.constructor.properties[propName];
      if (config) {
        // Avoid re-reflecting when we set the attribute ourselves
        this._props[propName] = LexElement._coerce(newVal, config.type);
        this._changedProps.set(propName, oldVal);
        this._scheduleUpdate();
      }
    }

    // -----------------------------------------------------------------------
    // Lifecycle
    // -----------------------------------------------------------------------

    connectedCallback() {
      if (!this._initialized) {
        this._captureContent();
        // Hydrate properties from attributes
        const props = this.constructor.properties;
        for (const [name, config] of Object.entries(props)) {
          if (config.attribute !== false) {
            const attrName = LexElement._propToAttr(name);
            if (this.hasAttribute(attrName)) {
              this._props[name] = LexElement._coerce(this.getAttribute(attrName), config.type);
            }
          }
        }
        this._initialized = true;
        this._performUpdate();
      }
      this.connected();
    }

    disconnectedCallback() {
      // Clean up event listeners
      for (const cleanup of this._eventCleanups) {
        cleanup();
      }
      this._eventCleanups = [];
      this.disconnected();
    }

    // Override in subclass
    connected() {}
    disconnected() {}
    updated(changedProps) {}

    // -----------------------------------------------------------------------
    // Rendering
    // -----------------------------------------------------------------------

    // Override in subclass — return an HTML string.
    render() { return ''; }

    _performUpdate() {
      const changed = new Map(this._changedProps);
      this._changedProps.clear();
      this._updateScheduled = false;

      // Clean up previous event listeners before re-render
      for (const cleanup of this._eventCleanups) {
        cleanup();
      }
      this._eventCleanups = [];

      const html = this.render();
      if (html !== null && html !== undefined) {
        this.innerHTML = html;
      }

      this._restoreContent();
      this.updated(changed);
    }

    _scheduleUpdate() {
      if (!this._updateScheduled && this._initialized) {
        this._updateScheduled = true;
        queueMicrotask(() => this._performUpdate());
      }
    }

    // -----------------------------------------------------------------------
    // Content preservation (no Shadow DOM slot alternative)
    // -----------------------------------------------------------------------

    _captureContent() {
      if (this.childNodes.length > 0) {
        this._originalChildren = [];
        for (const node of this.childNodes) {
          this._originalChildren.push(node.cloneNode(true));
        }
      }
    }

    _restoreContent() {
      const slot = this.querySelector('slot-content');
      if (slot && this._originalChildren) {
        slot.innerHTML = '';
        for (const node of this._originalChildren) {
          slot.appendChild(node.cloneNode(true));
        }
      }
    }

    // -----------------------------------------------------------------------
    // Type coercion
    // -----------------------------------------------------------------------

    static _coerce(val, type) {
      if (val === null || val === undefined) return null;
      switch (type) {
        case Number:  return Number(val);
        case Boolean: return val !== 'false' && val !== false && val !== null && val !== '0';
        case Object:
        case Array:   return typeof val === 'string' ? JSON.parse(val) : val;
        default:      return String(val);
      }
    }

    // -----------------------------------------------------------------------
    // Attribute reflection
    // -----------------------------------------------------------------------

    _reflectToAttribute(name, val) {
      const attrName = LexElement._propToAttr(name);
      if (val === null || val === false) {
        this.removeAttribute(attrName);
      } else if (val === true) {
        this.setAttribute(attrName, '');
      } else if (typeof val === 'object') {
        this.setAttribute(attrName, JSON.stringify(val));
      } else {
        this.setAttribute(attrName, String(val));
      }
    }

    // propName -> attr-name
    static _propToAttr(name) {
      return name.replace(/([A-Z])/g, '-$1').toLowerCase();
    }

    // attr-name -> propName
    static _attrToProp(attr) {
      return attr.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    // Query inside this component
    $(selector) { return this.querySelector(selector); }
    $$(selector) { return [...this.querySelectorAll(selector)]; }

    // Emit a custom event
    emit(name, detail = {}) {
      this.dispatchEvent(new CustomEvent(name, {
        detail,
        bubbles: true,
        composed: true
      }));
    }

    // Safe HTML escaping
    escapeHtml(text) {
      if (text === null || text === undefined) return '';
      const div = document.createElement('div');
      div.textContent = String(text);
      return div.innerHTML;
    }

    // Bind an event listener with automatic cleanup on re-render/disconnect
    listen(target, event, handler, options) {
      const el = typeof target === 'string' ? this.$(target) : target;
      if (!el) return;
      el.addEventListener(event, handler, options);
      this._eventCleanups.push(() => el.removeEventListener(event, handler, options));
    }

    // Delegate event handling for dynamic child elements
    delegate(event, selector, handler) {
      const delegated = (e) => {
        const target = e.target.closest(selector);
        if (target && this.contains(target)) {
          handler.call(this, e, target);
        }
      };
      this.addEventListener(event, delegated);
      this._eventCleanups.push(() => this.removeEventListener(event, delegated));
    }
  }

  // =========================================================================
  // Registration helper
  // =========================================================================

  function defineLex(tag, ElementClass) {
    if (!customElements.get(tag)) {
      customElements.define(tag, ElementClass);
    }
    return ElementClass;
  }

  // =========================================================================
  // Export
  // =========================================================================

  global.Lex = global.Lex || {};
  global.Lex.LexElement = LexElement;
  global.Lex.defineLex = defineLex;
  global.Lex.version = LEX_VERSION;

})(typeof window !== 'undefined' ? window : globalThis);
