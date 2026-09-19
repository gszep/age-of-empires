/**
 * The water surface, the way the reference draws it: a shader over the tile.
 *
 * AoE2DE's `Water_ps` takes a surface texture (`g_WaterSurfaceTexture`), a
 * sea floor (`g_SeaFloorTexture`), a sky dome (`g_SkyDomeTexture`), the
 * depth, visibility and beach-blend textures, the sun, and the colours and
 * intensities `water_def.json` states per preset. The shader ships with a
 * Shader Model 2 build beside its SM4 one (the DXBC's `Aon9` chunk), and SM2
 * bytecode is a documented token stream, so the whole of it is read rather
 * than guessed (`tools/probes/sm2dis.py`; the register map is in
 * `docs/ledger.md`'s row for the surface):
 *
 *     P      = (pos.x / mapWidth, pos.y / mapHeight) / mapScale      (Water_vs)
 *     T      = time * waveAnimationSpeed
 *     h(q)   = sum of the surface texture's r, g and b at q / waveRepeatLength
 *     H(q)   = h(q + 0.5T) + h(q + T(0.875, 1.125)) - h(q + T(1.075, 2.125))
 *     N      = normalize(amplitude * (H(P + (0.05, 0)) - H(P - (0.05, 0))),
 *                        amplitude * (H(P + (0, 0.05)) - H(P - (0, 0.05))), 0.1)
 *     body   = floor(P + N.xy / seaFloorScale) * seaFloorIntensity * waterColour
 *              + sky(0.5 + skyDomeMtx * reflect(V, N).xy) * skyIntensity * skyColor
 *     glint  = pow(max(dot(reflect(L, N), V), 0), specularPower)
 *              * specularColor * specularIntensity
 *     out    = body * depth.a + glint
 *
 * with `V` the direction from the eye to the surface and `L` the preset's
 * `sun_direction`, both in the shader's world frame. Three things follow
 * that a normal-map reading of the surface gets wrong: the texture is a
 * height field (its channels summed), so its broad tone never tilts the
 * surface and the ripple's repeat cannot band; the surface is nearly flat
 * (one degree of tilt), so what the eye sees is the dome shimmering through
 * the wobble of the normal, not sparkles off a rough sea; and the texture's
 * rows lie along a tile axis, where the reference's streaks measure at
 * 155 degrees on screen, the down-left tile axis mirrored.
 *
 * What that colour is added to is the water terrain's own texture, drawn as
 * ground like any other. DE ships a texture per depth (`g_wtr` for `Water,
 * Shallow`, `g_wt3` for `Water, Medium`), and the 2026-09-19 Islands
 * composite shows the coastal rim at (75-82, 165-172, 207-220) and the open
 * sea at (72, 138, 181): in linear light each sits above its own texture by
 * the same 0.235 of the body -- one weight over two textures and three
 * channels (six numbers, within four percent), which is what a surface
 * added to a drawn tile gives and a surface in place of it does not. So the
 * tile, the surface and the glint are summed here in linear light, as the
 * renderer takes a decoded texture, and handed to its output encoding.
 */
import * as THREE from 'three/webgpu';
import {
  attribute, dot, max, normalize, pow, texture as textureNode, time, uv, vec2, vec3, type ShaderNodeObject,
} from 'three/tsl';
import type { Node } from 'three/webgpu';
import { isOpenWater } from '../sim/mapgen';
import { random01, seedFrom } from '../sim/random';
import type { ReadonlyGameState } from '../sim/types';
import type { ContentAssets, WaterPreset } from './assets';

/**
 * The shader's `g_terrainScale`, which multiplies the map-normalised
 * position before the wave repeat divides it. It is set by the engine and
 * named in no owned file; at 1 the Default preset repeats its surface every
 * 20 * 0.0045 * 120 = 10.8 tiles on a 120-tile board, and the reference's
 * streaks, measured along their length in the 2026-09-19 Islands composite,
 * decorrelate at the rate the surface does at that repeat (0.58, 0.38, 0.24
 * at one, two and three pixels against 0.60, 0.37, 0.22), where 8 and 14
 * tiles miss both ways. Calibrated, on the ledger.
 */
const TERRAIN_SCALE = 1;
/**
 * The shader scales the glint by the visibility texture's blue channel,
 * which the engine fills and no owned file states. At 1 the read geometry
 * puts a saturated white dash on every facet that mirrors the sun (one in a
 * hundred, at the reference's 30 degrees), and the reference's open sea has
 * none: its fine texture is a symmetric five-level shimmer with a 99.9th
 * percentile of 16 over the mean at 0.52 of 1080p, which the glint at 0.15
 * of the shader's reproduces (12.7) and at 0.3 overshoots (25.5).
 * Calibrated, on the ledger (#94).
 */
