/**
 * The water surface, the way the reference draws it: a shader over the tile.
 *
 * AoE2DE's `Water_ps` takes a normal map (`g_WaterSurfaceTexture`), a sea
 * floor (`g_SeaFloorTexture`), a sky dome (`g_SkyDomeTexture`), the depth,
 * visibility and beach-blend textures, the sun, and the colours and
 * intensities `water_def.json` states per preset. The shader ships with a
 * Shader Model 2 build beside its SM4 one (the DXBC's `Aon9` chunk), and SM2
 * bytecode is a documented token stream, so the combination is read rather
 * than guessed:
 *
 *     colour = (floor * seaFloorIntensity * waterColour
 *               + sky * skyIntensity * skyColor) * depth.a
 *              + pow(max(dot(reflect(L, N), V), 0), specularPower)
 *                * specularColor * specularIntensity * visibility
 *
 * where `sky` is the dome looked up at `0.5 + skyDomeMtx * reflect(V, N).xy`,
 * `floor` the sea floor at the world position pushed by the normal, and `N`
 * the surface texture's height gradient over several drifting taps, scaled
 * by `waveAmplitude`.
 *
 * What that colour is added to is the water terrain's own texture, drawn as
 * ground like any other. DE ships a texture per depth (`g_wtr` for `Water,
 * Shallow`, `g_wt3` for `Water, Medium`), and a screenshot of its Islands
 * shows the coastal rim at (82, 172, 220) and the open sea at (64, 135,
 * 183): each about (45, 52, 57) above its own texture, one offset over two
 * textures, which is what a surface added to a drawn tile gives and a
 * surface in place of it does not. The offset is the dome's own colour at
 * the lookup, times the preset's sky terms, times its per-class `opacity`
 * (32/255 for the Default preset's shallow and normal classes) -- (26, 53,
 * 56), the green and blue within five of the screenshot -- with every
 * texture read as its stored values and the sum taken in display space, as
 * a renderer without colour management takes it. So the tile, the surface
 * and the glint are composed here in display space and handed back through
 * the sRGB EOTF, which the renderer's own output encoding undoes; added in
 * linear light the same weight came out at half the reference's offset. The
 * ripple's scale in tiles is the one thing not read: the world unit the
 * shader's `mapScale` divides is not stated.
 */
import * as THREE from 'three/webgpu';
import {
  attribute, dot, max, normalize, pow, sRGBTransferEOTF, sRGBTransferOETF, texture as textureNode, time,
  uv, vec2, vec3,
} from 'three/tsl';
import { isOpenWater } from '../sim/mapgen';
import { random01, seedFrom } from '../sim/random';
import type { GameState } from '../sim/types';
import type { ContentAssets, WaterPreset } from './assets';

/**
 * Ripples repeat every this many tiles; the normal map is 1024 px square,
 * its crests run along its rows with finer ripples on them, and the world
 * unit `mapScale` divides is not stated. Six tiles puts the fine ripples at
 * about an eighth of a tile, which is the streak spacing in a screenshot of
 * the reference at the same zoom.
 */
const RIPPLE_TILES = 6;
/**
 * The reference builds its normal as `normalize(gradient * amplitude, 0.1)`
 * over height taps, which is a rough surface: facets steep enough that the
 * sun's glint catches on many of them, and the reference's water is covered
 * in those glints. The normal map's own tilt stands in for the gradient and
 * is scaled until the glints are as dense as the screenshot's -- 120 per
 * unit of amplitude, where 20 left the surface flat and glintless.
 */
const TILT_PER_AMPLITUDE = 120;
/**
 * The vector from the water to the eye, in world tiles with z up: the camera
 * sits off the screen's bottom edge, which is world +x+y, and looks down at
 * the reference's 30 degrees. The shader's `t2` is this vector -- its
 * specular term is `dot(reflect(L, N), t2)`, which only reads as a glint if
 * `t2` points at the eye -- and its sky lookup mirrors it about the normal
 * and turns the result by `sky_rotation`, which for this camera lands a
 * flat surface on the dome's blue half; the 178.5 degrees were evidently
 * chosen for that.
 */
const VIEW = new THREE.Vector3(Math.SQRT1_2 * Math.cos(Math.PI / 6), Math.SQRT1_2 * Math.cos(Math.PI / 6), Math.sin(Math.PI / 6)).normalize();
/**
 * Which preset a board's water takes. Arabia's script rolls `WATER_POND`
 * (includes/water_preset.inc: 65% Calm, 35% Dimmed) for its ponds, and
 * Islands names none, which is the engine's Default. The board says which
 * it is -- a sea is most of the board, a pond is not -- and the roll is
 * made from the match seed so it holds for the match and touches nothing
 * the simulation draws on.
 */
export function waterPresetFor(state: GameState, assets: ContentAssets): WaterPreset | undefined {
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
  /** The water terrain's own texture, which the surface is added to. */
  tile: THREE.Texture;
  /** Fade the whole through the blend mask in `uv1` (water lapping onto a
   * neighbouring tile). */
  masked?: THREE.Texture;
}

/**
 * The weight the surface is added at over a water terrain: the preset's
 * `opacity` for the terrain's class, as a fraction. A terrain that names no
 * class the preset carries takes the `normal` row.
 */
