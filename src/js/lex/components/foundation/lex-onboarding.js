/* ==========================================================================
   Lex UI: <lex-onboarding>
   First-run onboarding tour, shown on the dashboard after login.

   Story: Hello, Own (private by design), Bring your work in, Verify (sources),
   Verify (flags mismatches), Bound (you make the call), then "Where would you
   like to start?", which takes the user to the real page for that first step.

   Decisions (where the user is, what to show on launch) come from
   window.LanaOnboardingFlow; persistence from window.LanaOnboardingState.
   Styles: css/lex-onboarding.css. Plan: docs/plans/onboarding-experience-plan.md.

   Usage (dashboard, after the user profile loads):
     Lex.Onboarding.launch();                  // shows only when appropriate
     Lex.Onboarding.launch({ replay: true });  // "Replay the tour"
   ========================================================================== */
(function () {
  'use strict';

  const { LexElement, defineLex } = window.Lex;
  const Flow = window.LanaOnboardingFlow;
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');

  const $ = (sel, root) => root.querySelector(sel);
  const $$ = (sel, root) => Array.from(root.querySelectorAll(sel));
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, motion.matches ? 0 : ms));
  const EASE_OUT = 'cubic-bezier(0.16, 1, 0.3, 1)';
  const EASE_SPRING = 'cubic-bezier(0.34, 1.56, 0.64, 1)';

  /** Web Animations wrapper that collapses to an instant change under reduced motion. */
  function animate(el, keyframes, options) {
    const opts = Object.assign({ fill: 'forwards' }, options);
    if (motion.matches) {
      opts.duration = 0;
      opts.delay = 0;
    }
    return el.animate(keyframes, opts).finished.catch(() => {});
  }

  function pop(el) {
    return animate(el, [
      { transform: 'scale(1)' },
      { transform: 'scale(1.18)', offset: 0.4 },
      { transform: 'scale(1)' },
    ], { duration: 420, easing: EASE_SPRING, fill: 'none' });
  }

  // Sample estate used to illustrate the shared value proposition.
  const FILES = {
    trust: {
      label: 'Smith Family Trust',
      meta: 'PDF, 14 pages',
      facts: [['Trust: Smith Family Revocable Trust', 'Trust, p. 1'], ['Trustees: Jane and John Smith', 'Trust, p. 2']],
    },
    brokerage: {
      label: 'Brokerage statement',
      meta: 'PDF, 3 pages',
      facts: [['Brokerage ending 4421: owned by Jane Smith', 'Statement, p. 1']],
    },
    ira: {
      label: 'IRA statement',
      meta: 'PDF, 2 pages',
      facts: [['IRA ending 9193: contingent beneficiary Robert Smith', 'Statement, p. 2']],
    },
  };

  const SCENE_IDS = Flow.SCENES.map((s) => s.id);
  const SCENE_TITLE = Object.fromEntries(Flow.SCENES.map((s) => [s.id, s.title]));

  class LexOnboarding extends LexElement {
    static get properties() {
      return {
        // Light by default to match the client; "dark" is the LANA AI media-kit look.
        theme: { type: String, default: 'light', reflect: true },
      };
    }

    /** Called by Lex.Onboarding.launch before the element is attached. */
    setup(opts) {
      this._store = opts.store;
      this._state = opts.state;
      this._decision = opts.decision;
      this._firstName = opts.firstName || 'there';
      this._steps = opts.steps;
    }

    render() {
      return null; // built once in connected(); never re-rendered mid-tour
    }

    connected() {
      if (this._built) return;
      this._built = true;
      this._sceneRun = 0;
      this._queue = Promise.resolve();
      this._current = null;
      this._open = false;
      this.innerHTML = this._template();
      this._wire();
      this._start();
    }

    disconnected() {
      this._release();
    }

    // ── Markup ────────────────────────────────────────────────────────────

    _template() {
      const e = (s) => this.escapeHtml(s);
      const files = Object.entries(FILES).map(([id, f]) =>
        `<li><button class="lob-file" type="button" draggable="true" data-file="${id}">
          <span class="lob-file__icon" aria-hidden="true"></span>
          <span class="lob-file__name">${e(f.label)}</span><small>${e(f.meta)}</small>
        </button></li>`).join('');
      const choices = this._steps.map((id) => {
        const s = Flow.FIRST_STEPS[id];
        return `<button class="lob-choice" type="button" role="radio" aria-checked="false" data-step="${id}">
          <span class="lob-choice__label">${e(s.label)}</span>
          <span class="lob-choice__detail">${e(s.detail)}</span>
          <span class="lob-choice__check" aria-hidden="true"></span>
        </button>`;
      }).join('');
      const note = '<p class="lob-note">Sample estate for illustration.</p>';

      return `
<div class="lob" role="dialog" aria-modal="true" aria-label="Welcome to LANA" hidden>
  <div class="lob__glow" aria-hidden="true"></div>
  <header class="lob__top">
    <div class="lob-wordmark" aria-label="LANA AI"><span>LANA AI</span></div>
    <button class="lob__skip" type="button" data-action="skip">Skip tour <kbd>Esc</kbd></button>
  </header>

  <div class="lob__stage">
    <section class="lob-scene lob-scene--hello" data-scene="hello" hidden>
      <div class="lob-hello__mark" aria-hidden="true">
        <span class="lob-hello__bracket lob-hello__bracket--tl"></span>
        <span class="lob-hello__word">LANA AI</span>
        <span class="lob-hello__bracket lob-hello__bracket--br"></span>
      </div>
      <h1 class="lob-title" tabindex="-1" data-stagger>Hi ${e(this._firstName)}. I'm <em>LANA</em>.</h1>
      <p class="lob-lede" data-stagger>Your firm's private AI workspace. Want a quick look around? It takes about two minutes.</p>
      <div class="lob-actions" data-stagger>
        <button class="lob-btn lob-btn--primary" type="button" data-action="next">Show me around</button>
        <button class="lob-btn lob-btn--ghost" type="button" data-action="skip">Skip, I'll explore</button>
      </div>
    </section>

    <section class="lob-scene" data-scene="own" hidden>
      <div class="lob-copy">
        <p class="lob-kicker" data-stagger>Own <span>the intelligence</span></p>
        <h1 class="lob-title" tabindex="-1" data-stagger>Your work stays <em>yours</em>.</h1>
        <p class="lob-lede" data-stagger>Tap each layer to see where your work goes.</p>
        <p class="lob-payoff" data-payoff>That's the idea. <em>You own it.</em></p>
      </div>
      <div class="lob-own" data-stagger>
        <div class="lob-own__rail" aria-hidden="true"><span class="lob-own__token"></span></div>
        <button class="lob-layer" type="button" data-layer="device" aria-expanded="false">
          <span class="lob-layer__name">This computer</span>
          <span class="lob-layer__body"><span>Routine work, like reading and sorting documents, happens right here.</span></span>
        </button>
        <button class="lob-layer" type="button" data-layer="firm" aria-expanded="false">
          <span class="lob-layer__name">Your firm's space</span>
          <span class="lob-layer__body"><span>Your matters and records live in a space that belongs to your firm alone.</span></span>
        </button>
        <button class="lob-layer" type="button" data-layer="reasoning" aria-expanded="false">
          <span class="lob-layer__name">Reasoning</span>
          <span class="lob-layer__body"><span>When I need to think harder, I borrow reasoning power. It keeps nothing and never trains on your work.</span></span>
        </button>
      </div>
    </section>

    <section class="lob-scene" data-scene="bring" hidden>
      <div class="lob-copy">
        <p class="lob-kicker" data-stagger>Own <span>your matters</span></p>
        <h1 class="lob-title" tabindex="-1" data-stagger>Bring your work <em>in</em>.</h1>
        <p class="lob-lede" data-stagger>Drag a document into the Smith matter, or just click it.</p>
        <p class="lob-payoff" data-payoff>I keep every fact tied to <em>where it came from</em>.</p>
      </div>
      <div class="lob-bring" data-stagger>
        <ul class="lob-bring__files" aria-label="Sample documents">${files}</ul>
        <div class="lob-matter" data-drop>
          <div class="lob-matter__head">
            <span class="lob-matter__name">Smith Family Estate</span>
            <span class="lob-matter__count" data-count>No documents yet</span>
          </div>
          <ul class="lob-matter__facts" data-facts aria-live="polite"></ul>
          <p class="lob-matter__hint" data-hint>Drop documents here</p>
        </div>
      </div>
      ${note}
    </section>

    <section class="lob-scene" data-scene="verify" hidden>
      <div class="lob-copy">
        <p class="lob-kicker" data-stagger>Verify <span>the outcome</span></p>
        <h1 class="lob-title" tabindex="-1" data-stagger>Every answer shows its <em>source</em>.</h1>
        <p class="lob-lede" data-stagger>Ask a question, then tap the citation.</p>
        <p class="lob-payoff" data-payoff>No guessing where it came from. <em>Check it yourself.</em></p>
      </div>
      <div class="lob-verify" data-stagger>
        <div class="lob-chat">
          <button class="lob-ask" type="button" data-action="ask">Ask: Who owns the brokerage account?</button>
          <div class="lob-bubble lob-bubble--me" data-bubble="question" hidden>Who owns the brokerage account?</div>
          <div class="lob-bubble lob-bubble--lana" data-bubble="answer" hidden>
            <span class="lob-typing" aria-hidden="true"><i></i><i></i><i></i></span>
            <span class="lob-bubble__text"></span>
            <button class="lob-cite" type="button" data-action="cite" hidden>Brokerage statement, p. 1</button>
          </div>
        </div>
        <div class="lob-doc" data-doc hidden>
          <div class="lob-doc__head">Brokerage statement <small>Page 1 of 3</small></div>
          <div class="lob-doc__line lob-doc__line--w80"></div>
          <div class="lob-doc__line lob-doc__line--w60"></div>
          <div class="lob-doc__real"><span>Account number</span><span>XXXX-4421</span></div>
          <div class="lob-doc__real lob-doc__real--hit" data-hit><span>Account owner</span><span>JANE SMITH, INDIVIDUAL</span></div>
          <div class="lob-doc__line lob-doc__line--w90"></div>
          <div class="lob-doc__line lob-doc__line--w70"></div>
        </div>
      </div>
      ${note}
    </section>

    <section class="lob-scene" data-scene="flag" hidden>
      <div class="lob-copy">
        <p class="lob-kicker" data-stagger>Verify <span>nothing quietly fixed</span></p>
        <h1 class="lob-title" tabindex="-1" data-stagger>I flag what doesn't <em>line up</em>.</h1>
        <p class="lob-lede" data-stagger>The beneficiary form was sent. Try marking it done.</p>
        <p class="lob-payoff" data-payoff>Sent isn't the same as done. <em>I'll wait for proof.</em></p>
      </div>
      <div class="lob-flag" data-stagger>
        <div class="lob-tray" data-tray aria-live="polite">Needs you <span class="lob-tray__badge" data-badge>0</span></div>
        <div class="lob-compare">
          <div class="lob-compare__card">
            <p class="lob-compare__label">The plan says</p>
            <p class="lob-compare__item">IRA ending 9193</p>
            <dl>
              <div><dt>Primary</dt><dd>Jane Smith</dd></div>
              <div class="lob-compare__row"><dt>Contingent</dt><dd>Smith Descendants Trust</dd></div>
            </dl>
          </div>
          <div class="lob-compare__card">
            <p class="lob-compare__label">The record shows</p>
            <p class="lob-compare__item">IRA ending 9193</p>
            <dl>
              <div><dt>Primary</dt><dd>Jane Smith</dd></div>
              <div class="lob-compare__row"><dt>Contingent</dt><dd>Robert Smith</dd></div>
            </dl>
          </div>
        </div>
        <div class="lob-flag__status">
          <span>Beneficiary change form: <strong>sent</strong></span>
          <button class="lob-btn lob-btn--primary lob-btn--sm" type="button" data-action="mark-done">Mark as done</button>
        </div>
        <p class="lob-says" data-says hidden></p>
      </div>
      ${note}
    </section>

    <section class="lob-scene" data-scene="decide" hidden>
      <div class="lob-copy">
        <p class="lob-kicker" data-stagger>Bound <span>the action</span></p>
        <h1 class="lob-title" tabindex="-1" data-stagger>You make the <em>call</em>.</h1>
        <p class="lob-lede" data-stagger>I prepare the work. Nothing moves without you.</p>
        <p class="lob-payoff lob-doctrine" data-payoff>
          <span><b>Own</b> the intelligence.</span>
          <span><b>Verify</b> the outcome.</span>
          <span><b>Bound</b> the action.</span>
        </p>
      </div>
      <div class="lob-decide" data-stagger>
        <div class="lob-review">
          <p class="lob-review__label">Needs you</p>
          <p class="lob-review__title">IRA beneficiary mismatch</p>
          <p class="lob-review__body">I drafted a request asking the custodian for an updated beneficiary confirmation.</p>
          <div class="lob-review__actions">
            <button class="lob-btn lob-btn--primary lob-btn--sm" type="button" data-action="approve">Approve</button>
            <button class="lob-btn lob-btn--ghost lob-btn--sm" type="button" data-action="hold">Not now</button>
          </div>
          <div class="lob-stamp" data-stamp aria-hidden="true">Approved</div>
        </div>
        <ol class="lob-history" data-history aria-label="History" aria-live="polite">
          <li><span>LANA prepared a request</span><small>just now</small></li>
        </ol>
      </div>
      ${note}
    </section>

    <section class="lob-scene lob-scene--start" data-scene="start" hidden>
      <div class="lob-copy">
        <h1 class="lob-title" tabindex="-1" data-stagger>Where would you like to <em>start</em>?</h1>
        <p class="lob-lede" data-stagger>Pick one and I'll take you there.</p>
      </div>
      <div class="lob-choices" role="radiogroup" aria-label="First step" data-stagger>${choices}</div>
      <button class="lob-btn lob-btn--link" type="button" data-action="explore">I'll explore on my own</button>
    </section>
  </div>

  <footer class="lob__nav">
    <button class="lob-btn lob-btn--ghost lob-btn--sm" type="button" data-action="back">Back</button>
    <ol class="lob-dots" aria-label="Tour progress"></ol>
    <button class="lob-btn lob-btn--primary lob-btn--sm" type="button" data-action="next" data-next>Next</button>
  </footer>
  <p class="lob-sr" aria-live="polite" data-live></p>
</div>

<div class="lob-resume" role="dialog" aria-labelledby="lob-resume-title" hidden>
  <h2 id="lob-resume-title">Pick up where you left off?</h2>
  <p>You were partway through the tour.</p>
  <div class="lob-resume__actions">
    <button class="lob-btn lob-btn--primary lob-btn--sm" type="button" data-resume="yes">Resume</button>
    <button class="lob-btn lob-btn--ghost lob-btn--sm" type="button" data-resume="no">No thanks</button>
  </div>
</div>`;
    }

    // ── State ─────────────────────────────────────────────────────────────

    _dispatch(event) {
      const next = Flow.reduce(this._state, event);
      if (next === this._state) return;
      const prev = this._state;
      this._state = next;
      this._store.save(next);

      if (this._open && next.status === Flow.STATUS.IN_PROGRESS && prev.scene !== next.scene) {
        const dir = SCENE_IDS.indexOf(next.scene) > SCENE_IDS.indexOf(prev.scene) ? 1 : -1;
        this._queueScene(next.scene, dir);
      }
      if (this._open) this._renderNav();
      if (prev.firstStep !== next.firstStep) this._renderChoices();
      if (prev.status === Flow.STATUS.IN_PROGRESS && next.status !== Flow.STATUS.IN_PROGRESS) {
        this._finish();
      }
    }

    _start() {
      switch (this._decision) {
        case 'show':
          this._dispatch({ type: 'START' });
          this._openTour();
          break;
        case 'replay':
          if (this._state.status === Flow.STATUS.IN_PROGRESS) this._dispatch({ type: 'GOTO', scene: SCENE_IDS[0] });
          else this._dispatch({ type: 'REPLAY' });
          this._openTour();
          break;
        case 'offer-resume': {
          this._dispatch({ type: 'RESUME_OFFERED' });
          const card = $('.lob-resume', this);
          card.hidden = false;
          animate(card, [{ opacity: 0, transform: 'translateY(12px)' }, { opacity: 1, transform: 'none' }], { duration: 420, easing: EASE_OUT });
          $('[data-resume="yes"]', card).focus();
          break;
        }
        default:
          this.remove();
      }
    }

    // ── Open / close ──────────────────────────────────────────────────────

    _openTour() {
      const root = $('.lob', this);
      this._open = true;
      root.hidden = false;
      this._lock();
      animate(root, [{ opacity: 0 }, { opacity: 1 }], { duration: 420, easing: 'ease-out' });
      this._current = null;
      this._queueScene(this._state.scene, 1);
      this._renderNav();
    }

    async _finish() {
      const root = $('.lob', this);
      this._open = false;
      this._sceneRun += 1;
      if (!root.hidden) {
        await animate(root, [{ opacity: 1 }, { opacity: 0 }], { duration: 360, easing: 'ease-in' });
      }
      this._release();

      const state = this._state;
      if (state.status === Flow.STATUS.SKIPPED) {
        this._toast("No problem. You can replay the tour anytime from your profile menu.");
        this.remove();
        return;
      }
      const step = !this._explore && state.firstStep ? Flow.FIRST_STEPS[state.firstStep] : null;
      this.remove();
      if (step && step.href && window.Lex.Nav) {
        window.Lex.Nav.go(step.href);
        return;
      }
      if (step && step.opens === 'dock') {
        const dock = document.querySelector('lex-lana-dock');
        if (dock && typeof dock.openWith === 'function') dock.openWith({});
      }
      this._toast("You're all set. I'm here whenever you need me.");
    }

    /** Keep the rest of the app out of reach while the tour is open. */
    _lock() {
      if (window.Lex.ScrollLock) window.Lex.ScrollLock.lock();
      this._inerted = Array.from(document.body.children).filter((n) => n !== this && !n.inert);
      this._inerted.forEach((n) => { n.inert = true; });
      this._previousFocus = document.activeElement;
      this._releaseTrap = window.Lex.FocusTrap ? window.Lex.FocusTrap.activate($('.lob', this)) : null;
      this._onKey = (e) => this._handleKey(e);
      document.addEventListener('keydown', this._onKey, true);
    }

    _release() {
      if (!this._onKey) return;
      document.removeEventListener('keydown', this._onKey, true);
      this._onKey = null;
      if (this._releaseTrap) this._releaseTrap();
      this._releaseTrap = null;
      (this._inerted || []).forEach((n) => { n.inert = false; });
      this._inerted = null;
      if (window.Lex.ScrollLock) window.Lex.ScrollLock.unlock();
      if (this._previousFocus && typeof this._previousFocus.focus === 'function') this._previousFocus.focus();
    }

    _toast(message) {
      if (window.Lex.Toast) window.Lex.Toast.info(message);
    }

    // ── Scenes ────────────────────────────────────────────────────────────

    _queueScene(id, dir) {
      this._queue = this._queue.then(() => this._showScene(id, dir));
    }

    async _showScene(id, dir) {
      if (!this._open) return;
      const run = (this._sceneRun += 1);
      const incoming = $(`[data-scene="${id}"]`, this);
      const outgoing = this._current ? $(`[data-scene="${this._current}"]`, this) : null;

      if (outgoing && outgoing !== incoming) {
        await animate(outgoing, [
          { opacity: 1, transform: 'translateX(0)' },
          { opacity: 0, transform: `translateX(${-28 * dir}px)` },
        ], { duration: 200, easing: 'cubic-bezier(0.4, 0, 1, 1)' });
        outgoing.hidden = true;
        outgoing.getAnimations().forEach((a) => a.cancel());
      }
      if (run !== this._sceneRun) return;

      this._current = id;
      incoming.hidden = false;
      incoming.getAnimations().forEach((a) => a.cancel());
      this._enter(id, incoming);

      $$('[data-stagger]', incoming).forEach((child, i) => {
        // 'backwards' holds the first frame during the delay and leaves no transform behind.
        animate(child, [
          { opacity: 0, transform: `translate(${18 * dir}px, 10px)` },
          { opacity: 1, transform: 'translate(0, 0)' },
        ], { duration: 520, delay: 70 * i, easing: EASE_OUT, fill: 'backwards' });
      });

      const title = $('.lob-title', incoming);
      if (title) title.focus({ preventScroll: true });
      const p = Flow.progress(this._state);
      $('[data-live]', this).textContent = p ? `${SCENE_TITLE[id]}. Step ${p.step} of ${p.total}.` : SCENE_TITLE[id];
    }

    _renderNav() {
      const p = Flow.progress(this._state);
      const nav = $('.lob__nav', this);
      // Hidden with the attribute (not visibility) so focus trapping skips them.
      Array.from(nav.children).forEach((child) => { child.hidden = !p; });
      const next = $('[data-next]', this);
      next.classList.remove('is-nudge');
      if (this._state.scene === 'start') {
        next.textContent = 'Take me there';
        next.disabled = !this._state.firstStep;
      } else {
        next.textContent = 'Next';
        next.disabled = false;
      }
      const dots = $('.lob-dots', this);
      if (!dots.children.length) {
        SCENE_IDS.slice(1).forEach((id, i) => {
          const li = document.createElement('li');
          li.innerHTML = `<button type="button" data-goto="${id}" aria-label="Step ${i + 1}: ${this.escapeHtml(SCENE_TITLE[id])}"></button>`;
          dots.appendChild(li);
        });
      }
      $$('[data-goto]', dots).forEach((dot) => {
        const id = dot.dataset.goto;
        const visited = this._state.visited.includes(id);
        dot.disabled = !visited || id === this._state.scene;
        dot.classList.toggle('is-visited', visited);
        if (id === this._state.scene) dot.setAttribute('aria-current', 'step');
        else dot.removeAttribute('aria-current');
      });
    }

    _renderChoices() {
      const choices = $$('.lob-choice', this);
      choices.forEach((choice, i) => {
        const checked = choice.dataset.step === this._state.firstStep;
        choice.setAttribute('aria-checked', String(checked));
        choice.tabIndex = checked || (!this._state.firstStep && i === 0) ? 0 : -1;
      });
      if (this._open && this._state.scene === 'start') this._renderNav();
    }

    _nudgeNext() {
      $('[data-next]', this).classList.add('is-nudge');
    }

    _payoff(scene, shown) {
      const el = $('[data-payoff]', scene);
      if (el) el.classList.toggle('is-shown', shown);
    }

    async _type(target, text, run) {
      target.textContent = '';
      if (motion.matches) {
        target.textContent = text;
        return true;
      }
      for (let i = 0; i < text.length; i += 1) {
        if (run !== this._sceneRun) return false;
        target.textContent += text[i];
        await wait(text[i] === ' ' ? 10 : 18);
      }
      return true;
    }

    /** Move a temporary copy of `from` onto `to`, then remove it. */
    _fly(from, to, className, label) {
      const a = from.getBoundingClientRect();
      const b = to.getBoundingClientRect();
      const ghost = document.createElement('div');
      ghost.className = `lob-fly ${className}`;
      ghost.textContent = label;
      this.appendChild(ghost);
      const g = ghost.getBoundingClientRect();
      const x0 = a.left + a.width / 2 - g.width / 2;
      const y0 = a.top + a.height / 2 - g.height / 2;
      const x1 = b.left + b.width / 2 - g.width / 2;
      const y1 = b.top + b.height / 2 - g.height / 2;
      return animate(ghost, [
        { transform: `translate(${x0}px, ${y0}px) scale(1)`, opacity: 1 },
        { transform: `translate(${(x0 + x1) / 2}px, ${Math.min(y0, y1) - 40}px) scale(0.9)`, opacity: 1, offset: 0.55 },
        { transform: `translate(${x1}px, ${y1}px) scale(0.5)`, opacity: 0 },
      ], { duration: 640, easing: 'cubic-bezier(0.45, 0, 0.2, 1)' }).then(() => ghost.remove());
    }

    /** A small burst of LANA corner brackets. Skipped under reduced motion. */
    _celebrate(origin, count) {
      if (motion.matches || !origin) return;
      const r = origin.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      for (let i = 0; i < count; i += 1) {
        const spark = document.createElement('span');
        spark.className = i % 3 === 0 ? 'lob-spark lob-spark--ink' : 'lob-spark';
        this.appendChild(spark);
        const angle = (Math.PI * 2 * i) / count + Math.random() * 0.5;
        const dist = 50 + Math.random() * 110;
        spark.animate([
          { transform: `translate(${cx}px, ${cy}px) rotate(0deg) scale(0.6)`, opacity: 1 },
          { transform: `translate(${cx + Math.cos(angle) * dist}px, ${cy + Math.sin(angle) * dist}px) rotate(${(Math.random() - 0.5) * 360}deg) scale(1)`, opacity: 0 },
        ], { duration: 700 + Math.random() * 300, easing: EASE_OUT, fill: 'forwards' })
          .finished.then(() => spark.remove(), () => spark.remove());
      }
    }

    /** Reset a scene to its starting state each time it is entered. */
    _enter(id, scene) {
      this._payoff(scene, false);
      if (id === 'hello') {
        // Each bracket draws outward from its corner.
        [['.lob-hello__bracket--tl', 'inset(0 100% 100% 0)'], ['.lob-hello__bracket--br', 'inset(100% 0 0 100%)']].forEach(([sel, from], i) => {
          const bracket = $(sel, scene);
          bracket.getAnimations().forEach((a) => a.cancel());
          animate(bracket, [{ clipPath: from }, { clipPath: 'inset(0 0 0 0)' }], {
            duration: 900, delay: 250 + i * 180, easing: 'cubic-bezier(0.65, 0, 0.35, 1)', fill: 'both',
          });
        });
        animate($('.lob-hello__word', scene), [
          { opacity: 0, letterSpacing: '1.1em', filter: 'blur(6px)' },
          { opacity: 1, letterSpacing: '0.6em', filter: 'blur(0)' },
        ], { duration: 1100, delay: 120, easing: EASE_OUT });
      } else if (id === 'own') {
        this._opened = new Set();
        $$('.lob-layer', scene).forEach((l) => l.setAttribute('aria-expanded', 'false'));
        const token = $('.lob-own__token', scene);
        token.getAnimations().forEach((a) => a.cancel());
        requestAnimationFrame(() => {
          this._tokenY = this._layerY(scene, 'device');
          animate(token, [{ transform: `translateY(${this._tokenY}px)`, opacity: 1 }], { duration: 0 });
        });
      } else if (id === 'bring') {
        this._ingested = new Set();
        $$('.lob-file', scene).forEach((f) => { f.disabled = false; });
        $('[data-facts]', scene).replaceChildren();
        $('[data-count]', scene).textContent = 'No documents yet';
        $('[data-hint]', scene).hidden = false;
        $('[data-drop]', scene).classList.remove('has-docs', 'is-over');
      } else if (id === 'verify') {
        $('[data-action="ask"]', scene).hidden = false;
        $('[data-bubble="question"]', scene).hidden = true;
        $('[data-bubble="answer"]', scene).hidden = true;
        $('.lob-bubble__text', scene).textContent = '';
        $('.lob-typing', scene).hidden = false;
        $('[data-action="cite"]', scene).hidden = true;
        $('[data-doc]', scene).hidden = true;
        $('[data-hit]', scene).classList.remove('is-lit');
      } else if (id === 'flag') {
        $('[data-action="mark-done"]', scene).disabled = false;
        $$('.lob-compare__row', scene).forEach((r) => r.classList.remove('is-flagged'));
        const says = $('[data-says]', scene);
        says.hidden = true;
        says.textContent = '';
        $('[data-tray]', scene).classList.remove('has-items');
        $('[data-badge]', scene).textContent = '0';
      } else if (id === 'decide') {
        $$('.lob-review__actions button', scene).forEach((b) => { b.disabled = false; });
        $('.lob-review', scene).classList.remove('is-approved');
        const stamp = $('[data-stamp]', scene);
        stamp.getAnimations().forEach((a) => a.cancel());
        const history = $('[data-history]', scene);
        while (history.children.length > 1) history.lastElementChild.remove();
      } else if (id === 'start') {
        this._renderChoices();
      }
    }

    _layerY(scene, name) {
      const rail = $('.lob-own__rail', scene);
      const layer = $(`[data-layer="${name}"]`, scene);
      return layer.offsetTop + 26 - rail.offsetTop - 6;
    }

    async _toggleLayer(layer) {
      const scene = $('[data-scene="own"]', this);
      const open = layer.getAttribute('aria-expanded') !== 'true';
      layer.setAttribute('aria-expanded', String(open));
      if (!open) return;
      const name = layer.dataset.layer;
      this._opened.add(name);
      const token = $('.lob-own__token', scene);
      const to = this._layerY(scene, name);
      await animate(token, [
        { transform: `translateY(${this._tokenY}px)`, opacity: 1 },
        { transform: `translateY(${to}px)`, opacity: 1 },
      ], { duration: 520, easing: 'cubic-bezier(0.65, 0, 0.35, 1)' });
      this._tokenY = to;
      if (name === 'reasoning') {
        // Reasoning keeps nothing: the token dissolves, then a fresh one returns home.
        await animate(token, [
          { transform: `translateY(${to}px) scale(1)`, opacity: 1, filter: 'blur(0)' },
          { transform: `translateY(${to}px) scale(2.6)`, opacity: 0, filter: 'blur(4px)' },
        ], { duration: 520, easing: 'ease-out' });
        this._tokenY = this._layerY(scene, 'device');
        await animate(token, [
          { transform: `translateY(${this._tokenY}px) scale(0.4)`, opacity: 0 },
          { transform: `translateY(${this._tokenY}px) scale(1)`, opacity: 1 },
        ], { duration: 360, delay: 120, easing: EASE_SPRING });
      }
      if (this._opened.size === 3) {
        this._payoff(scene, true);
        this._nudgeNext();
      }
    }

    async _ingest(id) {
      if (!FILES[id] || this._ingested.has(id)) return;
      this._ingested.add(id);
      const run = this._sceneRun;
      const scene = $('[data-scene="bring"]', this);
      const tile = $(`[data-file="${id}"]`, scene);
      const matter = $('[data-drop]', scene);
      tile.disabled = true;
      await this._fly(tile, matter, 'lob-file', FILES[id].label);
      if (run !== this._sceneRun) return;
      matter.classList.add('has-docs');
      $('[data-hint]', scene).hidden = true;
      pop(matter);
      for (const [text, source] of FILES[id].facts) {
        const li = document.createElement('li');
        li.className = 'lob-fact';
        li.append(text);
        const small = document.createElement('small');
        small.textContent = source;
        li.appendChild(small);
        $('[data-facts]', scene).appendChild(li);
        animate(li, [{ opacity: 0, transform: 'translateY(-6px) scale(0.96)' }, { opacity: 1, transform: 'none' }], { duration: 380, easing: EASE_SPRING });
        await wait(140);
      }
      const docs = this._ingested.size;
      const facts = $$('.lob-fact', scene).length;
      $('[data-count]', scene).textContent = `${docs} document${docs > 1 ? 's' : ''}, ${facts} facts`;
      if (docs === Object.keys(FILES).length) {
        this._payoff(scene, true);
        this._nudgeNext();
      }
    }

    async _ask() {
      const run = this._sceneRun;
      const scene = $('[data-scene="verify"]', this);
      $('[data-action="ask"]', scene).hidden = true;
      const q = $('[data-bubble="question"]', scene);
      q.hidden = false;
      animate(q, [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 320, easing: EASE_OUT });
      await wait(300);
      const a = $('[data-bubble="answer"]', scene);
      a.hidden = false;
      animate(a, [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 320, easing: EASE_OUT });
      await wait(900);
      if (run !== this._sceneRun) return;
      $('.lob-typing', scene).hidden = true;
      const done = await this._type($('.lob-bubble__text', scene), 'The brokerage account ending 4421 is owned by Jane Smith, individually. It is not in the trust yet.', run);
      if (!done) return;
      const cite = $('[data-action="cite"]', scene);
      cite.hidden = false;
      cite.classList.add('is-nudge');
      animate(cite, [{ opacity: 0, transform: 'scale(0.9)' }, { opacity: 1, transform: 'scale(1)' }], { duration: 300, easing: EASE_SPRING });
    }

    async _cite(button) {
      const run = this._sceneRun;
      const scene = $('[data-scene="verify"]', this);
      button.classList.remove('is-nudge');
      const doc = $('[data-doc]', scene);
      if (!doc.hidden) return;
      doc.hidden = false;
      await animate(doc, [{ opacity: 0, transform: 'translateY(16px) scale(0.98)' }, { opacity: 1, transform: 'none' }], { duration: 460, easing: EASE_OUT });
      if (run !== this._sceneRun) return;
      $('[data-hit]', scene).classList.add('is-lit');
      await wait(500);
      this._payoff(scene, true);
      this._nudgeNext();
    }

    async _markDone(button) {
      const run = this._sceneRun;
      const scene = $('[data-scene="flag"]', this);
      button.disabled = true;
      animate(button, [
        { transform: 'translateX(0)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(5px)' },
        { transform: 'translateX(-3px)' }, { transform: 'translateX(0)' },
      ], { duration: 360, easing: 'ease-in-out', fill: 'none' });
      const rows = $$('.lob-compare__row', scene);
      rows.forEach((row) => { row.classList.add('is-flagged'); pop(row); });
      const says = $('[data-says]', scene);
      says.hidden = false;
      const done = await this._type(says, "Not yet. The form was sent, but the record still shows Robert Smith. I'll wait for proof, and I won't quietly change anything.", run);
      if (!done) return;
      await wait(250);
      if (run !== this._sceneRun) return;
      const tray = $('[data-tray]', scene);
      await this._fly(rows[1], tray, 'lob-flag-chip', 'Beneficiary mismatch');
      if (run !== this._sceneRun) return;
      tray.classList.add('has-items');
      $('[data-badge]', scene).textContent = '1';
      pop($('[data-badge]', scene));
      this._payoff(scene, true);
      this._nudgeNext();
    }

    async _decide(kind) {
      const run = this._sceneRun;
      const scene = $('[data-scene="decide"]', this);
      $$('.lob-review__actions button', scene).forEach((b) => { b.disabled = true; });
      const stamp = $('[data-stamp]', scene);
      stamp.textContent = kind === 'approve' ? 'Approved' : 'On hold';
      if (kind === 'approve') $('.lob-review', scene).classList.add('is-approved');
      await animate(stamp, [
        { opacity: 0, transform: 'translateY(-50%) rotate(-18deg) scale(1.9)' },
        { opacity: 1, transform: 'translateY(-50%) rotate(-8deg) scale(0.94)', offset: 0.7 },
        { opacity: 1, transform: 'translateY(-50%) rotate(-8deg) scale(1)' },
      ], { duration: 420, easing: 'cubic-bezier(0.2, 0.9, 0.3, 1)' });
      if (run !== this._sceneRun) return;
      if (kind === 'approve') this._celebrate(stamp, 10);
      const li = document.createElement('li');
      li.className = 'is-you';
      li.innerHTML = `<span>${kind === 'approve' ? 'You approved the request' : 'You held it for later'}</span><small>just now</small>`;
      $('[data-history]', scene).appendChild(li);
      animate(li, [{ opacity: 0, transform: 'translateY(-8px)' }, { opacity: 1, transform: 'none' }], { duration: 360, easing: EASE_OUT });
      await wait(400);
      if (run !== this._sceneRun) return;
      this._payoff(scene, true);
      this._nudgeNext();
    }

    _goNext() {
      if (this._state.scene !== 'start') {
        this._dispatch({ type: 'NEXT' });
        return;
      }
      if (!this._state.firstStep) return;
      this._celebrate($('[data-next]', this), 22);
      wait(450).then(() => this._dispatch({ type: 'FINISH' }));
    }

    // ── Input ─────────────────────────────────────────────────────────────

    _wire() {
      this.addEventListener('click', (e) => {
        const t = e.target.closest('[data-action], [data-layer], [data-file], [data-goto], [data-step], [data-resume]');
        if (!t || !this.contains(t)) return;
        if (t.dataset.layer) return this._toggleLayer(t);
        if (t.dataset.file) return this._ingest(t.dataset.file);
        if (t.dataset.goto) return this._dispatch({ type: 'GOTO', scene: t.dataset.goto });
        if (t.dataset.step) {
          this._dispatch({ type: 'CHOOSE_FIRST_STEP', step: t.dataset.step });
          pop(t);
          return this._nudgeNext();
        }
        if (t.dataset.resume) return this._resume(t.dataset.resume === 'yes');
        switch (t.dataset.action) {
          case 'next': return this._goNext();
          case 'back': return this._dispatch({ type: 'BACK' });
          case 'skip': return this._dispatch({ type: 'SKIP' });
          case 'ask': return this._ask();
          case 'cite': return this._cite(t);
          case 'mark-done': return this._markDone(t);
          case 'approve': return this._decide('approve');
          case 'hold': return this._decide('hold');
          case 'explore':
            this._explore = true;
            return this._dispatch({ type: 'FINISH' });
          default: return undefined;
        }
      });

      $$('.lob-file', this).forEach((tile) => {
        tile.addEventListener('dragstart', (e) => {
          e.dataTransfer.setData('text/plain', tile.dataset.file);
          e.dataTransfer.effectAllowed = 'copy';
        });
      });
      const drop = $('[data-drop]', this);
      drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('is-over'); });
      drop.addEventListener('dragleave', () => drop.classList.remove('is-over'));
      drop.addEventListener('drop', (e) => {
        e.preventDefault();
        drop.classList.remove('is-over');
        this._ingest(e.dataTransfer.getData('text/plain'));
      });

      // Radio-group arrow keys on the first-step choices.
      $('.lob-choices', this).addEventListener('keydown', (e) => {
        if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].indexOf(e.key) === -1) return;
        e.preventDefault();
        e.stopPropagation();
        const items = $$('.lob-choice', this);
        const i = items.indexOf(document.activeElement);
        const delta = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1;
        const target = items[(i + delta + items.length) % items.length];
        target.focus();
        target.click();
      });
    }

    _handleKey(e) {
      if (!this._open) return;
      const inChoices = e.target && e.target.closest && e.target.closest('.lob-choices');
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this._dispatch({ type: 'SKIP' });
      } else if (e.key === 'ArrowRight' && !inChoices && Flow.progress(this._state)) {
        e.preventDefault();
        if (!$('[data-next]', this).disabled) this._goNext();
      } else if (e.key === 'ArrowLeft' && !inChoices && Flow.progress(this._state)) {
        e.preventDefault();
        this._dispatch({ type: 'BACK' });
      }
    }

    _resume(yes) {
      $('.lob-resume', this).hidden = true;
      if (yes) this._openTour();
      else this._dispatch({ type: 'RESUME_DECLINED' });
    }
  }

  defineLex('lex-onboarding', LexOnboarding);

  // ── Launcher ────────────────────────────────────────────────────────────

  function localStore() {
    try {
      return window.localStorage;
    } catch (e) {
      return null;
    }
  }

  window.Lex.Onboarding = {
    /**
     * Show the tour when the flow says so (new user, or resume once), or always
     * when `replay` is set. Safe to call more than once per page.
     */
    async launch(opts) {
      const replay = !!(opts && opts.replay);
      const user = window.api && window.api.user;
      if (!user || document.querySelector('lex-onboarding')) return;

      const auth = window.Lex.Auth;
      const store = window.LanaOnboardingState.createOnboardingStore({ storage: localStore(), userId: user.id });
      const state = Flow.normalize(store.load());
      const decision = replay ? 'replay' : Flow.launchDecision(state);
      if (decision === 'none' || document.querySelector('lex-onboarding')) return;

      const el = document.createElement('lex-onboarding');
      el.setup({
        store,
        state,
        decision,
        firstName: String(user.firstName || user.first_name || '').trim(),
        steps: Flow.availableFirstSteps({
          isAdmin: auth ? auth.isAdmin() : false,
          // Exactly org_admin or system_admin: the roles the server lets create users.
          isUserAdmin: auth ? auth.canAccessAdminPages() : false,
        }),
      });
      document.body.appendChild(el);
    },
  };
})();
