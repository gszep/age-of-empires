import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MusicPlayer } from './music';
import type { AudioAssets } from './assets';

class Track {
  static instances: Track[] = [];
  currentTime = 0;
  volume = 1;
  preload = '';
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  play = vi.fn(async () => {});
  pause = vi.fn();
  removeAttribute = vi.fn();
  load = vi.fn();
  constructor(readonly src: string) { Track.instances.push(this); }
}
const assets: AudioAssets = { base: '/audio/', music: { playlist: ['music/MUSIC01', 'music/MUSIC02'] }, audio: {
  'music/MUSIC01': { event: 'MUSIC01', files: [{ file: 'one.wav', mediaId: 1, seconds: 240 }] },
  'music/MUSIC02': { event: 'MUSIC02', files: [{ file: 'two.wav', mediaId: 2, seconds: 250 }] },
} };
beforeEach(() => { Track.instances = []; vi.stubGlobal('Audio', Track); vi.stubGlobal('document', { hidden: false }); });
afterEach(() => vi.unstubAllGlobals());

describe('owned soundtrack playback', () => {
  it('loads one track only after a gesture, advances on end and wraps without retaining old media', () => {
    const player = new MusicPlayer(() => assets);
    player.update(true);
    expect(Track.instances).toHaveLength(0);
    player.unlock();
    const one = Track.instances[0];
    expect(one.src).toBe('/audio/one.wav');
    for (let i = 0; i < 20; i++) player.update(true);
    expect(one.play).toHaveBeenCalledOnce();
    one.onended!();
    expect(one.removeAttribute).toHaveBeenCalledWith('src');
    expect(Track.instances[1].src).toBe('/audio/two.wav');
    Track.instances[1].onended!();
    expect(Track.instances[2].src).toBe('/audio/one.wav');
  });

  it('preserves playhead on pause/hidden, and a match reset starts at track one', () => {
    const player = new MusicPlayer(() => assets); player.update(true); player.unlock();
    const one = Track.instances[0]; one.currentTime = 75;
    player.update(false); player.update(false);
    expect(one.pause).toHaveBeenCalledOnce();
    expect(one.removeAttribute).not.toHaveBeenCalled();
    player.update(true);
    expect(one.currentTime).toBe(75);
    expect(one.play).toHaveBeenCalledTimes(2);
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    player.update(true);
    expect(one.pause).toHaveBeenCalledTimes(2);
    player.reset();
    Object.defineProperty(document, 'hidden', { value: false, configurable: true }); player.update(true);
    expect(Track.instances[1].src).toBe('/audio/one.wav');
  });

  it('bounds failed-media retries and is silent without owned music', () => {
    const player = new MusicPlayer(() => assets); player.update(true); player.unlock();
    Track.instances[0].onerror!(); Track.instances[1].onerror!();
    for (let i = 0; i < 50; i++) player.update(true);
    expect(Track.instances).toHaveLength(2);
    const fallback = new MusicPlayer(() => undefined); fallback.update(true); fallback.unlock();
    expect(Track.instances).toHaveLength(2);
  });

  it('does not retry autoplay rejection until another gesture', async () => {
    const player = new MusicPlayer(() => assets); player.update(true); player.unlock();
    player.update(false);
    const track = Track.instances[0];
    track.play.mockRejectedValueOnce(Object.assign(new Error('gesture required'), { name: 'NotAllowedError' }));
    player.update(true); await Promise.resolve();
    for (let i = 0; i < 50; i++) player.update(true);
    expect(track.play).toHaveBeenCalledTimes(2);
    player.unlock();
    expect(track.play).toHaveBeenCalledTimes(3);
  });
});
