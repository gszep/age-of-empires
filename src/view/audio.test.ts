import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioPlayer } from './audio';
import type { AudioAssets } from './assets';

class FakeAudio {
  static instances: FakeAudio[] = [];
  volume = 1;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  play = vi.fn(async () => {});
  pause = vi.fn();
  load = vi.fn();
  removeAttribute = vi.fn();
  constructor(readonly src: string) { FakeAudio.instances.push(this); }
}
const assets: AudioAssets = { base: '/audio/', audio: {
  cue: { event: 'test', files: [{ file: 'one.wav', mediaId: 1, seconds: 1 }, { file: 'two.wav', mediaId: 2, seconds: 1 }] },
  other: { event: 'other', files: [{ file: 'three.wav', mediaId: 3, seconds: 1 }] },
} };

beforeEach(() => {
  FakeAudio.instances = [];
  vi.stubGlobal('Audio', FakeAudio);
  vi.stubGlobal('document', { hidden: false });
});
afterEach(() => vi.unstubAllGlobals());

describe('bounded browser sound player', () => {
  it('applies sound volume to playing cues and avoids loading new cues while muted', () => {
    const player = new AudioPlayer(() => assets); player.unlock(); player.play('cue', 'world', 0.6);
    player.setVolume(0.5); expect(FakeAudio.instances[0].volume).toBe(0.3);
    player.setVolume(0); expect(FakeAudio.instances[0].volume).toBe(0);
    player.play('other', 'voice'); expect(FakeAudio.instances).toHaveLength(1);
    player.setVolume(1); expect(FakeAudio.instances[0].volume).toBe(0.6);
  });
  it('waits for a gesture, cancels the previous voice and releases completed media', () => {
    const player = new AudioPlayer(() => assets);
    player.play('cue', 'voice');
    expect(FakeAudio.instances).toHaveLength(0);
    player.unlock(); player.play('cue', 'voice'); player.play('cue', 'voice');
    const [first, second] = FakeAudio.instances;
    expect(first.pause).toHaveBeenCalledOnce();
    expect(second.src).toBe('/audio/two.wav');
    second.onended!();
    expect(second.removeAttribute).toHaveBeenCalledWith('src');
    expect(second.load).toHaveBeenCalledOnce();
  });

  it('caps combat voices and resets all old playback without requiring another gesture', () => {
    const player = new AudioPlayer(() => assets); player.unlock();
    for (let i = 0; i < 100; i++) player.play('cue', 'world');
    expect(FakeAudio.instances).toHaveLength(24);
    player.reset();
    expect(FakeAudio.instances.every(e => e.pause.mock.calls.length === 1)).toBe(true);
    player.play('cue');
    expect(FakeAudio.instances.at(-1)!.src).toBe('/audio/one.wav');
  });

  it('keeps one ambient source and stops it when the camera leaves visible terrain', () => {
    const player = new AudioPlayer(() => assets); player.unlock();
    player.ambient('cue', 0); player.ambient('cue', 30);
    expect(FakeAudio.instances).toHaveLength(1);
    player.ambient('other', 31);
    expect(FakeAudio.instances[0].pause).toHaveBeenCalledOnce();
    player.ambient(undefined, 32);
    expect(FakeAudio.instances[1].pause).toHaveBeenCalledOnce();
    player.play('absent');
    expect(FakeAudio.instances).toHaveLength(2);
  });
});
