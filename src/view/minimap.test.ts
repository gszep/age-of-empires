import { afterEach, describe, expect, it, vi } from 'vitest';
import { Minimap, minimapReliefShade, minimapResourceDotSize, minimapTerrainColor, minimapShowsEntity, type MinimapColorMode, type MinimapFilter } from './minimap';
import type { Entity, EntityKind, PlayerId } from '../sim/types';
import { createGame } from '../sim/game';
import { playerColorHex } from './sprites';

describe('minimap resource density', () => {
  it('keeps classic-board resource dots at their established size', () => {
    expect(minimapResourceDotSize(120, 120)).toBe(3);
  });

  it('shrinks Windsor tree dots to one pixel instead of covering ten tiles each', () => {
    expect(minimapResourceDotSize(392, 392)).toBe(1);
  });
});

describe('minimap relief', () => {
  const field = (heightAt: (x: number, y: number) => number) => ({
    width: 7, height: 5,
    elevation: Array.from({ length: 35 }, (_, i) => heightAt(i % 7, Math.floor(i / 7))),
  });

  it('keeps elevated plateaus flat, including map boundaries', () => {
    for (const level of [0, 4, 19.25]) {
      const state = field(() => level);
      for (let y = 0; y < state.height; y++) for (let x = 0; x < state.width; x++) {
        expect(minimapReliefShade(state, x, y)).toBe(1);
      }
    }
  });

  it.each([
    ['x', (x: number, _y: number) => x, 0],
    ['y', (_x: number, y: number) => y, 2],
    ['screen-horizontal', (x: number, y: number) => x - y, 0],
  ] as const)('gives opposite %s slopes opposite shades without depending on altitude', (_name, heightAt, shade) => {
    const descending = field((x, y) => 30 - heightAt(x, y));
    const ascending = field((x, y) => heightAt(x, y));
    const raised = field((x, y) => 100 + heightAt(x, y));
    expect(minimapReliefShade(descending, 3.5, 2.5)).toBe(2 - shade);
    expect(minimapReliefShade(ascending, 3.5, 2.5)).toBe(shade);
    expect(minimapReliefShade(raised, 3.5, 2.5)).toBe(shade);
  });

  it('leaves a slope perpendicular to the shading axis neutral', () => {
    expect(minimapReliefShade(field((x, y) => 10 + x + y), 3, 2)).toBe(1);
  });

  it('lights the screen-right faces of a four-sided hill, not both front faces', () => {
    const state = field((x, y) => Math.max(0, 3 - Math.abs(x - 3) - Math.abs(y - 2)));
    // Relative to the peak: -x projects upper-right; +y projects lower-right.
    expect(minimapReliefShade(state, 2, 2)).toBe(0);
    expect(minimapReliefShade(state, 3, 3)).toBe(0);
    // +x projects lower-left; -y projects upper-left.
    expect(minimapReliefShade(state, 4, 2)).toBe(2);
    expect(minimapReliefShade(state, 3, 1)).toBe(2);
    expect(minimapReliefShade(state, 3, 2)).toBe(1);
  });

  it('handles old flat snapshots without elevation and ignores numerical noise', () => {
    expect(minimapReliefShade({ width: 7, height: 5, elevation: [] }, 3, 2)).toBe(1);
    expect(minimapReliefShade(field((x, y) => 4 + (x + y) * 1e-9), 3, 2)).toBe(1);
  });
});

describe('minimap terrain color modes', () => {
  it('returns color unchanged in color mode', () => {
    const rgb = [100, 150, 200] as const;
    expect(minimapTerrainColor(rgb, 'color')).toEqual(rgb);
  });

  it('converts to grayscale using standard luminance formula', () => {
    const rgb = [255, 128, 64] as const;
    const grey = minimapTerrainColor(rgb, 'grayscale');
    const expected = Math.round(255 * 0.299 + 128 * 0.587 + 64 * 0.114);
    expect(grey).toEqual([expected, expected, expected]);
  });

  it('returns undefined for noterrain mode (terrain rendering is skipped elsewhere)', () => {
    const rgb = [100, 150, 200] as const;
    expect(minimapTerrainColor(rgb, 'noterrain')).toBeUndefined();
  });

  it('handles undefined input in all modes', () => {
    expect(minimapTerrainColor(undefined, 'color')).toBeUndefined();
    expect(minimapTerrainColor(undefined, 'grayscale')).toBeUndefined();
    expect(minimapTerrainColor(undefined, 'noterrain')).toBeUndefined();
  });
});

