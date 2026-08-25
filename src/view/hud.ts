/**
 * AoE2DE WEST in-game HUD recreated from the imported widgetui geometry:
 * resource strip top-left, menu controls top-right, command grid bottom-left,
 * selection panel bottom-centre, minimap panel bottom-right. Falls back to an
 * open skin when imported assets are absent.
 */
import { materialUrl, iconUrl, type UiAssets } from './assets';
import { Minimap } from './minimap';
import type { GameState, PlayerId, Point } from '../sim/types';

export interface CommandButton {
  id: string;
  label: string;
  hotkey?: string;
  icon?: string; // css background url
  enabled: boolean;
  active?: boolean;
}

export interface SelectionInfo {
  name: string;
  icon?: string;
  hp: number;
  maxHp: number;
  details: string[];
  progress?: { label: string; fraction: number };
}

export interface HudCallbacks {
  onCommand(id: string): void;
  onMinimapNavigate(point: Point): void;
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
            <span class="resource-icon" data-icon="${resource}"></span>
            <span class="resource-value" data-value="${resource}">0</span>
          </div>`).join('')}
        <div class="resource-slot" data-resource="population">
          <span class="resource-icon" data-icon="population"></span>
          <span class="resource-value" data-value="population">0/0</span>
        </div>
        <button class="idle-villager" data-command="idle-villager" title="Select idle villager (.)"></button>
      </div>
      <div id="menu-panel" class="panel">
        <button data-menu="pause" class="menu-button" data-icon="settings" title="Pause (F3)"></button>
        <button data-menu="open" class="menu-button" data-icon="menu" title="Menu (F10)"></button>
      </div>
      <div id="bottombar-strip" class="panel"></div>
      <div id="command-panel" class="panel"><div id="command-grid"></div></div>
      <div id="selection-panel" class="panel"><div id="selection-content"></div></div>
      <div id="map-panel" class="panel"><canvas id="minimap-canvas" width="240" height="130"></canvas></div>
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
    const pauseButton = this.root.querySelector<HTMLElement>('[data-icon="settings"]')!;
    pauseButton.style.backgroundImage = this.texture('MenuSettingsNormal');
    const menuButton = this.root.querySelector<HTMLElement>('[data-icon="menu"]')!;
    menuButton.style.backgroundImage = this.texture('MenuMenuNormal');

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
      navigate(event);
      const move = (moveEvent: PointerEvent) => navigate(moveEvent);
      const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); };
      addEventListener('pointermove', move);
      addEventListener('pointerup', up);
    });
  }

  /** Uniform HUD scale from the 3840x2160 widget reference space. */
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
    for (const button of buttons.slice(0, 15)) {
      const element = document.createElement('button');
      element.className = 'command-button';
      element.dataset.command = button.id;
      element.disabled = !button.enabled;
      element.title = `${button.label}${button.hotkey ? ` (${button.hotkey.toUpperCase()})` : ''}`;
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

  setSelection(info: SelectionInfo | undefined): void {
    const panel = this.root.querySelector<HTMLElement>('#selection-panel')!;
    panel.style.display = info ? '' : 'none';
    if (!info) {
      this.selectionPanel.innerHTML = '';
      return;
    }
    const fraction = Math.max(0, Math.min(1, info.hp / info.maxHp));
    this.selectionPanel.innerHTML = `
      <div class="portrait" style="background-image:${info.icon ?? 'none'}"></div>
      <div class="object-info">
        <div class="object-name">${info.name}</div>
        <div class="hp-bar"><div class="hp-fill" style="width:${(fraction * 100).toFixed(1)}%"></div></div>
        <div class="object-hp">${Math.ceil(info.hp)} / ${info.maxHp}</div>
        ${info.details.map(line => `<div class="object-detail">${line}</div>`).join('')}
        ${info.progress ? `
          <div class="progress-label">${info.progress.label}</div>
          <div class="progress-bar"><div class="progress-fill" style="width:${(info.progress.fraction * 100).toFixed(1)}%"></div></div>` : ''}
      </div>`;
  }

  updateResources(state: GameState, player: PlayerId): void {
    const p = state.players[player];
    this.resourceValues.wood.textContent = String(p.wood);
    this.resourceValues.food.textContent = String(p.food);
    this.resourceValues.gold.textContent = String(p.gold);
    this.resourceValues.stone.textContent = String(p.stone);
    this.resourceValues.population.textContent = `${p.population} / ${p.populationCap}`;
  }

  showEnd(victory: boolean): void {
    this.endDialog.classList.remove('hidden');
    this.endDialog.querySelector('#end-title')!.textContent = victory ? 'Victory!' : 'Defeat';
  }

  hideEnd(): void {
    this.endDialog.classList.add('hidden');
  }

  iconFor(category: 'Units' | 'Buildings', index: number | undefined): string | undefined {
    if (index === undefined) return undefined;
    const url = iconUrl(this.ui, category, index);
    return url ? `url('${url}')` : undefined;
  }
}
