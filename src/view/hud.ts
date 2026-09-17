/**
 * AoE2DE WEST in-game HUD recreated from the imported widgetui geometry:
 * resource strip top-left, menu controls top-right, command grid bottom-left,
 * selection panel bottom-centre, minimap panel bottom-right. Falls back to an
 * open skin when imported assets are absent.
 */
import { materialUrl, iconUrl, type UiAssets } from './assets';
import { placeCommands } from './command-grid';
import { widgetBox } from './layout';
import { Minimap } from './minimap';
import type { GameState, PlayerId, Point } from '../sim/types';

/**
 * What the resource panel shows beside the stockpiles: who is gathering what,
 * how many stand idle, and the age -- its name, its shield, and how far the
 * next one has come.
 */
export interface ResourceStatus {
  workers: Record<'wood' | 'food' | 'gold' | 'stone', number>;
  /** How many villagers there are, the number under the population icon. */
  villagers: number;
  idle: number;
  ageName: string;
  /** The material of the age's shield, `ButtonsShield<Age>-AgeNormal`. */
  ageShield: string;
  /** 0..1 of the way to the next age, 0 when none is being researched. */
  ageProgress: number;
}

export interface CommandButton {
  id: string;
  label: string;
  /** Its cell in the grid, 1-15 across then down, where the DAT states one. */
  slot?: number;
  /** The reference's tooltip for it, already plain text, shown under the label. */
  help?: string;
  hotkey?: string;
  icon?: string; // css background url
  enabled: boolean;
  active?: boolean;
}

export interface SelectionInfo {
  name: string;
  icon?: string;
  /** Left off for something with no health to show: a carcass is read by the
   * food left on it, and the DAT gives its corpse unit no hit points at all. */
  hp?: number;
  maxHp?: number;
  details: string[];
  /**
   * The stat row the reference draws beside the portrait (`ObjectStats`):
   * each is one of the `staticons/` textures and a value. The DAT's own
   * `displayed_attack`/`_melee_armour`/`_pierce_armour`/`_range` are the
   * class-4 attack (else class-3), armour classes 4 and 3, and the range,
   * which is what these carry -- read through research, so an upgrade shows.
   */
  stats?: { icon: string; value: string; title: string }[];
  progress?: { label: string; fraction: number };
  /**
   * One entry per selected entity, when more than one is. AoE2 shows the
   * group as a grid of portraits rather than the first of them, and each is
   * clickable to single out that unit (issue #6).
   */
  members?: { id: number; name: string; icon?: string; hp: number; maxHp: number }[];
}

export interface HudCallbacks {
  onCommand(id: string): void;
  /** A portrait in the group grid was clicked: select that one entity. */
  onSelectMember(id: number): void;
  onMinimapNavigate(point: Point): void;
  /** The flare button, then a minimap click: signal that spot (canvas point). */
  onFlare(point: Point): void;
  onSelectIdleVillager(): void;
  onMenu(action: 'resume' | 'restart' | 'pause'): void;
  onReplayFile(record: unknown): void;
  onSound(alias: string): void;
}

const REFERENCE_WIDTH = 3840;

export class Hud {
  root: HTMLElement;
  minimap: Minimap;
  private commandGrid!: HTMLElement;
  private selectionPanel!: HTMLElement;
  private resourceValues: Record<string, HTMLElement> = {};
  private messageBox!: HTMLElement;
  private menuDialog!: HTMLElement;
  private endDialog!: HTMLElement;
  private buttons = new Map<string, HTMLButtonElement>();
  private lastCommandSignature = '';
  /** The flare button was pressed: the next minimap click drops one. */
  private flareArmed = false;
  private onResize = (): void => this.applyScale();

  constructor(
    parent: HTMLElement,
    private ui: UiAssets | undefined,
    private callbacks: HudCallbacks,
  ) {
    this.root = document.createElement('div');
    this.root.id = 'hud';
    if (!ui) this.root.classList.add('fallback');
    parent.appendChild(this.root);
    this.build();
    const canvas = this.root.querySelector<HTMLCanvasElement>('#minimap-canvas')!;
    this.minimap = new Minimap(canvas);
    this.applyScale();
    addEventListener('resize', this.onResize);
  }

