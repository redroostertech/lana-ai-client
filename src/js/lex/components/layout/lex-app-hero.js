/* Lex UI: App Hero
   The dark welcome banner at the top of an app's home page (Agents, Automate, Briefs,
   Insights): a small label, a two-line headline whose second line is the accent, one
   sentence, the page's actions, and on the right the app's LANA animation inside two
   rings with the app's steps around it.

   Usage:
     <lex-app-hero eyebrow="Agent Studio" heading="Turn repeat work into"
       accent="reliable outcomes." subtitle="Build an agent in a few guided steps..."
       animation="orbit" steps="Build,Run,Review">
       <lex-btn variant="primary" size="lg">Build an agent</lex-btn>
       <lex-btn variant="secondary" size="lg">Bring one from Claude</lex-btn>
     </lex-app-hero>

   Actions: primary and secondary buttons, a lex-dropdown-btn (floating) when one button
   offers several choices, and variant="ghost" for a quiet one such as "Take the walkthrough".
   Properties: eyebrow, heading, accent (the second line), subtitle, animation (a
   lex-brand-mark animation: orbit, flow, sync, chart, idle), steps (up to three short
   labels, comma separated). Changing a property updates the text in place; the
   actions you put inside stay the same live elements, so their listeners keep working.
   The animation and rings hide when the banner is narrow. Motion follows Reduce Motion
   (lex-brand-mark). Needs lex-brand-mark.js, lex-brand-animations.js and
   vendor/lottie_light.min.js for the animation.
*/

