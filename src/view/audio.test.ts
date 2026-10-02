import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioPlayer } from './audio';
import type { AudioAssets, AudioLayer } from './assets';

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
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

const layer = (file: number, extra: Partial<AudioLayer> = {}): AudioLayer => ({ actionId: file + 1, fileIndices: [file],
  delaySeconds: 0, delayRange: [0, 0], fadeSeconds: 0, fadeRange: [0, 0], probability: 100, probabilityRange: [0, 0], curve: 4, ...extra });
const layered = (layers: AudioLayer[]): AudioAssets => ({ ...assets, audio: { ...assets.audio,
  layered: { event: 'layered', files: assets.audio.cue.files, layers } } });

describe('bounded browser sound player', () => {
  it('leaves reviewed Persian gaps silent without borrowing the default cart cue', () => {
    const alias = 'civilizations/persians/trade-cart-select';
    const player = new AudioPlayer(() => ({ ...assets,
      audio: { ...assets.audio, 'trade-cart-select': assets.audio.cue },
      unavailable: { [alias]: { event: 'TCART select', eventId: 3167914911, switch: 'Persians',
        reason: 'event-absent-from-owned-banks', issue: 271 } },
    }));
    player.unlock(); player.play(alias, 'voice');
    expect(FakeAudio.instances).toHaveLength(0);
    player.play('trade-cart-select', 'voice');
    expect(FakeAudio.instances.map(e => e.src)).toEqual(['/audio/one.wav']);
  });

  it('plays each action layer at its owned delay rather than choosing between layers', async () => {
    vi.useFakeTimers();
    const player = new AudioPlayer(() => layered([layer(0), layer(1, { delaySeconds: 0.5 })]));
    player.unlock(); player.play('layered', 'voice');
    const [horn, voice] = FakeAudio.instances;
    expect(horn.play).toHaveBeenCalledOnce(); expect(voice.play).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(499); expect(voice.play).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); expect(voice.play).toHaveBeenCalledOnce();
    expect(horn.pause).not.toHaveBeenCalled();
    player.stop(); expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels pending layers when a newer acknowledgement or reset supersedes them', async () => {
    vi.useFakeTimers();
    const player = new AudioPlayer(() => layered([layer(0), layer(1, { delaySeconds: 0.5 })]));
    player.unlock(); player.play('layered', 'voice');
    const delayed = FakeAudio.instances[1];
    player.play('other', 'voice');
    await vi.advanceTimersByTimeAsync(1000); expect(delayed.play).not.toHaveBeenCalled();
    expect(delayed.removeAttribute).toHaveBeenCalledWith('src');
    player.reset(); expect(vi.getTimerCount()).toBe(0);
  });

  it('ramps an owned linear fade and applies volume changes without jumping to full gain', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => Number(setTimeout(() => callback(performance.now()), 16)));
    vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
    const player = new AudioPlayer(() => layered([layer(0, { fadeSeconds: 3 })]));
    player.unlock(); player.play('layered', 'ambient', 0.6);
    await Promise.resolve(); expect(FakeAudio.instances[0].volume).toBe(0);
    await vi.advanceTimersByTimeAsync(1500);
    expect(FakeAudio.instances[0].volume).toBeCloseTo(0.3, 2);
    player.setVolume(0.5); expect(FakeAudio.instances[0].volume).toBeCloseTo(0.15, 2);
    await vi.advanceTimersByTimeAsync(1600); expect(FakeAudio.instances[0].volume).toBe(0.3);
    player.stop(); expect(vi.getTimerCount()).toBe(0);
  });

  it('honours action probability without touching the simulation random stream', () => {
    const simulation = { seed: 123, matchSeed: 42 };
    const before = { ...simulation };
    const player = new AudioPlayer(() => layered([layer(0, { probability: 0 }), layer(1)]), () => simulation.matchSeed);
    player.unlock(); player.play('layered');
    expect(FakeAudio.instances.map(e => e.src)).toEqual(['/audio/two.wav']);
    expect(simulation).toEqual(before);
  });
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