  /** Detach every DOM node and listener this HUD owns (hot reload rebuilds it). */
  destroy(): void {
    removeEventListener('resize', this.onResize);
    this.root.remove();
  }

  private texture(name: string): string {
    const url = materialUrl(this.ui, name);
    return url ? `url('${url}')` : 'none';
  }

  private build(): void {
    this.root.innerHTML = `
      <div id="topbar-strip" class="panel"></div>
      <div id="resource-panel" class="panel">
        ${['wood', 'food', 'gold', 'stone'].map(resource => `
          <div class="resource-slot" data-resource="${resource}">
            <span class="resource-icon" data-icon="${resource}"><span class="workers" data-workers="${resource}"></span></span>
            <span class="resource-value" data-value="${resource}">0</span>
          </div>`).join('')}
        <div class="resource-slot" data-resource="population">
          <span class="resource-icon" data-icon="population"><span class="workers" data-workers="villagers"></span></span>
          <span class="resource-value" data-value="population">0/0</span>
        </div>
        <span class="workers idle-count" data-workers="idle"></span>
        <button class="idle-villager" data-command="idle-villager" title="Select idle villager (.)"></button>
        <div class="age-shield" data-age-shield></div>
        <div class="age-bar"><div class="age-fill"></div><div class="age-text" data-age-text></div></div>
      </div>
      <div id="menu-panel" class="panel">
        <button class="menu-button" data-icon="techtree" data-widget="Techtree" title="Technology tree (not yet available)" disabled></button>
        <button class="menu-button" data-icon="objectives" data-widget="Objectives" title="Objectives (not yet available)" disabled></button>
        <button class="menu-button" data-icon="chat" data-widget="Chat" title="Chat (not yet available)" disabled></button>
        <button class="menu-button" data-icon="diplomacy" data-widget="Diplomacy" title="Diplomacy (not yet available)" disabled></button>
        <button data-menu="pause" class="menu-button" data-icon="settings" data-widget="Settings" title="Pause (F3)"></button>
        <button data-menu="open" class="menu-button" data-icon="menu" data-widget="Menu" title="Menu (F10)"></button>
      </div>
      <div id="bottombar-strip" class="panel"></div>
      <div id="command-panel" class="panel"><div id="command-grid"></div></div>
      <div id="selection-panel" class="panel"><div id="civ-emblem"></div><div id="selection-content"></div></div>
      <div id="map-panel" class="panel">
        <canvas id="minimap-canvas" width="240" height="130"></canvas>
        <button class="map-button" data-widget="ButtonFlare" data-map="flare" title="Flare: click the minimap to signal a spot"></button>
        <button class="map-button" data-widget="ButtonPlayer" data-map="players" title="Player statistics (not yet available)" disabled></button>
        <button class="map-button" data-widget="ButtonColor" data-map="color" title="Minimap colours (not yet available)" disabled></button>
        <button class="map-button" data-widget="ButtonFilter" data-map="filter" title="Minimap filter (not yet available)" disabled></button>
      </div>
      <div id="game-message"></div>
      <div id="menu-dialog" class="dialog hidden">
        <h2>Menu</h2>
        <button data-menu="resume">Resume</button>
        <button data-menu="restart">Restart</button>
        <button data-menu="load-replay">Load replay…</button>
        <input id="replay-file" type="file" accept=".json" style="display:none">
      </div>
      <div id="end-dialog" class="dialog hidden"><h2 id="end-title"></h2><button data-menu="restart">Play again</button></div>
    `;

    // Imported panel art.
    const style = (selector: string, material: string) => {
      const element = this.root.querySelector<HTMLElement>(selector)!;
      element.style.backgroundImage = this.texture(material);
    };
    style('#topbar-strip', 'CivWestTopbar');
    style('#bottombar-strip', 'CivWestBottombar');
    style('#resource-panel', 'CivWestResourcePanel');
    style('#menu-panel', 'CivWestMenuPanel');
    style('#command-panel', 'CivWestCommandPanelExtended');
    style('#selection-panel', 'CivWestSingleSelectionPanel');
    style('#map-panel', 'CivWestMapPanel');
    this.placeFromWidgets();
    const resourceIcons: Record<string, string> = {
      wood: 'ResourceWood', food: 'ResourceFood', gold: 'ResourceGold', stone: 'ResourceStone',
      population: 'Population',
    };
    for (const [key, material] of Object.entries(resourceIcons)) {
      const element = this.root.querySelector<HTMLElement>(`[data-icon="${key}"]`);
      if (element) element.style.backgroundImage = this.texture(material);
    }
    const idle = this.root.querySelector<HTMLElement>('.idle-villager')!;
    idle.style.backgroundImage = this.texture('IdleVillagerNormal');
    // The menu panel's six buttons (menupanel.json), each in its own box
    // (issue #66). The tech tree's is the civilisation's shield -- the
    // material is `IconsMenuTechtree<Civ>`, the engine's per-civ substitute
    // for the file's Aztecs placeholder -- and it is what says who you are
    // playing. What has nothing behind it yet wears its Disabled state.
    const menuArt: Record<string, string> = {
      techtree: 'IconsMenuTechtreeBritons', objectives: 'MenuObjectives', chat: 'MenuChat',
      diplomacy: 'MenuDiplomacy', settings: 'MenuSettings', menu: 'MenuMenu',
    };
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('#menu-panel .menu-button')) {
      const base = menuArt[button.dataset.icon!];
      const state = button.dataset.icon === 'techtree' ? '' : (button.disabled ? 'Disabled' : 'Normal');
      button.style.backgroundImage = this.texture(base + state);
    }

