/* Lex UI — Text Component
   Typography component wrapping CSS utility classes into a declarative API.
   Supports semantic background, border, and icon tokens for fully token-driven composition.

   Usage:
     <lex-text variant="primary" size="h1">Page Title</lex-text>
     <lex-text variant="secondary" size="body" tag="p">Body text</lex-text>
     <lex-text variant="accent" size="caption">Caption</lex-text>
     <lex-text variant="danger" size="label-sm" weight="bold">Error label</lex-text>

     <!-- With background, border, and icon -->
     <lex-text variant="on-accent" background="accent" size="label" icon="check" icon-color="successIcon">
       Approved
     </lex-text>

   Variant:    primary | secondary | tertiary | accent | disabled | success | warning | danger | info | link | on-accent
   Size:       display-2xl | display-xl | display-lg | h1–h6 | body-lg | body | body-sm | body-xs | caption | overline | label-lg | label | label-sm | code
   Weight:     light | regular | medium | semibold | bold
   Tag:        span | p | div | h1–h6 (default: span)
   Align:      left | center | right
   Background: primary | secondary | tertiary | accent | accent-soft | accent-muted | elevated  →  maps to var(--lex-bg-{value})
   Border:     default | strong | subtle | accent | focus  →  maps to var(--lex-border-{value})
   Icon:       any Lex.Icons name (e.g. "check", "file-text", "alert-triangle")
   Icon-size:  xxSmall | xSmall | small | normal | medium | large  (default: matches text size)
   Icon-color: any Lex.Icons color token (e.g. "accentIcon", "successIcon", "dangerIcon")
   Icon-position: left | right (default: left)
   No-padding:    boolean — suppress auto-padding when background/border is set
*/

