'use strict';

/** The meeting audio player (src/js/briefs/briefs-replay.js) with fake audio elements. */
global.BriefsMeeting = require('../../../src/js/briefs/briefs-meeting');
const BriefsReplay = require('../../../src/js/briefs/briefs-replay');

class FakeAudio {
  constructor(durations) {
    this.durations = durations;
    this.listeners = {};
    this.readyState = 0;
    this.currentTime = 0;
    this.paused = true;
    this.playbackRate = 1;
  }
  set src(url) { this._src = url; this.duration = this.durations[url]; }
  get src() { return this._src; }
  addEventListener(name, fn) { (this.listeners[name] = this.listeners[name] || []).push(fn); }
  removeEventListener(name, fn) { this.listeners[name] = (this.listeners[name] || []).filter((item) => item !== fn); }
  fire(name) { (this.listeners[name] || []).slice().forEach((fn) => fn()); }
  load() { if (this._src) { this.readyState = 1; this.fire('loadedmetadata'); } }
  play() { this.paused = false; return Promise.resolve(); }
  pause() { this.paused = true; }
  removeAttribute() { this._src = undefined; }
}

function setup(result) {
  const made = [];
  const bridge = { meetings: { audio: jest.fn().mockResolvedValue(result) } };
  const player = new BriefsReplay(bridge, 60, () => {
    const element = new FakeAudio({ 'lana-audio://a': 10, 'lana-audio://b': 20 });
    made.push(element);
    return element;
  });
  return { player, made, bridge };
}

const twoParts = { ok: true, value: { parts: [{ url: 'lana-audio://a' }, { url: 'lana-audio://b' }] } };

test('two parts become one 30 second timeline; seeking crosses into the second part', async () => {
  const { player, made } = setup(twoParts);
  await player.open('m1', true);
  expect(player.snapshot).toMatchObject({ state: 'ready', duration: 30, position: 0 });
  player.seek(14);
  expect(player.part).toBe(1);
  expect(made[1].currentTime).toBe(4);
  expect(player.snapshot.position).toBe(14);
});

test('a clip stops at its end, and the same key again stops it', async () => {
  const { player, made } = setup(twoParts);
  await player.open('m1', true);
  player.playClip('turn-1', 2, 5);
  expect(player.snapshot).toMatchObject({ isPlaying: true, clipKey: 'turn-1' });
  made[0].currentTime = 5.5;
  made[0].fire('timeupdate');
  expect(player.snapshot).toMatchObject({ isPlaying: false, clipKey: null });
  player.playClip('turn-1', 2, 5);
  player.playClip('turn-1', 2, 5);
  expect(player.snapshot.isPlaying).toBe(false);
});

test('the first part ending plays on into the second', async () => {
  const { player, made } = setup(twoParts);
  await player.open('m1', true);
  player.play();
  made[0].fire('ended');
  expect(player.part).toBe(1);
  expect(made[1].paused).toBe(false);
});

test('no audio, and audio that cannot open', async () => {
  const none = setup(twoParts);
  await none.player.open('m1', false);
  expect(none.player.snapshot.state).toBe('noAudio');
  expect(none.bridge.meetings.audio).not.toHaveBeenCalled();
  const removed = setup({ ok: false, error: { code: 'noAudio' } });
  await removed.player.open('m1', true);
  expect(removed.player.snapshot.state).toBe('noAudio');
  const failed = setup({ ok: false, error: { code: 'other' } });
  await failed.player.open('m1', true);
  expect(failed.player.snapshot.state).toBe('unavailable');
});

test('closing releases the elements and a late open result is dropped', async () => {
  const { player, made } = setup(twoParts);
  const opening = player.open('m1', true);
  player.close();
  await opening;
  expect(player.snapshot.state).toBe('idle');
  expect(made.every((element) => element.src === undefined)).toBe(true);
});
