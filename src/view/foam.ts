/**
 * Shore foam, the way the reference draws it: `WaveAnim_ps` is white at the
 * red of one of four frame atlases, chosen per vertex, and everything else
 * -- the quad, its place against the shore, which sequence and which frame
 * -- is vertex data the engine builds. What the frames themselves say
 * (`docs/ledger.md`, "Shore foam"):
 *
 * - Each atlas is 8x8 frames of 256 texels; `diag_1` then `diag_2` is one
 *   128-frame sequence, `diag_3`/`_4` the same mirrored left to right, and
 *   the `ortho` pairs likewise.
 * - A `diag` crest lies at 45 degrees in its frame and an `ortho` crest at
 *   0, so the quad is a square on the ground with its sides along the
 *   screen's axes -- two to one on screen -- where 45 degrees becomes the
 *   tile axis's 26.6. `diag` serves a shore along a tile edge, `ortho` one
 *   stepped along a screen axis.
 * - The crest rolls from 65 texels one side of the frame's centre to 82
 *   texels the other, where it arrives and breaks: the sand lies beyond
 *   that line, the sea before it. A shore on the other side is the frame
 *   turned over.
 * - The frame is drawn in the water tile's own screen rectangle, 96 by 48
 *   at zoom 1: a tile edge then runs through the frame at 90 texels from
 *   its centre, and the crest's arrival at 82 breaks eight texels -- three
 *   pixels -- short of the waterline. At that scale the crest is the
 *   reference's: a pale band some ten pixels wide with a bright core of
 *   two or three, rolling in from half a tile out, one frame to every
 *   shore edge so the foam runs the whole coast, broken by each tile's own
 *   phase.
 */
import * as THREE from 'three/webgpu';
import { attribute, floor, fract, mix, step, texture as textureNode, time, vec2, vec3 } from 'three/tsl';
import { isOpenWater } from '../sim/mapgen';
import type { ReadonlyGameState } from '../sim/types';
import type { ContentAssets } from './assets';
import { TILE_H, TILE_W, worldToIso } from './iso';

/** Frames a second through the 128-frame roll: eight seconds a wave. Chosen. */
const FRAME_RATE = 16;
/** Tiles along either axis over which a coast's phase advances one roll. Chosen. */
const PHASE_TILES = 50;
/** Tiles along either axis between changes of the mirrored pair. Chosen. */
const VARIANT_TILES = 12;
/**
 * The frame's alpha is drawn at this fraction. `WaveAnim_ps` hands the
 * atlas's red on as alpha, and the blend state is the engine's: in the
 * reference (`islands-coast-2026-09-19.png`) the foam along a straight
 * shore is a twelve-pixel band with no bright core, red raised 25 to 60
 * over the water's 80 -- white at 0.15 to 0.35 -- where the frames carry
 * 0.3 to 0.75 across the crest. Calibrated, on the ledger.
 */
const STRENGTH = 0.4;

type Side = '+x' | '-x' | '+y' | '-y';

interface Quad {
  /** The water tile's iso centre. */
  cx: number; cy: number;
  /** `diag` or `ortho` atlases. */
  family: 'diag' | 'ortho';
  /** Frame uv at the tile rectangle's corners: left-bottom, right-bottom, right-top, left-top, D3D v down. */
  uvs: [number, number][];
  phase: number;
  variant: number;
}

/**
 * The foam over a board's shores: one quad per shore edge of a water tile,
 * or per stepped pair of them. Nothing without the owned atlases.
 */
