/**
 * The water surface, the way the reference draws it: a shader, not a tile.
 *
 * AoE2DE's `Water_ps` takes a normal map (`g_WaterSurfaceTexture`), a sea
 * floor (`g_SeaFloorTexture`), a sky dome (`g_SkyDomeTexture`), a depth
 * texture, the sun, and the colours and intensities `water_def.json` states
 * per preset; the classic `g_wtr` tile is never drawn. This is that shader
 * reconstructed from its inputs: the normal map drifts across the water and
 * bends a view ray, the bent ray looks up the sky dome for a reflection and
 * down through the water at the floor, and the sun glints where the ripple
 * faces it. What the preset states is used as it is stated; how the terms
 * are combined is not in any owned file (the shader is compiled), so the
 * combination here is calibrated to the reference's own screenshots and
 * recorded as an approximation in docs/status.md.
 */
import * as THREE from 'three/webgpu';
import {
  attribute, dot, float, max, mix, normalize, pow, reflect, texture as textureNode, time, uv, vec2,
  vec3,
} from 'three/tsl';
import { TERRAIN_WATER } from '../sim/mapgen';
import { random01, seedFrom } from '../sim/random';
import type { GameState } from '../sim/types';
import type { ContentAssets, WaterPreset } from './assets';

/** Ripples repeat every this many tiles; the normal map is 1024 px square. */
const RIPPLE_TILES = 8;
/** How far a ripple bends the reflected ray, in the dome's own units. */
const RIPPLE_STRENGTH = 0.5;
/**
 * Open water under the Default preset, as the reference's own screenshots
 * show it: (56, 124, 192), measured over the sea in the official Islands
 * shots. The preset's `water_color` and the sky's light vary it from here;
 * how the reference's compiled shader arrives at this from a grey-blue sky
 * dome and a green sea floor is not in any owned file, so this is the one
 * calibrated constant -- see docs/status.md.
 */
const OPEN_WATER = new THREE.Color().setRGB(56 / 255, 124 / 255, 192 / 255, THREE.SRGBColorSpace);
/**
 * The view ray of the dimetric camera in the water's own frame (x east, y
 * south, z up): looking down at the reference's 30 degrees.
 */
const VIEW = new THREE.Vector3(0, -Math.cos(Math.PI / 6), Math.sin(Math.PI / 6)).normalize();

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
  for (const id of state.terrain) if (id === TERRAIN_WATER) wet++;
  if (wet > state.terrain.length * 0.3) return water['0'];
  const roll = random01({ seed: seedFrom(state.matchSeed ^ 0x7a7e_12) });
  return (roll < 0.65 ? water['3'] : water['6']) ?? water['0'];
}

export interface WaterMaterialOptions {
  /** Tiles per texture repeat of the mesh's `uv`, so the shader can work in tiles. */
  span: number;
  /** Fade the surface through the blend mask in `uv1` (an overlay onto a shore tile). */
  masked?: THREE.Texture;
}

/**
 * A water material for one preset. The mesh supplies `uv` in texture
 * repeats (tile / span) like every terrain mesh, and optionally a `depth`
 * attribute, 0 at the shore and 1 in open water, that decides how much of
 * the floor shows: shallow water is clearer, which is what makes the
 * lighter band along every reference coast.
 */