(function () {
  'use strict';

  const { LexElement, defineLex } = window.Lex;

  let stylesInjected = false;

  function injectStyles() {
    if (stylesInjected) return;
    stylesInjected = true;

    const style = document.createElement('style');
    style.id = 'lex-text-styles';
    style.textContent = `
      lex-text {
        display: contents;
      }
      lex-text .lex-text-inner {
        display: inline-flex;
        align-items: center;
        gap: 0.35em;
      }
      lex-text .lex-text-inner > svg {
        flex-shrink: 0;
      }
    `;
    document.head.appendChild(style);
  }

  // Valid variant names (map to .lex-text-{variant})
  const VARIANTS = new Set([
    'primary', 'secondary', 'tertiary', 'accent', 'disabled',
    'success', 'warning', 'danger', 'info', 'link', 'on-accent'
  ]);

  // Valid size names (map to .lex-{size})
  const SIZES = new Set([
    'display-2xl', 'display-xl', 'display-lg',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'body-lg', 'body', 'body-sm', 'body-xs',
    'caption', 'overline',
    'label-lg', 'label', 'label-sm',
    'code'
  ]);

  // Weight map (prop value -> CSS value)
  const WEIGHTS = {
    light: 'var(--lex-weight-light, 300)',
    regular: 'var(--lex-weight-regular, 400)',
    medium: 'var(--lex-weight-medium, 500)',
    semibold: 'var(--lex-weight-semibold, 600)',
    bold: 'var(--lex-weight-bold, 700)'
  };

  // Allowed tags
  const TAGS = new Set(['span', 'p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'label', 'small', 'strong', 'em']);

  // Valid background token names → var(--lex-bg-{name})
  const BACKGROUNDS = new Set([
    'primary', 'secondary', 'tertiary', 'accent', 'accent-soft', 'accent-muted', 'elevated'
  ]);

  // Valid border token names → var(--lex-border-{name})
  const BORDERS = new Set([
    'default', 'strong', 'subtle', 'accent', 'focus'
  ]);

  // Auto-padding when background or border is present
  const AUTO_PADDING = '0.25em 0.5em';
  const AUTO_RADIUS = 'var(--lex-radius-md, 6px)';

  // Map text size → sensible icon size
  const SIZE_TO_ICON_SIZE = {
    'display-2xl': 'xxLarge', 'display-xl': 'xLarge', 'display-lg': 'large',
    'h1': 'large', 'h2': 'medium', 'h3': 'medium', 'h4': 'normal', 'h5': 'normal', 'h6': 'small',
    'body-lg': 'normal', 'body': 'normal', 'body-sm': 'small', 'body-xs': 'xSmall',
    'caption': 'xSmall', 'overline': 'xSmall',
    'label-lg': 'normal', 'label': 'small', 'label-sm': 'xSmall',
    'code': 'small'
  };

  class LexText extends LexElement {
    static get properties() {
      return {
        variant:       { type: String, default: 'primary' },
        size:          { type: String, default: '' },
        weight:        { type: String, default: '' },
        tag:           { type: String, default: 'span' },
        align:         { type: String, default: '' },
        background:    { type: String, default: '' },
        border:        { type: String, default: '' },
        icon:          { type: String, default: '' },
        'icon-size':   { type: String, default: '' },
        'icon-color':  { type: String, default: '' },
        'icon-position': { type: String, default: 'left' },
        'no-padding':    { type: Boolean, default: false }
      };
    }

    render() {
      injectStyles();

      const tag = TAGS.has(this.tag) ? this.tag : 'span';
      const hasBg = this.background && BACKGROUNDS.has(this.background);
      const hasBorder = this.border && BORDERS.has(this.border);
      const hasIcon = this.icon && window.Lex && window.Lex.Icons;
      const iconPos = this['icon-position'] === 'right' ? 'right' : 'left';

      // Build class list
      const classes = [];

      // Variant → .lex-text-{variant}
      if (this.variant && VARIANTS.has(this.variant)) {
        classes.push(`lex-text-${this.variant}`);
      }

      // Size → .lex-{size}
      if (this.size && SIZES.has(this.size)) {
        classes.push(`lex-${this.size}`);
      }

      // Build inline styles
      const styles = [];

      // Weight override
      if (this.weight && WEIGHTS[this.weight]) {
        styles.push(`font-weight:${WEIGHTS[this.weight]}`);
      }

      // Text alignment
      if (this.align) {
        styles.push(`text-align:${this.align}`);
      }

      // Background token
      if (hasBg) {
        styles.push(`background-color:var(--lex-bg-${this.background})`);
      }

      // Border token
      if (hasBorder) {
        styles.push(`border:1px solid var(--lex-border-${this.border})`);
      }

      // Auto-pad when bg or border is set (unless no-padding)
      if ((hasBg || hasBorder) && !this['no-padding']) {
        styles.push(`padding:${AUTO_PADDING}`);
        styles.push(`border-radius:${AUTO_RADIUS}`);
      }

      // Block-level tags get margin:0 to reset browser defaults
      if (tag === 'p' || tag === 'div' || tag.match(/^h[1-6]$/)) {
        styles.push('margin:0');
      }

      const classAttr = classes.length ? ` class="${classes.join(' ')}"` : '';
      const styleAttr = styles.length ? ` style="${styles.join(';')}"` : '';

      // Render icon SVG
      let iconSvg = '';
      if (hasIcon) {
        const iconName = this.icon;
        const iconSize = this['icon-size'] || SIZE_TO_ICON_SIZE[this.size] || 'normal';
        const iconColor = this['icon-color'] || '';
        const cfg = { name: iconName, size: iconSize };
        if (iconColor) cfg.color = iconColor;

        if (window.Lex.Icons.has(iconName)) {
          iconSvg = window.Lex.Icons.get(cfg);
        }
      }

      // If icon is present, wrap in flex container
      if (iconSvg) {
        const iconLeft = iconPos === 'left' ? iconSvg : '';
        const iconRight = iconPos === 'right' ? iconSvg : '';
        return `<${tag}${classAttr}${styleAttr}><span class="lex-text-inner">${iconLeft}<slot-content></slot-content>${iconRight}</span></${tag}>`;
      }

      return `<${tag}${classAttr}${styleAttr}><slot-content></slot-content></${tag}>`;
    }
  }

  defineLex('lex-text', LexText);
})();
