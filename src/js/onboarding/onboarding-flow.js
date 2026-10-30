/**
 * LANA onboarding flow: pure state machine, scene definitions and first-step
 * destinations.
 *
 * No DOM access. Used by <lex-onboarding> and unit tested in
 * tests/unit/onboarding-flow.test.js.
 *
 * Persisted shape (one record per user, stored server-side in the app):
 *   { status, version, scene, visited, firstStep, resumeOffered,
 *     checklistDismissed, completedAt, skippedAt }
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.LanaOnboardingFlow = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const FLOW_VERSION = 1;

  const STATUS = Object.freeze({
    NOT_STARTED: 'not_started',
    IN_PROGRESS: 'in_progress',
    COMPLETED: 'completed',
    SKIPPED: 'skipped',
  });

  // Scene order is the story. Ids are persisted, so rename with care.
  const SCENES = Object.freeze([
    { id: 'hello', title: 'Hello' },
    { id: 'own', title: 'Your work stays yours' },
    { id: 'bring', title: 'Bring your work in' },
    { id: 'verify', title: 'Every answer shows its source' },
    { id: 'flag', title: 'I flag what does not line up' },
    { id: 'decide', title: 'You make the call' },
    { id: 'start', title: 'Where would you like to start?' },
  ]);

  /*
   * Where each first step takes the user. `href` is a client page; `opens: 'dock'`
   * opens the Ask LANA dock on the current page instead of navigating.
   * `audience` is UI gating only (the server enforces access):
   *   all        everyone
   *   admin      admin roles that see Data Connectors in the sidebar
   *   member     everyone who is not an admin (library instead of connectors)
   *   user_admin org_admin or system_admin only, the roles the server lets
   *              create users (USER_ADMIN_ROLE_NAMES in LANA-AI)
   */
  const FIRST_STEPS = Object.freeze({
    connect: {
      label: 'Connect your files',
      detail: 'Bring documents in from where they already live.',
      href: 'data-connectors.html',
      audience: 'admin',
    },
    library: {
      label: 'Explore your library',
      detail: 'See documents from every source your firm connected.',
      href: 'drive.html',
      audience: 'member',
    },
    matter: {
      label: 'Open a matter',
      detail: 'Start a workspace for a client or estate.',
      href: 'workspaces.html?action=create&type=matter',
      audience: 'all',
    },
    ask: {
      label: 'Ask me anything',
      detail: 'Get an answer, with its source, in seconds.',
      opens: 'dock',
      audience: 'all',
    },
    invite: {
      label: 'Invite your team',
      detail: 'Work on matters together, with the right access.',
      href: 'admin/users.html?action=create',
      audience: 'user_admin',
    },
  });

  /**
   * First-step ids to offer, in display order.
   * @param {{ isAdmin: boolean, isUserAdmin: boolean }} opts
   */
  function availableFirstSteps(opts) {
    const isAdmin = !!(opts && opts.isAdmin);
    const isUserAdmin = !!(opts && opts.isUserAdmin);
    const allowed = { all: true, admin: isAdmin, member: !isAdmin, user_admin: isUserAdmin };
    return Object.keys(FIRST_STEPS).filter((id) => allowed[FIRST_STEPS[id].audience] === true);
  }

  const SCENE_IDS = SCENES.map((s) => s.id);
  const STATUS_VALUES = Object.values(STATUS);

  function initialState() {
    return {
      status: STATUS.NOT_STARTED,
      version: FLOW_VERSION,
      scene: SCENE_IDS[0],
      visited: [SCENE_IDS[0]],
      firstStep: null,
      resumeOffered: false,
      checklistDismissed: false,
      completedAt: null,
      skippedAt: null,
    };
  }

  /** Accept anything (including null or a stale record) and return a valid state. */
  function normalize(saved) {
    const base = initialState();
    if (!saved || typeof saved !== 'object') return base;

    const state = { ...base };
    if (STATUS_VALUES.includes(saved.status)) state.status = saved.status;
    if (SCENE_IDS.includes(saved.scene)) state.scene = saved.scene;
    if (Array.isArray(saved.visited)) {
      state.visited = SCENE_IDS.filter((id) => saved.visited.includes(id));
    }
    if (!state.visited.includes(SCENE_IDS[0])) state.visited.unshift(SCENE_IDS[0]);
    if (!state.visited.includes(state.scene)) state.visited.push(state.scene);
    if (saved.firstStep in FIRST_STEPS) state.firstStep = saved.firstStep;
    state.resumeOffered = saved.resumeOffered === true;
    state.checklistDismissed = saved.checklistDismissed === true;
    state.completedAt = typeof saved.completedAt === 'string' ? saved.completedAt : null;
    state.skippedAt = typeof saved.skippedAt === 'string' ? saved.skippedAt : null;
    return state;
  }

  function sceneIndex(id) {
    return SCENE_IDS.indexOf(id);
  }

  function moveTo(state, id) {
    const visited = state.visited.includes(id) ? state.visited : [...state.visited, id];
    return { ...state, scene: id, visited };
  }

  /**
   * Apply one event. Unknown or not-allowed events return the same state object,
   * so callers can cheaply detect a no-op with ===.
   */
  function reduce(state, event, now) {
    const at = now || new Date().toISOString();
    const index = sceneIndex(state.scene);
    const running = state.status === STATUS.IN_PROGRESS;

    switch (event && event.type) {
      case 'START':
        if (state.status !== STATUS.NOT_STARTED) return state;
        return { ...state, status: STATUS.IN_PROGRESS, scene: SCENE_IDS[0], visited: [SCENE_IDS[0]] };

      case 'NEXT':
        if (!running || index >= SCENE_IDS.length - 1) return state;
        return moveTo(state, SCENE_IDS[index + 1]);

      case 'BACK':
        if (!running || index <= 0) return state;
        return moveTo(state, SCENE_IDS[index - 1]);

      case 'GOTO':
        if (!running || !state.visited.includes(event.scene) || event.scene === state.scene) return state;
        return moveTo(state, event.scene);

      case 'CHOOSE_FIRST_STEP':
        if (!running || !(event.step in FIRST_STEPS)) return state;
        return { ...state, firstStep: event.step };

      case 'SKIP':
        if (!running) return state;
        return { ...state, status: STATUS.SKIPPED, skippedAt: at };

      case 'FINISH':
        if (!running) return state;
        return { ...state, status: STATUS.COMPLETED, completedAt: at };

      case 'REPLAY':
        // Replaying never erases that the user already completed or skipped once.
        if (running) return state;
        return {
          ...state,
          status: STATUS.IN_PROGRESS,
          scene: SCENE_IDS[0],
          visited: [SCENE_IDS[0]],
          resumeOffered: false,
        };

      case 'RESUME_OFFERED':
        if (!running || state.resumeOffered) return state;
        return { ...state, resumeOffered: true };

      case 'RESUME_DECLINED':
        if (!running) return state;
        return { ...state, status: STATUS.SKIPPED, skippedAt: at };

      case 'DISMISS_CHECKLIST':
        if (state.checklistDismissed) return state;
        return { ...state, checklistDismissed: true };

      default:
        return state;
    }
  }

  /**
   * What to do when the app launches.
   *   'show'         open the tour from the hello scene
   *   'offer-resume' ask once whether to pick up where the user left off
   *   'none'         stay out of the way
   */
  function launchDecision(state) {
    if (state.status === STATUS.NOT_STARTED) return 'show';
    if (state.status !== STATUS.IN_PROGRESS) return 'none';
    // Quitting on the hello scene is not real progress; just greet again.
    if (state.scene === SCENE_IDS[0]) return 'show';
    return state.resumeOffered ? 'none' : 'offer-resume';
  }

  /** 1-based story position, excluding the hello scene. Null on hello. */
  function progress(state) {
    const index = sceneIndex(state.scene);
    if (index <= 0) return null;
    return { step: index, total: SCENE_IDS.length - 1 };
  }

  return {
    FLOW_VERSION,
    STATUS,
    SCENES,
    FIRST_STEPS,
    availableFirstSteps,
    initialState,
    normalize,
    reduce,
    launchDecision,
    progress,
  };
});