export function createFoam(state: ReadonlyGameState, assets?: ContentAssets): THREE.Group | undefined {
  const foam = assets?.foam;
  if (!foam) return undefined;
  const atlases = [...foam.diag, ...foam.ortho].map(image => assets!.textures.get(image));
  if (atlases.some(t => !t)) return undefined;
  const { width, height, terrain } = state;
  const at = (x: number, y: number): number | undefined =>
    x < 0 || y < 0 || x >= width || y >= height ? undefined : terrain[y * width + x];
  const land = (x: number, y: number): boolean => {
    const id = at(x, y);
    return id !== undefined && !isOpenWater(id);
  };
  const quads: Quad[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!isOpenWater(at(x, y)!)) continue;
      const sides = new Set<Side>();
      if (land(x + 1, y)) sides.add('+x');
      if (land(x - 1, y)) sides.add('-x');
      if (land(x, y + 1)) sides.add('+y');
      if (land(x, y - 1)) sides.add('-y');
      if (!sides.size) continue;
      const c = worldToIso(x + 0.5, y + 0.5);
      // A coast rolls together: in the reference the foam along a stretch
      // is at one point of the roll, arrived here and mid-roll a few tiles
      // on. A tile's phase advances a fiftieth of the roll per tile along
      // either axis, so neighbours are three frames apart and a wave sweeps
      // along a shore; the mirrored pair changes every dozen tiles the same
      // way. Chosen, on the ledger.
      const along = x + y;
      const phase = (along / PHASE_TILES) % 1;
      const variant = Math.floor(along / VARIANT_TILES) % 2;
      // A stepped run: land on two adjacent sides is a shore along a screen
      // axis, drawn once across the step with the `ortho` crest.
      const stepped: [Side, Side, 'below' | 'above' | 'left' | 'right'][] = [
        ['+x', '+y', 'below'], ['-x', '-y', 'above'], ['+x', '-y', 'left'], ['-x', '+y', 'right'],
      ];
      for (const [a, b, where] of stepped) {
        if (!sides.has(a) || !sides.has(b)) continue;
        sides.delete(a);
        sides.delete(b);
        quads.push({ cx: c.x, cy: c.y, family: 'ortho', phase, variant, uvs: orthoUvs(where) });
      }
      for (const side of sides) quads.push({ cx: c.x, cy: c.y, family: 'diag', phase, variant, uvs: diagUvs(side) });
    }
  }
  if (!quads.length) return undefined;

  const positions: number[] = [];
  const uvs: number[] = [];
  const phases: number[] = [];
  const kinds: number[] = [];
  for (const quad of quads) {
    const [hw, hh] = [TILE_W / 2, TILE_H / 2];
    const corners = [
      [quad.cx - hw, quad.cy - hh], [quad.cx + hw, quad.cy - hh], [quad.cx + hw, quad.cy + hh], [quad.cx - hw, quad.cy + hh],
    ];
    // Which pair of atlases: diag 0-1 / 2-3, ortho 4-5 / 6-7.
    const kind = (quad.family === 'diag' ? 0 : 4) + quad.variant * 2;
    for (const i of [0, 1, 2, 0, 2, 3]) {
      positions.push(corners[i][0], corners[i][1], 0);
      uvs.push(quad.uvs[i][0], quad.uvs[i][1]);
      phases.push(quad.phase);
      kinds.push(kind);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('phase', new THREE.Float32BufferAttribute(phases, 1));
  geometry.setAttribute('kind', new THREE.Float32BufferAttribute(kinds, 1));

  const material = new THREE.MeshBasicNodeMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
  });
  const frames = foam.framesPerRow * foam.framesPerRow;
  const sequence = frames * 2;
  const frame = floor(fract(time.mul(FRAME_RATE / sequence).add(attribute('phase', 'float'))).mul(sequence));
  const second = step(frames, frame);
  const cell = frame.sub(second.mul(frames));
  const col = cell.mod(foam.framesPerRow);
  const row = floor(cell.div(foam.framesPerRow));
  const frameUv = attribute('uv', 'vec2');
  // The atlas is loaded with v up; the frame's v runs down, as the rows do.
  const atlasUv = vec2(col.add(frameUv.x).div(foam.framesPerRow), row.add(frameUv.y).div(foam.framesPerRow).oneMinus());
  const kind = attribute('kind', 'float');
  const sampleOf = (index: number) => textureNode(atlases[index]!, atlasUv).r;
  // The pair this quad's kind names, and the half of the sequence.
  const pair = (first: number) => mix(sampleOf(first), sampleOf(first + 1), second);
  const diag = mix(pair(0), pair(2), step(1, kind));
  const ortho = mix(pair(4), pair(6), step(5, kind));
  material.colorNode = vec3(1, 1, 1);
  material.opacityNode = mix(diag, ortho, step(3, kind)).mul(STRENGTH);

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'foam';
  // Above the terrain and its blends, below every shadow and sprite.
  mesh.renderOrder = 400;
  const group = new THREE.Group();
  group.name = 'shore-foam';
  group.add(mesh);
  return group;
}

/**
 * The frame over a water tile whose land lies on `side`. Unturned, the
 * frame's crest runs from its upper-left to its lower-right and arrives
 * toward its lower-left: on screen, along the +y tile axis with the land
 * down-left, which is +x. The other sides are the frame turned over.
 */
function diagUvs(side: Side): [number, number][] {
  const flipU = side === '+y' || side === '-x';
  const flipV = side === '-y' || side === '-x';
  return cornerUvs(flipU, flipV, false);
}

/**
 * The frame over a water tile with land on two adjacent sides, a shore
 * stepped along a screen axis: land on +x and +y lies below, and the
 * frame's crest arrives at its bottom; land above turns it over; land to
 * a side turns it a quarter, so the crest stands along screen y and the
 * roll crosses the frame's width.
 */
function orthoUvs(where: 'below' | 'above' | 'left' | 'right'): [number, number][] {
  switch (where) {
    case 'below': return cornerUvs(false, false, false);
    case 'above': return cornerUvs(false, true, false);
    case 'left': return cornerUvs(false, false, true);
    default: return cornerUvs(true, false, true);
  }
}

/**
 * Frame uv at the quad's corners (left-bottom, right-bottom, right-top,
 * left-top), D3D v down: u runs with screen x and v against screen y, so
 * the crest arrives at the bottom; `flipV` brings it to the top and
 * `flipU` mirrors the crest. `turned` a quarter, the roll runs along
 * screen x and arrives at the left, or at the right with `flipU`.
 */
function cornerUvs(flipU: boolean, flipV: boolean, turned: boolean): [number, number][] {
  const corners: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  return corners.map(([qx, qy]) => {
    if (turned) return [(qy + 1) / 2, flipU ? (qx + 1) / 2 : (1 - qx) / 2];
    const u = (qx + 1) / 2;
    const v = (1 - qy) / 2;
    return [flipU ? 1 - u : u, flipV ? 1 - v : v];
  });
}