export function createWaterMaterial(
  assets: ContentAssets, preset: WaterPreset, options: WaterMaterialOptions,
): THREE.MeshBasicNodeMaterial {
  const normalMap = assets.textures.get(preset.normal);
  const skyMap = assets.textures.get(preset.sky);
  const floorMap = assets.textures.get(preset.seaFloor);
  if (!normalMap || !skyMap || !floorMap) throw new Error(`water preset ${preset.name} has no textures`);

  const tiles = uv().mul(options.span);
  // The normal map drifts along its direction turned by the azimuth, at the
  // preset's velocity; a second, larger layer drifting the other way keeps
  // the repeat from reading as a pattern.
  const azimuth = (preset.normalAzimuth * Math.PI) / 180;
  const [dx, dy] = preset.normalDirection[0];
  const drift = vec2(
    dx * Math.cos(azimuth) - dy * Math.sin(azimuth), dx * Math.sin(azimuth) + dy * Math.cos(azimuth),
  ).mul(preset.normalVelocity[0] * 0.25);
  const ripple = tiles.div(RIPPLE_TILES).add(time.mul(drift));
  const ripple2 = tiles.div(RIPPLE_TILES * 2.3).sub(time.mul(drift).mul(0.6)).add(vec2(0.37, 0.71));
  const n1 = textureNode(normalMap, ripple).rgb.mul(2).sub(1);
  const n2 = textureNode(normalMap, ripple2).rgb.mul(2).sub(1);
  const normal = normalize(vec3(n1.xy.add(n2.xy).mul(RIPPLE_STRENGTH), n1.z.add(n2.z)));

  // The reflected view ray looks up the sky dome: a fisheye of the hemisphere,
  // zenith at the centre, rotated and scaled as the preset says.
  const view = vec3(VIEW.x, VIEW.y, VIEW.z);
  const sun = normalize(vec3(...preset.sunDirection));
  const reflected = reflect(view.negate(), normal);
  const rotation = (preset.skyRotation * Math.PI) / 180;
  const rx = reflected.x.mul(Math.cos(rotation)).sub(reflected.y.mul(Math.sin(rotation)));
  const ry = reflected.x.mul(Math.sin(rotation)).add(reflected.y.mul(Math.cos(rotation)));
  const skyUv = vec2(rx, ry).mul(preset.skyScale).add(0.5);
  const sky = textureNode(skyMap, skyUv).rgb
    .mul(vec3(...preset.skyColor)).mul(preset.skyIntensity);

  // The floor, seen through the bent ray, more of it where the water is shallow.
  const floorUv = tiles.div(preset.seaFloorScale).add(normal.xy.mul(0.02));
  const floor = textureNode(floorMap, floorUv).rgb;
  const depth = attribute('depth', 'float');
  const clarity = mix(float(1), float(preset.seaFloorIntensity), depth);

  // The sun on the ripple: a Blinn glint, as sharp as the preset's power.
  const half = normalize(sun.add(view));
  const glint = pow(max(dot(normal, half), 0), preset.specularPower / 16)
    .mul(preset.specularIntensity).mul(vec3(...preset.sunColor));

  // How the terms meet is the calibration. The body is the reference's open
  // water under the preset's own colour, lit by the reflected sky -- the
  // dome is grey-blue and cloudy, so its luminance is what a ripple changes,
  // brighter where the ray meets cloud and darker where it meets blue. The
  // floor shows through in proportion to the preset's floor intensity, and
  // much more where the water is shallow, which is the light band along
  // every reference coast. The glint sits on top.
  // Lit by the sun across the ripple -- a crest that faces the sun is
  // brighter, the trough behind it darker -- and a little by the reflected
  // sky, whose clouds and blue give the surface its patchiness.
  const skyLuma = dot(sky, vec3(0.299, 0.587, 0.114)).div(preset.skyIntensity * 1.25);
  const facing = dot(normal, sun).sub(sun.z);
  const lit = float(0.74).add(facing.mul(1.6)).add(skyLuma.mul(0.35));
  const body = vec3(OPEN_WATER.r, OPEN_WATER.g, OPEN_WATER.b).mul(vec3(...preset.waterColor)).mul(lit);
  const floorShare = mix(float(0.35), float(preset.seaFloorIntensity * 0.5), depth);
  const water = mix(body, floor.mul(clarity.mul(0.5).add(0.6)), floorShare);
  const material = new THREE.MeshBasicNodeMaterial({
    side: THREE.DoubleSide, transparent: options.masked !== undefined, depthWrite: false,
  });
  material.colorNode = water.add(glint.mul(0.3));
  if (options.masked) {
    material.opacityNode = textureNode(options.masked, uv(1)).r;
  }
  return material;
}
