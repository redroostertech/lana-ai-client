'use strict';

const Flow = require('../../src/js/onboarding/onboarding-flow');

const NOW = '2026-10-30T12:00:00.000Z';
const { STATUS } = Flow;

function started() {
  return Flow.reduce(Flow.initialState(), { type: 'START' }, NOW);
}

function advance(state, times) {
  let s = state;
  for (let i = 0; i < times; i += 1) s = Flow.reduce(s, { type: 'NEXT' }, NOW);
  return s;
}

describe('onboarding flow', () => {
  describe('normalize', () => {
    it('returns a fresh state for missing or junk input', () => {
      expect(Flow.normalize(null)).toEqual(Flow.initialState());
      expect(Flow.normalize('nope')).toEqual(Flow.initialState());
    });

    it('drops unknown values and keeps valid ones', () => {
      const s = Flow.normalize({
        status: 'in_progress',
        scene: 'verify',
        visited: ['own', 'bogus', 'verify'],
        firstStep: 'teleport',
        resumeOffered: 'yes',
      });
      expect(s.status).toBe(STATUS.IN_PROGRESS);
      expect(s.scene).toBe('verify');
      expect(s.visited).toEqual(['hello', 'own', 'verify']);
      expect(s.firstStep).toBeNull();
      expect(s.resumeOffered).toBe(false);
    });

    it('falls back to the first scene when the saved scene no longer exists', () => {
      expect(Flow.normalize({ status: 'in_progress', scene: 'removed-scene' }).scene).toBe('hello');
    });
  });

  describe('navigation', () => {
    it('starts on hello and moves forward through every scene in order', () => {
      let s = started();
      const seen = [s.scene];
      for (let i = 1; i < Flow.SCENES.length; i += 1) {
        s = Flow.reduce(s, { type: 'NEXT' }, NOW);
        seen.push(s.scene);
      }
      expect(seen).toEqual(Flow.SCENES.map((scene) => scene.id));
    });

    it('does not move past the last scene or before the first', () => {
      const last = advance(started(), Flow.SCENES.length + 3);
      expect(last.scene).toBe('start');
      const first = Flow.reduce(started(), { type: 'BACK' }, NOW);
      expect(first.scene).toBe('hello');
    });

    it('only jumps to scenes the user has already visited', () => {
      const s = advance(started(), 3);
      expect(Flow.reduce(s, { type: 'GOTO', scene: 'own' }, NOW).scene).toBe('own');
      expect(Flow.reduce(s, { type: 'GOTO', scene: 'decide' }, NOW)).toBe(s);
    });

    it('ignores navigation when the tour is not running', () => {
      const s = Flow.initialState();
      expect(Flow.reduce(s, { type: 'NEXT' }, NOW)).toBe(s);
      expect(Flow.reduce(s, { type: 'SKIP' }, NOW)).toBe(s);
    });
  });

  describe('skip and finish', () => {
    it('skips from any running scene and records when', () => {
      const s = Flow.reduce(advance(started(), 2), { type: 'SKIP' }, NOW);
      expect(s.status).toBe(STATUS.SKIPPED);
      expect(s.skippedAt).toBe(NOW);
    });

    it('finishes with or without a chosen first step', () => {
      const atStart = advance(started(), 6);
      const chose = Flow.reduce(atStart, { type: 'CHOOSE_FIRST_STEP', step: 'connect' }, NOW);
      expect(Flow.reduce(chose, { type: 'FINISH' }, NOW)).toMatchObject({
        status: STATUS.COMPLETED,
        firstStep: 'connect',
        completedAt: NOW,
      });
      expect(Flow.reduce(atStart, { type: 'FINISH' }, NOW).firstStep).toBeNull();
    });

    it('rejects unknown first steps', () => {
      const s = started();
      expect(Flow.reduce(s, { type: 'CHOOSE_FIRST_STEP', step: 'nope' }, NOW)).toBe(s);
    });
  });

  describe('replay', () => {
    it('restarts from hello without erasing the earlier completion', () => {
      const done = Flow.reduce(advance(started(), 6), { type: 'FINISH' }, NOW);
      const again = Flow.reduce(done, { type: 'REPLAY' }, NOW);
      expect(again.status).toBe(STATUS.IN_PROGRESS);
      expect(again.scene).toBe('hello');
      expect(again.completedAt).toBe(NOW);
    });

    it('is a no-op while the tour is already running', () => {
      const s = started();
      expect(Flow.reduce(s, { type: 'REPLAY' }, NOW)).toBe(s);
    });
  });

  describe('launch decision', () => {
    it('shows the tour to a brand new user', () => {
      expect(Flow.launchDecision(Flow.initialState())).toBe('show');
    });

    it('greets again when the user quit on the hello scene', () => {
      expect(Flow.launchDecision(started())).toBe('show');
    });

    it('offers to resume exactly once, then stays out of the way', () => {
      const midway = advance(started(), 2);
      expect(Flow.launchDecision(midway)).toBe('offer-resume');
      const offered = Flow.reduce(midway, { type: 'RESUME_OFFERED' }, NOW);
      expect(Flow.launchDecision(offered)).toBe('none');
    });

    it('treats a declined resume as a skip', () => {
      const declined = Flow.reduce(advance(started(), 2), { type: 'RESUME_DECLINED' }, NOW);
      expect(declined.status).toBe(STATUS.SKIPPED);
      expect(Flow.launchDecision(declined)).toBe('none');
    });

    it('never reopens after completion or skip', () => {
      const skipped = Flow.reduce(started(), { type: 'SKIP' }, NOW);
      expect(Flow.launchDecision(skipped)).toBe('none');
    });
  });

  describe('progress', () => {
    it('counts story scenes and hides progress on hello', () => {
      expect(Flow.progress(started())).toBeNull();
      expect(Flow.progress(advance(started(), 1))).toEqual({ step: 1, total: 6 });
      expect(Flow.progress(advance(started(), 6))).toEqual({ step: 6, total: 6 });
    });
  });

  describe('first steps', () => {
    it('offers org and system admins connectors and invites, in display order', () => {
      expect(Flow.availableFirstSteps({ isAdmin: true, isUserAdmin: true })).toEqual(['connect', 'matter', 'ask', 'invite']);
    });

    it('offers invites only to roles that can create users', () => {
      // A plain "admin" sees Data Connectors but cannot create users on the server.
      expect(Flow.availableFirstSteps({ isAdmin: true, isUserAdmin: false })).toEqual(['connect', 'matter', 'ask']);
    });

    it('offers everyone else the library and never an admin page', () => {
      const steps = Flow.availableFirstSteps({ isAdmin: false, isUserAdmin: false });
      expect(steps).toEqual(['library', 'matter', 'ask']);
      steps.forEach((id) => expect(Flow.FIRST_STEPS[id].href || '').not.toMatch(/^admin\//));
    });

    it('gives every step exactly one destination', () => {
      Object.values(Flow.FIRST_STEPS).forEach((step) => {
        expect(Boolean(step.href) !== Boolean(step.opens)).toBe(true);
      });
    });
  });
});