describe('minimap entity filtering', () => {
  // Exercise actual player/civilisation lookup, not the owner=0 bypass which
  // concealed the incomplete fixture in the first attempt.
  const state = createGame(138);
  const shows = (kind: EntityKind, filter: MinimapFilter, owner: PlayerId | 0 = 1) =>
    minimapShowsEntity({ kind, owner, order: { kind: 'idle' } }, state, 1, filter);

  it('shows all entities in all filter mode', () => {
    for (const kind of ['villager', 'militia', 'resource', 'relic', 'market'] as const)
      expect(shows(kind, 'all')).toBe(true);
  });

  it('shows combat/support units, not armed villagers, animals or buildings (41051)', () => {
    for (const kind of ['militia', 'archer', 'monk', 'galley'] as const)
      expect(shows(kind, 'military', 2), kind).toBe(true);
    for (const kind of ['villager', 'resource', 'relic', 'boar', 'sheep', 'fishing-ship',
      'trade-cart', 'barracks', 'castle', 'watch-tower'] as const)
      expect(shows(kind, 'military'), kind).toBe(false);
  });

  it('shows idle own workers, own traders and any trade building (41053)', () => {
    for (const kind of ['villager', 'trade-cart', 'trade-cog', 'market', 'dock'] as const)
      expect(shows(kind, 'economy'), kind).toBe(true);
    for (const kind of ['militia', 'archer', 'resource', 'house', 'town-center', 'mill'] as const)
      expect(shows(kind, 'economy'), kind).toBe(false);
    expect(shows('market', 'economy', 2)).toBe(true);
    expect(shows('dock', 'economy', 2)).toBe(true);
    expect(shows('villager', 'economy', 2)).toBe(false);
    expect(shows('trade-cart', 'economy', 2)).toBe(false);
    expect(minimapShowsEntity({ kind: 'villager', owner: 1, order: { kind: 'gather', targetId: 1 } }, state, 1, 'economy')).toBe(false);
    expect(minimapShowsEntity({ kind: 'villager', owner: 1 }, state, 1, 'economy')).toBe(false);
  });

  it('uses capabilities and class for new data-driven units, including converted stats', () => {
    const unit = { ...state.rules.units.militia, datClass: 4 };
    expect(minimapShowsEntity({ kind: 'militia', owner: 1, convertedRules: unit }, state, 1, 'military')).toBe(false);
    expect(minimapShowsEntity({ kind: 'villager', owner: 1, convertedRules: state.rules.units.militia }, state, 1, 'military')).toBe(true);
  });
});

describe('minimap draw mode integration', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('rewrites land and water on switching, preserves fog, filters live and remembered dots without mutating state', () => {
    const state = createGame(138);
    state.width = 2; state.height = 2;
    state.terrain = [0, 1, 0, 1]; state.elevation = [0, 0, 0, 0];
    state.visibility[1].visible = [1, 1, 0, 0];
    state.visibility[1].explored = [1, 1, 1, 0];
    state.visibility[1].memory = { 999: { id: 999, kind: 'market', owner: 2, x: 0, y: 1,
      hp: 100, maxHp: 100, lastSeenAt: 0 } };
    state.entities = state.entities.filter(e => e.owner === 1 && e.kind === 'villager').slice(0, 1);
    state.entities[0].position = { x: 0, y: 0 };
    state.entities[0].order = { kind: 'idle' };
    const before = JSON.stringify(state);
    let pixels = new Uint8ClampedArray();
    const fillRect = vi.fn();
    const context = { fillRect, save() {}, restore() {}, setTransform() {}, clearRect() {}, drawImage() {},
      beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, stroke() {},
      createImageData: (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
      putImageData: (image: ImageData) => { pixels = new Uint8ClampedArray(image.data); } };
    const canvas = { width: 240, height: 130, getContext: () => context } as unknown as HTMLCanvasElement;
    vi.stubGlobal('document', { createElement: () => canvas });
    const map = new Minimap(canvas);
    const draw = () => { fillRect.mockClear(); map.draw(state, { x: 1, y: 1 }, { w: 1, h: 1 }); return [...pixels]; };
    const color = draw();
    expect(fillRect).toHaveBeenCalledTimes(2);
    expect(color.slice(12, 16)).toEqual([0, 0, 0, 255]);
    expect(color[8]).toBeLessThan(color[0]); // remembered terrain still shaded
    map.colorMode = 'grayscale'; const gray = draw();
    expect(gray[0]).toBe(gray[1]); expect(gray[4]).toBe(gray[5]);
    expect(gray).not.toEqual(color);
    map.colorMode = 'noterrain';
    expect(draw()).toEqual([0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255]);
    map.colorMode = 'color'; expect(draw()).toEqual(color);
    map.filter = 'military'; draw(); expect(fillRect).not.toHaveBeenCalled();
    map.filter = 'economy'; draw(); expect(fillRect).toHaveBeenCalledTimes(2);
    map.filter = 'all'; draw(); expect(fillRect).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(state)).toBe(before);
  });
});

