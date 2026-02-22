/* Lex UI — Progress Bar Component
   Horizontal progress indicator with single-color or multi-segment modes.

   Usage (single color):
     <lex-progress-bar value="72"></lex-progress-bar>
     <lex-progress-bar value="45" color="warning" size="md"></lex-progress-bar>
     <lex-progress-bar value="90" color="danger" size="xs" animate="false"></lex-progress-bar>

   Usage (multi-segment — segments prop takes over from value):
     <lex-progress-bar
       segments='[{"value":40,"color":"warning","label":"Pending"},{"value":20,"color":"info","label":"Retrying"},{"value":10,"color":"danger","label":"Failed"}]'>
     </lex-progress-bar>

   Properties:
     value     Number   0-100   Single-fill percentage (ignored when segments is set)
     color     String   accent  accent | info | success | warning | danger
     size      String   sm      xs (2px) | sm (4px) | md (8px)
     segments  Array    []      [{value, color, label}] for multi-segment mode
     animate   Boolean  true    Smooth CSS width transition

   Colors map to design tokens:
     accent  → var(--lex-bg-accent)
     info    → var(--lex-color-info-500)
     success → var(--lex-color-success-500)
     warning → var(--lex-color-warning-500)
     danger  → var(--lex-color-danger-500)
   Track → var(--lex-border-default)
*/

(function () {
  'use strict';

  var _lex = window.Lex;
  var LexElement = _lex.LexElement;
  var defineLex  = _lex.defineLex;

  var stylesInjected = false;

  // -------------------------------------------------------------------------
  // Style injection (once per page)
  // -------------------------------------------------------------------------

  function injectStyles() {
    if (stylesInjected) return;
    stylesInjected = true;

    var style = document.createElement('style');
    style.id = 'lex-progress-bar-styles';
    style.textContent = [
      'lex-progress-bar {',
      '  display: block;',
      '}',

      '.lex-pb-track {',
      '  width: 100%;',
      '  background: var(--lex-border-default);',
      '  border-radius: 9999px;',
      '  overflow: hidden;',
      '  display: flex;',
      '}',

      /* sizes */
      '.lex-pb-track--xs { height: 2px; }',
      '.lex-pb-track--sm { height: 4px; }',
      '.lex-pb-track--md { height: 8px; }',

      /* fill segment */
      '.lex-pb-fill {',
      '  height: 100%;',
      '  border-radius: 0;',
      '  min-width: 0;',
      '}',

      /* single-fill: first/last radius */
      '.lex-pb-track--single .lex-pb-fill {',
      '  border-radius: 9999px;',
      '}',

      /* animation */
      '.lex-pb-fill--animate {',
      '  transition: width 0.4s cubic-bezier(0.4, 0, 0.2, 1);',
      '}'
    ].join('\n');

    document.head.appendChild(style);
  }

  // -------------------------------------------------------------------------
  // Color token map
  // -------------------------------------------------------------------------

  var COLOR_TOKENS = {
    accent:  'var(--lex-bg-accent)',
    info:    'var(--lex-color-info-500)',
    success: 'var(--lex-color-success-500)',
    warning: 'var(--lex-color-warning-500)',
    danger:  'var(--lex-color-danger-500)'
  };

  function colorToken(name) {
    return COLOR_TOKENS[name] || COLOR_TOKENS['accent'];
  }

  // -------------------------------------------------------------------------
  // LexProgressBar
  // -------------------------------------------------------------------------

  class LexProgressBar extends LexElement {
    static get properties() {
      return {
        value:    { type: Number,  default: 0 },
        color:    { type: String,  default: 'accent' },
        size:     { type: String,  default: 'sm' },
        segments: { type: Array,   default: [] },
        animate:  { type: Boolean, default: true }
      };
    }

    render() {
      injectStyles();

      var sizeClass  = 'lex-pb-track--' + (this.size || 'sm');
      var animClass  = this.animate !== false ? 'lex-pb-fill--animate' : '';
      var segs       = Array.isArray(this.segments) ? this.segments : [];
      var isMulti    = segs.length > 0;
      var modeClass  = isMulti ? '' : 'lex-pb-track--single';

      var fillsHtml;

      if (isMulti) {
        fillsHtml = segs.map(function (seg) {
          var pct   = Math.min(100, Math.max(0, Number(seg.value) || 0));
          var color = colorToken(seg.color || 'accent');
          var label = seg.label ? seg.label : '';
          return (
            '<div class="lex-pb-fill ' + animClass + '"' +
            ' style="width:' + pct + '%;background:' + color + ';"' +
            (label ? ' title="' + _escAttr(label) + ': ' + pct + '%"' : '') +
            '></div>'
          );
        }).join('');
      } else {
        var pct   = Math.min(100, Math.max(0, Number(this.value) || 0));
        var color = colorToken(this.color);
        fillsHtml = (
          '<div class="lex-pb-fill ' + animClass + '"' +
          ' style="width:' + pct + '%;background:' + color + ';"' +
          '></div>'
        );
      }

      return (
        '<div class="lex-pb-track ' + sizeClass + ' ' + modeClass + '"' +
        ' role="progressbar"' +
        (isMulti ? '' : ' aria-valuenow="' + Math.round(Number(this.value) || 0) + '" aria-valuemin="0" aria-valuemax="100"') +
        '>' +
        fillsHtml +
        '</div>'
      );
    }
  }

  // -------------------------------------------------------------------------
  // Attribute escaping helper (not on user content in innerHTML — used for
  // HTML attribute values in the track title attribute)
  // -------------------------------------------------------------------------

  function _escAttr(str) {
    return String(str)
      .split('&').join('&amp;')
      .split('"').join('&quot;')
      .split('<').join('&lt;')
      .split('>').join('&gt;');
  }

  defineLex('lex-progress-bar', LexProgressBar);

})();