const GLINT_SCALE = 0.15;
/**
 * The shader's world frame, against the tile frame: the sun `(0.7, -0.68,
 * 0.45)` only reaches the eye off a near-flat surface if it lies beyond the
 * surface along the line of sight, so the eye looks along world (1, -1),
 * which is screen up; and the texture's rows, which run along world x, lie
 * on screen at the angle of the down-left tile axis. So world x is the
 * tile's -x, world y its +y, and the eye looks down the reference's 30
 * degrees (its 2:1 tile) from the screen's bottom. `V` is the direction
 * from the eye to the surface, as `Water_vs` hands it on.
 */
const VIEW_ELEVATION = Math.PI / 6;
const VIEW = new THREE.Vector3(
  Math.cos(VIEW_ELEVATION) * Math.SQRT1_2, -Math.cos(VIEW_ELEVATION) * Math.SQRT1_2, -Math.sin(VIEW_ELEVATION),
);
/**
 * The shader's `g_skyDomeMtx`, two rows of two: the preset's `sky_scale`
 * times a rotation by `sky_rotation`, the sense unstated, and whether the
 * dome's v is then turned over for three is the one bit the frame does not
 * settle. Not turned, the flat sea looks up the dome's lower-right quarter
 * at (96, 135, 173), and the body is then the one colour that sits under
 * the reference's two zones at one weight (the header); turned, the
 * upper-right's (90, 117, 140) fits no weight. Calibrated, on the ledger.
 */
function skyDomeMatrix(preset: WaterPreset): [number, number, number, number] {
  const angle = (preset.skyRotation * Math.PI) / 180;
  const s = preset.skyScale;
  return [s * Math.cos(angle), -s * Math.sin(angle), s * Math.sin(angle), s * Math.cos(angle)];
}
/**
 * Which preset a board's water takes. Arabia's script rolls `WATER_POND`
 * (includes/water_preset.inc: 65% Calm, 35% Dimmed) for its ponds, and
 * Islands names none, which is the engine's Default. The board says which
 * it is -- a sea is most of the board, a pond is not -- and the roll is
 * made from the match seed so it holds for the match and touches nothing
 * the simulation draws on.
 */
export function waterPresetFor(state: ReadonlyGameState, assets: ContentAssets): WaterPreset | undefined {
  const water = assets.water;
  if (!water) return undefined;
  let wet = 0;
  for (const id of state.terrain) if (isOpenWater(id)) wet++;
  if (wet > state.terrain.length * 0.3) return water['0'];
  const roll = random01({ seed: seedFrom(state.matchSeed ^ 0x7a7e_12) });
  return (roll < 0.65 ? water['3'] : water['6']) ?? water['0'];
}

export interface WaterMaterialOptions {
  /** Tiles per texture repeat of the mesh's `uv`, so the shader can work in tiles. */
  span: number;
  /** The board's width and height in tiles: the shader normalises the
   * position by them (`g_mapWidth`, `g_mapHeight`). */
  board: [number, number];
  /** The water terrain's own texture, which the surface is added to. */
  tile: THREE.Texture;
  /** Fade the whole through the blend mask in `uv1` (water lapping onto a
   * neighbouring tile). */
  masked?: THREE.Texture;
  /** With `masked`: the water terrain's own overlay mask at the tile's uv,
   * gating where it laps (`TerrainBlend_ps`'s `g_MaskTexture`). */
  overlay?: THREE.Texture;
}

/**
 * The weight the surface is added at over a water terrain, from the preset's
 * `opacity` for the terrain's class. The reference's sea sits above its
 * texture by 0.235 of the body in both zones (the header), not by the
 * class's 32/255 = 0.125: two layers at 0.125 composited over each other
 * come to 1 - (1 - 0.125)^2 = 0.234, so that is the form taken -- whether
 * the engine draws its surface twice is not read. A terrain that names no
 * class the preset carries takes the `normal` row.
 */
export function surfaceOpacity(preset: WaterPreset, waterClass: string | null | undefined): number {
  const row = (waterClass && preset.types[waterClass]) || preset.types.normal;
  const opacity = (row?.opacity ?? 32) / 255;
  return 1 - (1 - opacity) ** 2;
}

/**
 * The surface's repeat in tiles for a preset on a board: what the shader's
 * arithmetic comes to along the board's x axis, for tests and probes.
 */
export function surfaceRepeatTiles(preset: WaterPreset, boardWidth: number): number {
  return preset.waveRepeatLength * preset.mapScale * boardWidth / TERRAIN_SCALE;
}

/**
 * A water material for one preset and one water terrain: the tile under
 * the surface. The mesh supplies `uv` in texture repeats (tile / span) like
 * every terrain mesh, `color` as the ground's shade, and a `surfaceWeight`
 * attribute, the class weight of the water at each corner, so the surface
 * steps from the shallow rim's weight to the open sea's across the tile
 * where the two meet.
 */
