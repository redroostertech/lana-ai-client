/**
 * Plays a LANA Briefs meeting's recorded audio, ported from the standalone app's
 * ReplayPlayer: one audio element per stored part, joined on one timeline so play, seek,
 * skip and speed run across part boundaries. The parts stream from the Briefs host over
 * `lana-audio:` with a grant for this meeting. A clip plays one span and stops at its end.
 *
 *   const player = new BriefsReplay(bridge, fallbackDuration);
 *   player.subscribe(render);   // called with the snapshot on every change
 *   await player.open(meetingID, hasAudio);
 *
 * Snapshot: { state: 'idle'|'loading'|'ready'|'noAudio'|'unavailable', position,
 * duration, isPlaying, speed, clipKey }.
 */
(function (global) {
  'use strict';

  const M = global.BriefsMeeting || (typeof require === 'function' ? require('./briefs-meeting') : null);

  function loadDuration(element) {
    return new Promise((resolve, reject) => {
      const done = () => {
        element.removeEventListener('loadedmetadata', done);
        element.removeEventListener('error', failed);
        resolve(Number.isFinite(element.duration) ? element.duration : 0);
      };
      const failed = () => {
        element.removeEventListener('loadedmetadata', done);
        element.removeEventListener('error', failed);
        reject(new Error('audio'));
      };
      if (element.readyState >= 1) return done();
      element.addEventListener('loadedmetadata', done);
      element.addEventListener('error', failed);
      element.load();
    });
  }

  function release(element) {
    element.pause();
    element.removeAttribute('src');
    element.load();
  }

  class BriefsReplay {
    constructor(bridge, fallbackDuration, makeAudio) {
      this.bridge = bridge;
      this.fallbackDuration = fallbackDuration;
      this.makeAudio = makeAudio || (() => new Audio());
      this.listeners = new Set();
      this.elements = [];
      this.timeline = M.makeTimeline([]);
      this.part = 0;
      this.stopAt = null;
      this.generation = 0;
      this.snapshot = { state: 'idle', position: 0, duration: fallbackDuration, isPlaying: false, speed: 1, clipKey: null };
    }

    subscribe(listener) {
      this.listeners.add(listener);
      return () => this.listeners.delete(listener);
    }

    get ready() {
      return this.snapshot.state === 'ready';
    }

    async open(meetingID, hasAudio) {
      this.close();
      const generation = ++this.generation;
      if (!hasAudio) return this.set({ state: 'noAudio' });
      this.set({ state: 'loading' });
      let result;
      try {
        result = await this.bridge.meetings.audio(meetingID);
      } catch (_) {
        result = { ok: false, error: { code: 'unavailable' } };
      }
      if (generation !== this.generation) return;
      if (!result || !result.ok) return this.set({ state: result && result.error && result.error.code === 'noAudio' ? 'noAudio' : 'unavailable' });
      try {
        const elements = result.value.parts.map((part) => {
          const element = this.makeAudio();
          element.preload = 'auto';
          element.preservesPitch = true;
          element.src = part.url;
          return element;
        });
        const durations = await Promise.all(elements.map(loadDuration));
        if (generation !== this.generation) return elements.forEach(release);
        this.elements = elements;
        this.timeline = M.makeTimeline(durations);
        elements.forEach((element, index) => {
          element.addEventListener('timeupdate', () => this.onTime(index));
          element.addEventListener('ended', () => this.onEnded(index));
        });
        this.set({ state: 'ready', duration: this.timeline.duration > 0 ? this.timeline.duration : this.fallbackDuration, position: 0 });
      } catch (_) {
        if (generation === this.generation) this.set({ state: 'unavailable' });
      }
    }

    close() {
      this.generation += 1;
      this.elements.forEach(release);
      this.elements = [];
      this.timeline = M.makeTimeline([]);
      this.part = 0;
      this.stopAt = null;
      this.set({ state: 'idle', isPlaying: false, clipKey: null, position: 0 });
    }

    toggle() {
      if (this.snapshot.isPlaying) this.pause();
      else this.play();
    }

    play() {
      if (!this.ready) return;
      this.stopAt = null;
      if (this.snapshot.position >= this.snapshot.duration - 0.25) this.seek(0);
      this.start(null);
    }

    pause() {
      this.elements.forEach((element) => element.pause());
      this.stopAt = null;
      this.set({ isPlaying: false, clipKey: null });
    }

    seek(seconds) {
      const target = M.clampTime(this.timeline, seconds);
      const spot = M.locate(this.timeline, target);
      if (spot === null) return this.set({ position: Math.max(0, seconds) });
      const wasPlaying = this.snapshot.isPlaying;
      if (spot.part !== this.part && this.elements[this.part]) this.elements[this.part].pause();
      this.part = spot.part;
      const element = this.elements[spot.part];
      if (element) element.currentTime = spot.time;
      this.set({ position: target });
      if (wasPlaying && element) element.play().catch(() => this.set({ isPlaying: false }));
    }

    skip(seconds) {
      this.seek(this.snapshot.position + seconds);
    }

    setSpeed(speed) {
      this.elements.forEach((element) => { element.playbackRate = speed; });
      this.set({ speed });
    }

    /** Plays exactly start to end; the same key again stops it. */
    playClip(key, start, end) {
      if (!this.ready) return;
      if (this.snapshot.clipKey === key && this.snapshot.isPlaying) return this.pause();
      this.seek(start);
      this.start(key);
      this.stopAt = Math.max(end, start + 0.5);
    }

    playFrom(seconds) {
      if (!this.ready) return;
      this.seek(seconds);
      this.start(null);
    }

    start(clipKey) {
      const element = this.elements[this.part];
      if (!element) return;
      element.playbackRate = this.snapshot.speed;
      this.set({ isPlaying: true, clipKey });
      element.play().catch(() => this.set({ isPlaying: false, clipKey: null }));
    }

    onTime(index) {
      if (index !== this.part) return;
      const element = this.elements[index];
      if (!element) return;
      const position = this.timeline.offsets[index] + element.currentTime;
      if (this.stopAt !== null && position >= this.stopAt) {
        this.pause();
        return this.set({ position });
      }
      this.set({ position });
    }

    onEnded(index) {
      if (index !== this.part) return;
      const next = this.elements[index + 1];
      if (!next) {
        this.stopAt = null;
        return this.set({ isPlaying: false, clipKey: null, position: this.timeline.duration });
      }
      this.part = index + 1;
      next.currentTime = 0;
      next.playbackRate = this.snapshot.speed;
      next.play().catch(() => this.set({ isPlaying: false, clipKey: null }));
    }

    set(patch) {
      this.snapshot = Object.assign({}, this.snapshot, patch);
      this.listeners.forEach((listener) => listener(this.snapshot));
    }
  }

  global.BriefsReplay = BriefsReplay;
  if (typeof module !== 'undefined' && module.exports) module.exports = BriefsReplay;
})(typeof window !== 'undefined' ? window : globalThis);