export function surfaceOpacity(preset: WaterPreset, waterClass: string | null | undefined): number {
  const row = (waterClass && preset.types[waterClass]) || preset.types.normal;
  return (row?.opacity ?? 32) / 255;
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
  const normalMap = assets.textures.get(preset.normal);
  const skyMap = assets.textures.get(preset.sky);
  const floorMap = assets.textures.get(preset.seaFloor);
  if (!normalMap || !skyMap || !floorMap) throw new Error(`water preset ${preset.name} has no textures`);

  const tiles = uv().mul(options.span);
  // The surface texture is laid along the screen, not the tile axes: its
  // crests run along its rows, and in the reference they lie across the
  // screen, where along the tile axes they would run diagonally. Screen
  // right is the tile diagonal (x - y), screen down is (x + y).
  const along = vec2(tiles.x.sub(tiles.y), tiles.x.add(tiles.y)).mul(Math.SQRT1_2);
  // The shader samples its surface at taps drifting along (0.375, 0.625)
  // and (0.2, 1) of the wave speed, over the wave's repeat length; two
  // taps of the normal map along the same drifts stand in for its height
  // taps, and the preset's amplitude sets how far they tilt the surface.
  const speed = time.mul(preset.waveAnimationSpeed * 0.02);
  const ripple = along.div(RIPPLE_TILES).add(speed.mul(vec2(0.375, 0.625)));
  const ripple2 = along.div(RIPPLE_TILES * 2.3).add(speed.mul(vec2(0.2, 1))).add(vec2(0.37, 0.71));
  const n1 = textureNode(normalMap, ripple).rgb.mul(2).sub(1);
  const n2 = textureNode(normalMap, ripple2).rgb.mul(2).sub(1);
  const tilt = preset.waveAmplitude * TILT_PER_AMPLITUDE;
  const normal = normalize(vec3(n1.xy.add(n2.xy).mul(tilt), 1));

  // The eye vector mirrored about the normal looks up the sky dome: a
  // fisheye of the hemisphere, zenith at the centre, its xy turned by
  // `sky_rotation` and scaled by `sky_scale`, exactly as the shader does it.
  const view = vec3(VIEW.x, VIEW.y, VIEW.z);
  // The sun is stated in the shader's own world frame, which is not the
  // tile frame: the reference's water is covered in its glint, and a glint
  // at power 1600 only reaches the eye from facets that mirror the sun
  // almost exactly, so the sun stands behind the camera. It is placed at
  // the eye's azimuth, at the elevation the preset gives it (z 0.45, about
  // 27 degrees against the camera's 30); in the tile frame as stated, its
  // mirror lies 78 degrees from the eye and nothing glints.
  const elevation = preset.sunDirection[2];
  const sun = normalize(vec3(VIEW.x * Math.sqrt(1 - elevation * elevation) / Math.hypot(VIEW.x, VIEW.y),
    VIEW.y * Math.sqrt(1 - elevation * elevation) / Math.hypot(VIEW.x, VIEW.y), elevation));
  const reflected = view.sub(normal.mul(dot(normal, view).mul(2)));
  const rotation = (preset.skyRotation * Math.PI) / 180;
  const rx = reflected.x.mul(Math.cos(rotation)).sub(reflected.y.mul(Math.sin(rotation)));
  const ry = reflected.x.mul(Math.sin(rotation)).add(reflected.y.mul(Math.cos(rotation)));
  // Direct3D's v runs down the image and three's runs up it, so the dome's
  // v is turned over.
  const skyUv = vec2(rx.mul(preset.skyScale).add(0.5), ry.mul(-preset.skyScale).add(0.5));
  // The dome and the floor as stored: the renderer decodes an sRGB texture
  // on sampling, and the reference's arithmetic is on the stored values.
  const sky = sRGBTransferOETF(textureNode(skyMap, skyUv).rgb)
    .mul(vec3(...preset.skyColor)).mul(preset.skyIntensity);

  // The floor at the world position pushed by the normal, over the preset's
  // floor scale; under its intensity and the water's own colour.
  const floorUv = tiles.add(normal.xy).div(preset.seaFloorScale);
  const floor = sRGBTransferOETF(textureNode(floorMap, floorUv).rgb)
    .mul(preset.seaFloorIntensity).mul(vec3(...preset.waterColor));

  // The sun reflected about the normal, against the view: the glint, at the
  // preset's power, in the preset's specular colour.
  const sunMirrored = sun.sub(normal.mul(dot(normal, sun).mul(2)));
  const glint = pow(max(dot(sunMirrored, view), 0), preset.specularPower)
    .mul(preset.specularIntensity).mul(vec3(...preset.sunColor));

  // The tile in the ground's shade, plus the body -- floor and sky at the
  // depth texture's alpha, the class weight -- plus the glint, in display
  // space; then back through the EOTF for the renderer to encode again.
  const ground = sRGBTransferOETF(textureNode(options.tile, uv()).rgb).mul(attribute('color', 'vec3'));
  const water = floor.add(sky).mul(attribute('surfaceWeight', 'float'));
  const material = new THREE.MeshBasicNodeMaterial({
    side: THREE.DoubleSide, transparent: options.masked !== undefined, depthWrite: false,
  });
  material.colorNode = sRGBTransferEOTF(ground.add(water).add(glint).clamp(0, 1));
  if (options.masked) {
    material.opacityNode = textureNode(options.masked, uv(1)).r;
  }
  return material;
}