export function createWaterMaterial(
  assets: ContentAssets, preset: WaterPreset, options: WaterMaterialOptions,
): THREE.MeshBasicNodeMaterial {
  const surfaceMap = assets.textures.get(preset.normal);
  const skyMap = assets.textures.get(preset.sky);
  const floorMap = assets.textures.get(preset.seaFloor);
  if (!surfaceMap || !skyMap || !floorMap) throw new Error(`water preset ${preset.name} has no textures`);

  const tiles = uv().mul(options.span);
  // The position in the shader's world frame, normalised by the board and
  // `mapScale` as `Water_vs` and the first lines of `Water_ps` do it.
  const [boardWidth, boardHeight] = options.board;
  const position = vec2(
    tiles.x.mul(-TERRAIN_SCALE / (boardWidth * preset.mapScale)),
    tiles.y.mul(TERRAIN_SCALE / (boardHeight * preset.mapScale)),
  );
  // The shader's `g_time` is its `wave_animation_speed` times a clock whose
  // unit is not stated; every preset's `water_normals_def` carries a
  // `velocity` of 0.125 that no shader input names, so the engine can only
  // apply it through that clock, and at a second per second the fastest
  // layer crossed two tiles a second where the reference drifts gently.
  // Inferred, on the ledger. The clock is the wall's, not the match's: the
  // surface is a shader over the frame, not a task on the simulation's.
  const T = time.mul(preset.normalVelocity[0] * preset.waveAnimationSpeed);
  const repeat = preset.waveRepeatLength;
  // Direct3D's v runs down the image and three's runs up it; the surface
  // wraps, so the turn is a sign.
  const heightAt = (q: ShaderNodeObject<Node>) => {
    const sample = textureNode(surfaceMap, vec2(q.x, q.y.negate()).div(repeat)).rgb;
    return sample.x.add(sample.y).add(sample.z);
  };
  // Three drifting layers of the one height field, summed as the shader
  // sums them: the base drift on both axes, a second layer further along,
  // and a third, faster one subtracted.
  const height = (q: ShaderNodeObject<Node>) => {
    const base = q.add(T.mul(0.5));
    const second = base.add(T.mul(vec2(0.375, 0.625)));
    const third = second.add(T.mul(vec2(0.2, 1)));
    return heightAt(base).add(heightAt(second)).sub(heightAt(third));
  };
  // The surface normal from the height field's central difference at the
  // shader's own tap spacing, in the preset's amplitude, over a constant
  // rise of 0.1: a near-flat sea.
  const tap = 0.05;
  const slopeX = height(position.add(vec2(tap, 0))).sub(height(position.sub(vec2(tap, 0)))).mul(preset.waveAmplitude);
  const slopeY = height(position.add(vec2(0, tap))).sub(height(position.sub(vec2(0, tap)))).mul(preset.waveAmplitude);
  const normal = normalize(vec3(slopeX, slopeY, 0.1));

  // The eye's line of sight mirrored about the normal looks up the sky
  // dome: a fisheye of the hemisphere, zenith at the centre, its xy taken
  // through `g_skyDomeMtx` and offset to the middle, exactly as the shader
  // does it; the dome's v is turned over for three.
  const view = vec3(VIEW.x, VIEW.y, VIEW.z);
  const reflected = view.sub(normal.mul(dot(normal, view).mul(2)));
  const [m00, m01, m10, m11] = skyDomeMatrix(preset);
  const skyU = reflected.x.mul(m00).add(reflected.y.mul(m01)).add(0.5);
  const skyV = reflected.x.mul(m10).add(reflected.y.mul(m11)).add(0.5);
  const skyUv = vec2(skyU, skyV);
  const sky = textureNode(skyMap, skyUv).rgb.mul(vec3(...preset.skyColor)).mul(preset.skyIntensity);

  // The floor at the world position pushed by the normal, over the preset's
  // floor scale; under its intensity and the water's own colour.
  const floorUv = position.add(normal.xy).div(preset.seaFloorScale);
  const floor = textureNode(floorMap, vec2(floorUv.x, floorUv.y.negate())).rgb
    .mul(preset.seaFloorIntensity).mul(vec3(...preset.waterColor));

  // The sun reflected about the normal, against the line of sight: the
  // glint, at the preset's power, in the preset's specular colour.
  const sun = new THREE.Vector3(...preset.sunDirection).normalize();
  const light = vec3(sun.x, sun.y, sun.z);
  const sunMirrored = light.sub(normal.mul(dot(normal, light).mul(2)));
  const glint = pow(max(dot(sunMirrored, view), 0), preset.specularPower)
    .mul(preset.specularIntensity * GLINT_SCALE).mul(vec3(...preset.sunColor));

  // The tile in the ground's shade, plus the body -- floor and sky at the
  // class weight -- plus the glint, all in linear light.
  const ground = textureNode(options.tile, uv()).rgb.mul(attribute('color', 'vec3'));
  const water = floor.add(sky).mul(attribute('surfaceWeight', 'float'));
  const material = new THREE.MeshBasicNodeMaterial({
    side: THREE.DoubleSide, transparent: options.masked !== undefined, depthWrite: false,
  });
  material.colorNode = ground.add(water).add(glint);
  if (options.masked) {
    const shape = textureNode(options.masked, uv(1)).r;
    material.opacityNode = options.overlay ? shape.mul(textureNode(options.overlay, uv()).r) : shape;
  }
  return material;
}