    for (const resource of ['wood', 'food', 'gold', 'stone', 'population']) {
      this.resourceValues[resource] = this.root.querySelector(`[data-value="${resource}"]`)!;
    }
    this.commandGrid = this.root.querySelector('#command-grid')!;
    this.selectionPanel = this.root.querySelector('#selection-content')!;
    this.messageBox = this.root.querySelector('#game-message')!;
    this.menuDialog = this.root.querySelector('#menu-dialog')!;
    this.endDialog = this.root.querySelector('#end-dialog')!;

    this.root.addEventListener('pointerdown', event => event.stopPropagation());
    this.root.addEventListener('click', event => {
      const target = event.target as HTMLElement;
      const command = target.closest<HTMLElement>('[data-command]')?.dataset.command;
      if (command === 'idle-villager') this.callbacks.onSelectIdleVillager();
      else if (command) this.callbacks.onCommand(command);
      const map = target.closest<HTMLElement>('[data-map]')?.dataset.map;
      if (map === 'flare') {
        this.flareArmed = !this.flareArmed;
        target.closest<HTMLElement>('[data-map]')!.classList.toggle('active', this.flareArmed);
        return;
      }
      const menu = target.closest<HTMLElement>('[data-menu]')?.dataset.menu;
      if (command || menu) this.callbacks.onSound('button_ui');
      if (menu === 'open') this.toggleMenu(true);
      else if (menu === 'resume') { this.toggleMenu(false); this.callbacks.onMenu('resume'); }
      else if (menu === 'pause') this.callbacks.onMenu('pause');
      else if (menu === 'restart') { this.toggleMenu(false); this.callbacks.onMenu('restart'); }
      else if (menu === 'load-replay') this.root.querySelector<HTMLInputElement>('#replay-file')!.click();
    });
    this.root.querySelector<HTMLInputElement>('#replay-file')!.addEventListener('change', async event => {
      const file = (event.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        this.callbacks.onReplayFile(JSON.parse(await file.text()));
        this.toggleMenu(false);
      } catch {
        this.showMessage('Not a valid replay file');
      }
    });
    const minimapCanvas = this.root.querySelector<HTMLCanvasElement>('#minimap-canvas')!;
    const navigate = (event: PointerEvent) => {
      const rect = minimapCanvas.getBoundingClientRect();
      const x = (event.clientX - rect.left) / rect.width * minimapCanvas.width;
      const y = (event.clientY - rect.top) / rect.height * minimapCanvas.height;
      this.callbacks.onMinimapNavigate({ x, y });
    };
    minimapCanvas.addEventListener('pointerdown', event => {
      // An armed flare takes the click instead of the camera.
      if (this.flareArmed) {
        this.flareArmed = false;
        this.root.querySelector('[data-map="flare"]')?.classList.remove('active');
        const rect = minimapCanvas.getBoundingClientRect();
        this.callbacks.onFlare({
          x: (event.clientX - rect.left) / rect.width * minimapCanvas.width,
          y: (event.clientY - rect.top) / rect.height * minimapCanvas.height,
        });
        return;
      }
      navigate(event);
      const move = (moveEvent: PointerEvent) => navigate(moveEvent);
      const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); };
      addEventListener('pointermove', move);
      addEventListener('pointerup', up);
    });
  }

  /** Uniform HUD scale from the 3840x2160 widget reference space. */
  /**
   * Put a panel's contents where the shipped widget data says they go.
   *
   * Our panel elements are the panel art exactly — `map-panel.png` is 860x413
   * and the `Background` widget that draws it is 860x413 — so a widget's box
   * inside that background is a box inside our element. Centring the minimap
   * in its panel by flexbox instead put it at 70 where the data says 112, over
   * the left border decoration, and the command grid's hand-picked 36px of top
   * padding sat 54 above the anchor the buttons actually hang off (issue #35).
   *
   * The open fallback draws no panel art and has no decorations to line up
   * with, so it keeps the plain CSS composition.
   */
  private placeFromWidgets(): void {
    const place = (selector: string, box: { left: number; top: number; width: number; height: number } | undefined, sized: boolean): void => {
      if (!box) return;
      const element = this.root.querySelector<HTMLElement>(selector);
      if (!element) return;
      const scaled = (value: number): string => `calc(${value}px * var(--ui-scale))`;
      element.style.position = 'absolute';
      element.style.left = scaled(box.left);
      element.style.top = scaled(box.top);
      if (sized) {
        element.style.width = scaled(box.width);
        element.style.height = scaled(box.height);
      }
    };
    // The minimap's own window in the map panel, and the anchor the command
    // grid's five-by-three block of buttons hangs off. The grid's 80px cells
    // and 14px gaps already match the buttons' own 94px stride.
    place('#minimap-canvas', widgetBox(this.ui?.layouts.mappanel, 'Background', 'MapView'), true);
    place('#command-grid', widgetBox(this.ui?.layouts.commandpanel, 'BackgroundLeft', 'Buttons'), false);
    // The resource panel's own boxes (resourcepanel.json): each icon 84x84,
    // its `Workers` count inside it, the storage label beside it, the idle
    // button with its count, the age shield (`AgeUp`) and the age bar with
    // its text (issue #65). The workers count is anchored TopRight in a
    // 60x32 label at (16,55) inside the icon.
    const resources = this.ui?.layouts.resourcepanel;
    if (resources) this.root.querySelector('#resource-panel')!.classList.add('placed');
    for (const [resource, widget] of [['wood', 'Wood'], ['food', 'Food'], ['gold', 'Gold'], ['stone', 'Stone'], ['population', 'Population']] as const) {
      const slot = this.root.querySelector<HTMLElement>(`.resource-slot[data-resource="${resource}"]`);
      const icon = widgetBox(resources, 'Background', widget);
      if (slot && icon) {
        place(`.resource-slot[data-resource="${resource}"]`, icon, true);
        const workers = widgetBox(resources, widget, 'Workers');
        const count = slot.querySelector<HTMLElement>('.workers');
        if (workers && count) {
          count.style.left = `calc(${workers.left}px * var(--ui-scale))`;
          count.style.top = `calc(${workers.top}px * var(--ui-scale))`;
          count.style.width = `calc(${workers.width}px * var(--ui-scale))`;
          count.style.height = `calc(${workers.height}px * var(--ui-scale))`;
        }
        const storage = widgetBox(resources, 'Background', resource === 'population' ? 'PopulationCount' : `${widget}Storage`);
        const value = slot.querySelector<HTMLElement>('.resource-value');
        if (storage && value) {
          value.style.left = `calc(${storage.left - icon.left}px * var(--ui-scale))`;
          value.style.top = `calc(${storage.top - icon.top}px * var(--ui-scale))`;
          value.style.height = `calc(${storage.height}px * var(--ui-scale))`;
        }
      }
    }
    // The map panel's four buttons (mappanel.json): flare, player stats, and
    // the colour and filter modes (issue #68). Only the flare does anything
    // yet; the file gives the two modes one shared material and the engine
    // swaps in the current mode's, so the full-colour and show-all icons are
    // what the reference shows at rest.
    const mapArt: Record<string, string> = {
      flare: 'MinimapFlareNormal', players: 'MinimapPlayerStatsNormal',
      color: 'MinimapColorFullNormal', filter: 'MinimapFilterAllNormal',
    };
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('#map-panel .map-button')) {
      button.style.backgroundImage = this.texture(mapArt[button.dataset.map!]);
      place(`#map-panel [data-widget="${button.dataset.widget}"]`,
        widgetBox(this.ui?.layouts.mappanel, 'Background', button.dataset.widget!), true);
    }
    for (const button of this.root.querySelectorAll<HTMLElement>('#menu-panel [data-widget]')) {
      place(`#menu-panel [data-widget="${button.dataset.widget}"]`,
        widgetBox(this.ui?.layouts.menupanel, 'Background', button.dataset.widget!), true);
    }
    place('.idle-villager', widgetBox(resources, 'Background', 'Idle'), true);
    place('.idle-count', widgetBox(resources, 'Background', 'IdleWorkers'), true);
    place('.age-shield', widgetBox(resources, 'Background', 'AgeUp'), true);
    place('.age-bar', widgetBox(resources, 'Background', 'AgeBar'), true);
    const ageBar = this.root.querySelector<HTMLElement>('.age-bar');
    if (ageBar && resources) ageBar.querySelector<HTMLElement>('.age-fill')!.style.backgroundImage = this.texture('AgeBar');
    // The faded emblem on the empty parchment: the `CivEmblem` widget, whose
    // material the engine picks per civilisation (`CivEmblemBritons`).
    place('#civ-emblem', widgetBox(this.ui?.layouts.commandpanel, 'BackgroundRight', 'CivEmblem'), true);
    const emblem = this.root.querySelector<HTMLElement>('#civ-emblem');
    if (emblem) emblem.style.backgroundImage = this.texture('CivEmblemBritons');
  }

  private applyScale(): void {
    const scale = Math.max(0.24, Math.min(0.62, innerWidth / REFERENCE_WIDTH));
    this.root.style.setProperty('--ui-scale', String(scale));
  }

  toggleMenu(open?: boolean): void {
    const wantOpen = open ?? this.menuDialog.classList.contains('hidden');
    this.menuDialog.classList.toggle('hidden', !wantOpen);
  }

  get menuOpen(): boolean {
    return !this.menuDialog.classList.contains('hidden');
  }

  showMessage(text: string): void {
    this.messageBox.textContent = text;
    this.messageBox.classList.add('show');
    window.setTimeout(() => this.messageBox.classList.remove('show'), 1600);
  }

  setCommands(buttons: CommandButton[]): void {
    const signature = JSON.stringify(buttons);
    if (signature === this.lastCommandSignature) return;
    this.lastCommandSignature = signature;
    this.commandGrid.innerHTML = '';
    this.buttons.clear();
    const blank = this.texture('ButtonCmdIconNormal');
    // Every cell is rendered, empty ones as a spacer, so a button's cell is
    // its position on screen and not its rank in the list.
    for (const button of placeCommands(buttons)) {
      if (!button) {
        const spacer = document.createElement('div');
        spacer.className = 'command-cell';
        this.commandGrid.appendChild(spacer);
        continue;
      }
      const element = document.createElement('button');
      element.className = 'command-button';
      element.dataset.command = button.id;
      element.disabled = !button.enabled;
      element.title = `${button.label}${button.hotkey ? ` (${button.hotkey.toUpperCase()})` : ''}`
        + (button.help ? `\n\n${button.help}` : '');
      if (button.active) element.classList.add('active');
      element.style.backgroundImage = button.icon ? `${button.icon}, ${blank}` : blank;
      if (button.hotkey) {
        const key = document.createElement('span');
        key.className = 'hotkey';
        key.textContent = button.hotkey.toUpperCase();
        element.appendChild(key);
      }
      this.commandGrid.appendChild(element);
      this.buttons.set(button.id, element);
    }
  }

  /**
   * Inline placement for one of the selection panel's widgets, measured from
   * `BackgroundRight`'s top-left -- which is our `#selection-panel` element,
   * because its art is that widget's own (issue #64). Nothing when there is
   * no widget data: the open fallback keeps its flex layout.
   */
  private placedStyle(name: string): string {
    const box = widgetBox(this.ui?.layouts.commandpanel, 'BackgroundRight', name);
    if (!box) return '';
    const scaled = (value: number): string => `calc(${value}px * var(--ui-scale))`;
    return `left:${scaled(box.left)};top:${scaled(box.top)};`
      + (box.width ? `width:${scaled(box.width)};` : '') + (box.height ? `height:${scaled(box.height)};` : '');
  }

  setSelection(info: SelectionInfo | undefined): void {
    // The parchment is always there in the reference; only what is written
    // on it comes and goes. The open fallback, with no art, hides the panel.
    const panel = this.root.querySelector<HTMLElement>('#selection-panel')!;
    const placed = widgetBox(this.ui?.layouts.commandpanel, 'BackgroundRight', 'Clipped') !== undefined;
    panel.classList.toggle('placed', placed);
    panel.style.display = info || placed ? '' : 'none';
    if (!info) {
      this.selectionPanel.innerHTML = '';
      return;
    }
    // A group is shown as its members, not as whichever of them happens to be
    // first: one portrait per selected unit, each with what is left of it.
    if (info.members && info.members.length > 1) {
      this.selectionPanel.innerHTML = `
        <div class="placed-box" style="${this.placedStyle('Clipped')}">
        <div class="object-name">${info.members.length} selected</div>
        <div class="selection-grid">
          ${info.members.map(member => `
            <button class="selection-member" data-id="${member.id}" title="${member.name}">
              <span class="member-portrait" style="background-image:${member.icon ?? 'none'}"></span>
              <span class="member-hp"><span class="member-hp-fill" style="width:${
                (Math.max(0, Math.min(1, member.maxHp > 0 ? member.hp / member.maxHp : 0)) * 100).toFixed(1)
              }%"></span></span>
            </button>`).join('')}
        </div>
        </div>`;
      for (const button of this.selectionPanel.querySelectorAll<HTMLElement>('.selection-member')) {
        button.addEventListener('click', () => {
          const id = Number(button.dataset.id);
          if (Number.isFinite(id)) this.callbacks.onSelectMember(id);
        });
      }
      return;
    }
    const health = info.hp !== undefined && info.maxHp !== undefined && info.maxHp > 0;
    const fraction = health ? Math.max(0, Math.min(1, info.hp! / info.maxHp!)) : 0;
    if (!placed) {
      this.selectionPanel.innerHTML = `
        <div class="portrait" style="background-image:${info.icon ?? 'none'}"></div>
        <div class="object-info">
          <div class="object-name">${info.name}</div>
          ${health ? `
          <div class="hp-bar"><div class="hp-fill" style="width:${(fraction * 100).toFixed(1)}%"></div></div>
          <div class="object-hp">${Math.ceil(info.hp!)} / ${info.maxHp}</div>` : ''}
          ${info.details.map(line => `<div class="object-detail">${line}</div>`).join('')}
          ${info.progress ? `
            <div class="progress-label">${info.progress.label}</div>
            <div class="progress-bar"><div class="progress-fill" style="width:${(info.progress.fraction * 100).toFixed(1)}%"></div></div>` : ''}
        </div>`;
      return;
    }
    // Each piece where the reference's `Clipped` area puts it: the name above
    // the portrait, the hit-point bar under it with the number beneath, the
    // owner's line to the right, and the training or research bar where
    // `StatusLabel` and `Progress` sit.
    const at = (name: string): string => `class="placed-box" style="${this.placedStyle(name)}`;
    this.selectionPanel.innerHTML = `
      <div ${at('ObjectName')}"><div class="object-name">${info.name}</div></div>
      <div ${at('ObjectImage')}"><div class="portrait" style="background-image:${info.icon ?? 'none'}"></div></div>
      ${health ? `
      <div ${at('HPProgress')}"><div class="hp-bar"><div class="hp-fill" style="width:${(fraction * 100).toFixed(1)}%"></div></div></div>
      <div ${at('ObjectHealth')}"><div class="object-hp">${Math.ceil(info.hp!)} / ${info.maxHp}</div></div>` : ''}
      ${info.details.length ? `<div ${at('ObjectOwnerNameCulture')}"><div class="object-detail">${info.details.join(' · ')}</div></div>` : ''}
      ${info.stats?.length ? `<div ${at('ObjectStats')}"><div class="object-stats">${info.stats.map(stat => `
        <div class="stat" title="${stat.title}"><span class="stat-icon" style="background-image:url('${this.ui!.base}${stat.icon}')"></span><span class="stat-value">${stat.value}</span></div>`).join('')}</div></div>` : ''}
      ${info.progress ? `
        <div ${at('StatusLabel')}"><div class="progress-label">${info.progress.label}</div></div>
        <div ${at('Progress')}"><div class="progress-bar"><div class="progress-fill" style="width:${(info.progress.fraction * 100).toFixed(1)}%"></div></div></div>` : ''}
    `;
  }

  updateResources(state: GameState, player: PlayerId, status?: ResourceStatus): void {
    const p = state.players[player];
    this.resourceValues.wood.textContent = String(p.wood);
    this.resourceValues.food.textContent = String(p.food);
    this.resourceValues.gold.textContent = String(p.gold);
    this.resourceValues.stone.textContent = String(p.stone);
    this.resourceValues.population.textContent = `${p.population}/${p.populationCap}`;
    if (!status) return;
    // The reference writes a 0 rather than leaving the corner blank, and
    // under the population icon it writes how many villagers there are.
    for (const resource of ['wood', 'food', 'gold', 'stone'] as const) {
      const count = this.root.querySelector<HTMLElement>(`[data-workers="${resource}"]`);
      if (count) count.textContent = String(status.workers[resource]);
    }
    const villagers = this.root.querySelector<HTMLElement>('[data-workers="villagers"]');
    if (villagers) villagers.textContent = String(status.villagers);
    const idle = this.root.querySelector<HTMLElement>('[data-workers="idle"]');
    if (idle) idle.textContent = status.idle ? String(status.idle) : '';
    const shield = this.root.querySelector<HTMLElement>('[data-age-shield]');
    if (shield) shield.style.backgroundImage = this.texture(status.ageShield);
    const text = this.root.querySelector<HTMLElement>('[data-age-text]');
    if (text) text.textContent = status.ageName;
    const fill = this.root.querySelector<HTMLElement>('.age-fill');
    if (fill) fill.style.width = `${(Math.max(0, Math.min(1, status.ageProgress)) * 100).toFixed(1)}%`;
  }

  showEnd(victory: boolean): void {
    this.endDialog.classList.remove('hidden');
    this.endDialog.querySelector('#end-title')!.textContent = victory ? 'Victory!' : 'Defeat';
  }

  hideEnd(): void {
    this.endDialog.classList.add('hidden');
  }

  /**
   * One of the reference's action icons, by the index its own files use:
   * `buttons.json` says the town bell is 49 and the gather-point flag 45,
   * and the sheet agrees. 0 is the red cross, 3 the open palm, 30 and 31
   * the economic and military hammers, 12 and 13 pack and unpack, 70 and 71
   * the farm-reseed toggle lit and unlit.
   */
  actionIcon(index: number): string | undefined {
    const url = materialUrl(this.ui, `IconAction${String(index).padStart(3, '0')}`);
    return url ? `url('${url}')` : undefined;
  }

  iconFor(category: 'Units' | 'Buildings' | 'Techs', index: number | undefined): string | undefined {
    if (index === undefined) return undefined;
    const url = iconUrl(this.ui, category, index);
    return url ? `url('${url}')` : undefined;
  }
}