(function () {
  'use strict';

  const { LexElement, defineLex } = window.Lex;

  function injectStyles() {
    if (document.getElementById('lex-app-hero-styles')) return;
    const style = document.createElement('style');
    style.id = 'lex-app-hero-styles';
    style.textContent = `
      lex-app-hero { display: block; container-type: inline-size; }
      .lex-app-hero {
        position: relative;
        display: grid;
        grid-template-columns: minmax(0, 1.3fr) minmax(280px, 0.7fr);
        min-height: 360px;
        overflow: hidden;
        border-radius: var(--lex-radius-xl, 22px);
        background:
          radial-gradient(circle at 84% 42%, rgba(106, 196, 157, 0.16), transparent 15rem),
          linear-gradient(130deg, #111a16 0%, #1a2a23 62%, #263d33 100%);
        color: #f8faf8;
        box-shadow: 0 14px 40px rgba(14, 27, 21, 0.15);
      }
      .lex-app-hero::before {
        position: absolute; inset: 0; content: ''; pointer-events: none; opacity: 0.18;
        background-image:
          linear-gradient(rgba(255, 255, 255, 0.04) 1px, transparent 1px),
          linear-gradient(90deg, rgba(255, 255, 255, 0.04) 1px, transparent 1px);
        background-size: 34px 34px;
        mask-image: linear-gradient(90deg, black, transparent 75%);
      }
      .lex-app-hero-copy {
        position: relative; z-index: 2;
        display: flex; flex-direction: column; align-items: flex-start; justify-content: center;
        max-width: 720px;
        padding: clamp(32px, 5.5vw, 64px);
      }
      .lex-app-hero-eyebrow {
        color: #9ed9bd;
        font-size: 0.67rem; font-weight: 700; letter-spacing: 0.15em; text-transform: uppercase;
      }
      .lex-app-hero-heading {
        margin: 14px 0 16px;
        color: #f6f9f7;
        font-family: var(--lex-font-sans, system-ui, sans-serif);
        font-size: clamp(2.1rem, 4.4vw, 4rem);
        font-weight: 650; letter-spacing: -0.045em; line-height: 0.98;
      }
      .lex-app-hero-heading em { display: block; color: #a9d7c2; font-style: normal; font-weight: inherit; }
      .lex-app-hero-subtitle { max-width: 580px; margin: 0; color: #acb9b1; font-size: 0.94rem; line-height: 1.65; }
      .lex-app-hero-subtitle:empty { display: none; }
      .lex-app-hero-actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 26px; }
      .lex-app-hero-actions:empty, .lex-app-hero-actions slot-content:empty { display: none; }
      .lex-app-hero-actions slot-content { display: contents; }
      .lex-app-hero-actions lex-btn[variant="primary"] .lex-btn {
        border-color: #eff8f3; background: #eff8f3; color: #14241c;
      }
      .lex-app-hero-actions lex-btn[variant="secondary"] .lex-btn {
        border-color: rgba(255, 255, 255, 0.22); background: rgba(255, 255, 255, 0.05); color: #f4f8f5;
      }
      .lex-app-hero-actions lex-btn[variant="ghost"] .lex-btn-inner { background: transparent; color: #b8d6c7; }
      .lex-app-hero-actions lex-dropdown-btn .lex-ddbtn-trigger {
        padding: 0.625rem 1.5rem; font-size: var(--lex-body-base-size, 1rem); border-radius: var(--lex-btn-radius-lg, 13px);
      }
      .lex-app-hero-actions lex-btn[variant="ghost"] .lex-btn-inner:hover { background: rgba(255, 255, 255, 0.06); color: #f4f8f5; }
      .lex-app-hero-visual {
        position: relative; align-self: center; justify-self: center;
        width: min(30vw, 320px); height: min(30vw, 320px);
        min-width: 270px; min-height: 270px;
      }
      .lex-app-hero-ring { position: absolute; border-radius: 50%; border: 1px solid rgba(177, 221, 200, 0.2); }
      .lex-app-hero-ring--outer { inset: 10px; }
      .lex-app-hero-ring--inner { inset: 66px; border-color: rgba(177, 221, 200, 0.12); }
      .lex-app-hero-core {
        position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
        display: inline-flex; align-items: center; justify-content: center;
      }
      .lex-app-hero-step {
        position: absolute;
        display: inline-flex; align-items: center; justify-content: center;
        min-width: 64px; height: 28px; padding: 0 11px;
        border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 999px;
        background: rgba(11, 29, 20, 0.8);
        color: #b8c9bf; font-size: 0.64rem; letter-spacing: 0.06em; text-transform: uppercase;
        white-space: nowrap;
      }
      .lex-app-hero-step:nth-of-type(1) { top: 0; left: 50%; transform: translateX(-50%); }
      .lex-app-hero-step:nth-of-type(2) { right: 6px; bottom: 70px; }
      .lex-app-hero-step:nth-of-type(3) { left: 6px; bottom: 70px; }
      @container (max-width: 760px) {
        .lex-app-hero { grid-template-columns: minmax(0, 1fr); min-height: 0; }
        .lex-app-hero-visual { display: none; }
      }
    `;
    document.head.appendChild(style);
  }

  class LexAppHero extends LexElement {
    static get properties() {
      return {
        eyebrow:   { type: String, default: '' },
        heading:   { type: String, default: '' },
        accent:    { type: String, default: '' },
        subtitle:  { type: String, default: '' },
        animation: { type: String, default: 'idle' },
        steps:     { type: String, default: '' }
      };
    }

    render() {
      injectStyles();
      // Render once so the actions stay the same live nodes; updated() writes the text.
      if (this._rendered) return null;
      this._rendered = true;
      return `
        <section class="lex-app-hero">
          <div class="lex-app-hero-copy">
            <span class="lex-app-hero-eyebrow" data-part="eyebrow"></span>
            <h1 class="lex-app-hero-heading"><span data-part="heading"></span><em data-part="accent"></em></h1>
            <p class="lex-app-hero-subtitle" data-part="subtitle"></p>
            <div class="lex-app-hero-actions"><slot-content></slot-content></div>
          </div>
          <div class="lex-app-hero-visual" aria-hidden="true">
            <div class="lex-app-hero-ring lex-app-hero-ring--outer"></div>
            <div class="lex-app-hero-ring lex-app-hero-ring--inner"></div>
            <div class="lex-app-hero-core" data-part="core"></div>
            <div data-part="steps"></div>
          </div>
        </section>`;
    }

    // Place the authored actions once; later updates keep those live nodes.
    _restoreContent() {
      if (this._actionsPlaced) return;
      super._restoreContent();
      this._actionsPlaced = true;
      this._originalChildren = null;
    }

    updated() {
      const part = (name) => this.querySelector(`[data-part="${name}"]`);
      ['eyebrow', 'heading', 'accent', 'subtitle'].forEach((name) => {
        const el = part(name);
        if (el) el.textContent = this[name] || '';
      });
      const accent = part('accent');
      if (accent) accent.hidden = !this.accent;

      const core = part('core');
      if (core && core.dataset.animation !== this.animation) {
        core.dataset.animation = this.animation;
        core.innerHTML = `<lex-brand-mark animation="${this.escapeHtml(this.animation)}" size="168" variant="dark"></lex-brand-mark>`;
      }

      const stepsHost = part('steps');
      if (stepsHost) {
        const labels = String(this.steps || '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 3);
        stepsHost.style.display = 'contents';
        stepsHost.innerHTML = labels.map((label) => `<span class="lex-app-hero-step">${this.escapeHtml(label)}</span>`).join('');
      }
    }
  }

  defineLex('lex-app-hero', LexAppHero);
})();