describe('minimap privacy across every filter and terrain mode', () => {
  afterEach(() => vi.unstubAllGlobals());
  const modes = (['all', 'military', 'economy'] as const).flatMap(filter =>
    (['color', 'grayscale', 'noterrain'] as const).map(colorMode => ({ filter, colorMode })));

  function fixture(filter: MinimapFilter, colorMode: MinimapColorMode) {
    const state = createGame(138);
    state.width = 2; state.height = 2;
    state.terrain = [0, 1, 10, 24]; state.elevation = [0, 0, 0, 0];
    state.entities = [];
    const visibility = state.visibility[1];
    visibility.visible = [0, 0, 0, 0];
    visibility.explored = [0, 0, 0, 0];
    visibility.memory = {};
    let pixels: number[] = [];
    const dots: { color: string; rect: number[] }[] = [];
    const context = { fillStyle: '',
      fillRect: (x: number, y: number, w: number, h: number) => {
        dots.push({ color: context.fillStyle, rect: [x, y, w, h] });
      },
      save() {}, restore() {}, setTransform() {}, clearRect() {}, drawImage: vi.fn(),
      beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, stroke() {},
      createImageData: (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
      putImageData: (image: ImageData) => { pixels = Array.from(image.data); } };
    const canvas = { width: 240, height: 130, getContext: () => context } as unknown as HTMLCanvasElement;
    // Distinct tile buffer: changing its dimensions must not resize the display canvas.
    vi.stubGlobal('document', { createElement: () => ({ getContext: () => context }) });
    const map = new Minimap(canvas, 1);
    map.filter = filter; map.colorMode = colorMode;
    const enemy = (kind: 'militia' | 'market'): Entity => ({ id: 999, kind, owner: 2,
      position: { x: 0.5, y: 1.5 }, hp: 100, maxHp: 100, radius: 0.2,
      activity: 'idle', order: { kind: 'idle' } });
    const draw = () => {
      dots.length = 0; context.drawImage.mockClear();
      map.draw(state, { x: 1, y: 1 }, { w: 1, h: 1 }); // normal player view, never debug reveal
      expect(context.drawImage).toHaveBeenCalledTimes(1);
      return { pixels: [...pixels], dots: [...dots] };
    };
    return { state, visibility, enemy, draw };
  }

  describe.each(modes)('$filter / $colorMode', ({ filter, colorMode }) => {
    it('does not draw a live enemy soldier outside current sight, even on explored ground', () => {
      const { state, visibility, enemy, draw } = fixture(filter, colorMode);
      state.entities = [enemy('militia')];
      for (const explored of [0, 1]) {
        visibility.explored[2] = explored;
        expect(draw().dots).toEqual([]);
      }
      // Positive control: absence above is visibility, not a broken draw recorder.
      visibility.visible[2] = 1;
      expect(draw().dots).toHaveLength(filter === 'economy' ? 0 : 1);
      visibility.visible[2] = 0;
      expect(draw().dots).toEqual([]);
    });

    it('does not draw a never-seen enemy market or create a memory of it', () => {
      const { state, visibility, enemy, draw } = fixture(filter, colorMode);
      const empty = draw();
      state.entities = [enemy('market')];
      expect(draw()).toEqual(empty);
      expect(visibility.memory).toEqual({});
      visibility.explored[2] = 1; // explored terrain does not mean this building was seen
      expect(draw().dots).toEqual([]);
      expect(visibility.memory).toEqual({});
      visibility.visible[2] = 1;
      expect(draw().dots).toHaveLength(filter === 'military' ? 0 : 1);
    });

    it('retains only the last-seen market marker through an unseen death/removal', () => {
      const { state, visibility, enemy, draw } = fixture(filter, colorMode);
      const market = enemy('market');
      state.entities = [market];
      visibility.visible[2] = visibility.explored[2] = 1;
      visibility.memory[market.id] = { id: market.id, kind: 'market', owner: 2,
        x: market.position.x, y: market.position.y, hp: 100, maxHp: 100, lastSeenAt: state.tick };
      const expectedDots = filter === 'military' ? [] : [{ color: playerColorHex(undefined, 2), rect: [179, 64, 2, 2] }];
      expect(draw().dots).toEqual(expectedDots); // live marker; visible memory must not duplicate it
      visibility.visible[2] = 0;
      const remembered = draw();
      expect(remembered.dots).toEqual(expectedDots);
      const memoryBefore = JSON.stringify(visibility.memory);
      market.hp = 0; market.dead = true;
      expect(draw()).toEqual(remembered); // unseen death cannot clear or alter the marker
      state.entities = [];
      expect(draw()).toEqual(remembered); // no live entity needed: this is the memory path
      expect(JSON.stringify(visibility.memory)).toBe(memoryBefore);
      visibility.visible[2] = 1;
      expect(draw().dots).toEqual([]); // seeing the now-empty location suppresses stale memory
    });

    it('keeps unexplored land and water opaque black, including Simple and No Terrain', () => {
      const { state, visibility, draw } = fixture(filter, colorMode);
      const black = Array.from({ length: 4 }, () => [0, 0, 0, 255]).flat();
      expect(draw().pixels).toEqual(black);
      state.terrain = [1, 24, 0, 10]; // hidden terrain identity cannot affect output
      expect(draw().pixels).toEqual(black);
      visibility.visible[0] = visibility.explored[0] = 1;
      const revealed = draw().pixels;
      expect(revealed.slice(4)).toEqual(black.slice(4));
      if (colorMode === 'noterrain') expect(revealed).toEqual(black);
      else expect(revealed.slice(0, 3).some(channel => channel > 0)).toBe(true);
    });
  });
});
