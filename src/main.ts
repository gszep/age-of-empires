import * as THREE from 'three/webgpu';
import './view/style.css';
import { exampleAiCommands } from './sim/ai';
import { observe } from './sim/observe';
import { applyCommand, createGame, nearestEntity, stepGame } from './sim/game';
import type { BuildingKind, Entity, Point } from './sim/types';
import { createMilitiaMesh, loadMilitiaAssets, updateMilitiaMesh } from './view/militia';

const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
  <div id="hud">
    <div class="topbar" id="topbar"></div>
    <div id="message"></div>
    <div class="status" id="status"></div>
    <div class="actions" id="actions"></div>
  </div>
  <div class="rotate"><div><strong>Best played sideways</strong><br>Rotate your phone for the full battlefield.<br><button id="landscape">Enter landscape</button></div></div>`;

const renderer = new THREE.WebGPURenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.6));
renderer.setSize(innerWidth, innerHeight);
app.prepend(renderer.domElement);
await renderer.init();
const militiaAssets = await loadMilitiaAssets();

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x526f45);
const camera = new THREE.OrthographicCamera(-16, 16, 9, -9, 0.1, 100);
camera.position.set(0, 0, 30);
camera.lookAt(0, 0, 0);

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(32, 18),
  new THREE.MeshBasicMaterial({ color: 0x78945c }),
);
scene.add(ground);

const midline = new THREE.Mesh(
  new THREE.PlaneGeometry(0.06, 17.5),
  new THREE.MeshBasicMaterial({ color: 0xc7d8a5, transparent: true, opacity: 0.18 }),
);
midline.position.z = 0.01;
scene.add(midline);

let game = createGame(42);
let selectedIds: number[] = [];
let buildMode: BuildingKind | undefined;
let paused = false;
let aiClock = 0;
const meshes = new Map<number, THREE.Object3D>();
const selectionRings = new THREE.Group();
scene.add(selectionRings);

const ownerColors = { 0: 0xffffff, 1: 0x3b8cff, 2: 0xef4747 } as const;

function geometryFor(entity: Entity): THREE.BufferGeometry {
  if (entity.kind === 'town-center') return new THREE.BoxGeometry(2.5, 2.5, 0.55);
  if (entity.kind === 'barracks') return new THREE.BoxGeometry(2, 2, 0.45);
  if (entity.kind === 'house') return new THREE.ConeGeometry(0.8, 1.4, 4);
  if (entity.kind === 'resource' && entity.resourceKind === 'wood') return new THREE.CircleGeometry(0.52, 8);
  if (entity.kind === 'resource') return new THREE.CircleGeometry(0.42, 12);
  if (entity.kind === 'militia') return new THREE.ConeGeometry(0.42, 0.9, 3);
  return new THREE.CircleGeometry(0.36, 16);
}

function colorFor(entity: Entity): number {
  if (entity.kind === 'resource') return entity.resourceKind === 'wood' ? 0x23552e : 0xd94d79;
  return ownerColors[entity.owner];
}

function syncScene(): void {
  const live = new Set(game.entities.map(e => e.id));
  for (const [id, mesh] of meshes) {
    if (!live.has(id)) { scene.remove(mesh); meshes.delete(id); }
  }
  for (const entity of game.entities) {
    let object = meshes.get(entity.id);
    if (!object) {
      object = entity.kind === 'militia' && militiaAssets
        ? createMilitiaMesh(militiaAssets, entity.owner as 1 | 2)
        : new THREE.Mesh(geometryFor(entity), new THREE.MeshBasicMaterial({ color: colorFor(entity) }));
      object.userData.entityId = entity.id;
      meshes.set(entity.id, object);
      scene.add(object);
    }
    if (entity.kind === 'militia' && militiaAssets && object instanceof THREE.Mesh) {
      const order = entity.order;
      const target = order.kind === 'move'
        ? order.target
        : order.kind === 'attack' || order.kind === 'gather'
          ? game.entities.find(candidate => candidate.id === order.targetId)?.position
          : undefined;
      updateMilitiaMesh(militiaAssets, object, entity, target, game.time);
    }
    const offset = object.userData.spriteOffset ?? { x: 0, y: 0 };
    object.position.set(entity.position.x - game.width / 2 + offset.x, entity.position.y - game.height / 2 + offset.y, entity.kind === 'resource' ? 0.08 : 0.18);
    if (entity.kind === 'house' || (entity.kind === 'militia' && !militiaAssets)) object.rotation.z = Math.PI;
    if (!object.userData.militia) {
      const health = Math.max(0.25, entity.hp / entity.maxHp);
      object.scale.set(health < 0.99 ? 0.92 + health * 0.08 : 1, health < 0.99 ? 0.92 + health * 0.08 : 1, 1);
    }
  }

  selectionRings.clear();
  for (const id of selectedIds) {
    const entity = game.entities.find(e => e.id === id);
    if (!entity) continue;
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(entity.radius + 0.12, entity.radius + 0.23, 24),
      new THREE.MeshBasicMaterial({ color: 0xffe177, side: THREE.DoubleSide }),
    );
    ring.position.set(entity.position.x - game.width / 2, entity.position.y - game.height / 2, 0.12);
    selectionRings.add(ring);
  }
}

function worldPoint(event: PointerEvent): Point {
  const rect = renderer.domElement.getBoundingClientRect();
  const ndc = new THREE.Vector2(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1,
  );
  const ray = new THREE.Raycaster();
  ray.setFromCamera(ndc, camera);
  const hit = new THREE.Vector3();
  ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), hit);
  return { x: hit.x + game.width / 2, y: hit.y + game.height / 2 };
}

function showMessage(text: string): void {
  const message = document.querySelector<HTMLDivElement>('#message')!;
  message.textContent = text;
  message.classList.add('show');
  window.setTimeout(() => message.classList.remove('show'), 1300);
}

renderer.domElement.addEventListener('pointerdown', event => {
  const point = worldPoint(event);
  if (point.x < 0 || point.x > game.width || point.y < 0 || point.y > game.height) return;
  if (buildMode) {
    const builder = game.entities.find(e => selectedIds.includes(e.id) && e.owner === 1 && e.kind === 'villager');
    const result = builder
      ? applyCommand(game, { kind: 'build', player: 1, builderId: builder.id, building: buildMode, target: point })
      : { ok: false as const, reason: 'select a villager first' };
    showMessage(result.ok ? `${buildMode} built` : result.reason);
    buildMode = undefined;
    return;
  }
  const target = nearestEntity(game, point);
  if (target?.owner === 1) {
    selectedIds = [target.id];
    return;
  }
  const units = game.entities.filter(e => selectedIds.includes(e.id) && (e.kind === 'villager' || e.kind === 'militia'));
  if (units.length) applyCommand(game, { kind: 'order', player: 1, entityIds: units.map(e => e.id), target: point, targetId: target?.id });
  else selectedIds = [];
});

function selected(): Entity | undefined { return game.entities.find(e => e.id === selectedIds[0]); }

function updateHud(): void {
  const p = game.players[1];
  document.querySelector('#topbar')!.innerHTML = `
    <span>🍖 ${Math.floor(p.food)}</span><span>🪵 ${Math.floor(p.wood)}</span><span>👥 ${p.population}/${p.populationCap}</span>
    <span class="spacer"></span><span>${Math.floor(game.time / 60)}:${String(Math.floor(game.time % 60)).padStart(2, '0')}</span>
    <button data-action="pause">${paused ? '▶' : 'Ⅱ'}</button><button data-action="fullscreen">⛶</button>`;
  const entity = selected();
  const status = document.querySelector<HTMLDivElement>('#status')!;
  status.innerHTML = game.winner
    ? `<strong>${game.winner === 1 ? 'Victory!' : 'Defeat'}</strong><br><button data-action="restart">Play again</button>`
    : entity ? `<strong>${entity.kind}</strong><br>HP ${Math.ceil(entity.hp)}/${entity.maxHp}${buildMode ? `<br>Tap map to place ${buildMode}` : ''}`
    : 'Tap a blue unit or building.<br>Then tap ground, resources, or enemies.';
  const actions: string[] = [];
  if (entity?.kind === 'town-center') actions.push('<button data-action="villager">Train villager · 50 🍖</button>');
  if (entity?.kind === 'barracks') actions.push('<button data-action="militia">Train militia · 60 🍖 20 🪵</button>');
  if (entity?.kind === 'villager') {
    actions.push('<button data-action="barracks">Build barracks · 175 🪵</button>');
    actions.push('<button data-action="house">Build house · 25 🪵</button>');
  }
  if (game.entities.some(e => e.owner === 1 && e.kind === 'militia')) actions.push('<button data-action="army">Select army</button>');
  document.querySelector('#actions')!.innerHTML = actions.join('');
}

async function enterLandscape(): Promise<void> {
  try {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
    const orientation = screen.orientation as ScreenOrientation & { lock?: (mode: 'landscape') => Promise<void> };
    await orientation.lock?.('landscape');
  } catch { showMessage('Rotate your phone manually'); }
}

document.querySelector('#hud')!.addEventListener('pointerdown', event => event.stopPropagation());
document.querySelector('#hud')!.addEventListener('click', event => {
  const action = (event.target as HTMLElement).closest<HTMLButtonElement>('button')?.dataset.action;
  const entity = selected();
  if (action === 'pause') paused = !paused;
  if (action === 'fullscreen') void enterLandscape();
  if (action === 'restart') { game = createGame(Date.now() >>> 0); selectedIds = []; paused = false; }
  if (action === 'army') selectedIds = game.entities.filter(e => e.owner === 1 && e.kind === 'militia').map(e => e.id);
  if ((action === 'villager' || action === 'militia') && entity) {
    const result = applyCommand(game, { kind: 'train', player: 1, buildingId: entity.id, unit: action });
    if (!result.ok) showMessage(result.reason);
  }
  if (action === 'barracks' || action === 'house') buildMode = action;
});
document.querySelector('#landscape')!.addEventListener('click', () => void enterLandscape());

function resize(): void {
  const aspect = innerWidth / innerHeight;
  const mapAspect = game.width / game.height;
  if (aspect > mapAspect) {
    camera.left = -9 * aspect; camera.right = 9 * aspect; camera.top = 9; camera.bottom = -9;
  } else {
    camera.left = -16; camera.right = 16; camera.top = 16 / aspect; camera.bottom = -16 / aspect;
  }
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
}
addEventListener('resize', resize);
resize();

let previous = performance.now();
let accumulator = 0;
let lastHud = 0;
renderer.setAnimationLoop(now => {
  const elapsed = Math.min(0.1, (now - previous) / 1000);
  previous = now;
  if (!paused) accumulator += elapsed;
  while (accumulator >= 0.05) {
    stepGame(game, 0.05);
    aiClock += 0.05;
    if (aiClock >= 0.5) {
      for (const command of exampleAiCommands(observe(game, 2))) applyCommand(game, command);
      aiClock = 0;
    }
    accumulator -= 0.05;
  }
  selectedIds = selectedIds.filter(id => game.entities.some(e => e.id === id));
  syncScene();
  if (now - lastHud > 200) { updateHud(); lastHud = now; }
  renderer.render(scene, camera);
});
