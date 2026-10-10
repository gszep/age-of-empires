import type { ReadonlyGameState, PlayerId } from '../sim/types';
import { WONDER_YEARS } from '../sim/wonder';
import { displayedWonderCountdowns, wonderTimerText, wonderYearsRemaining } from './wonder';
import { materialUrl, type UiAssets } from './assets';
import { widgetBox } from './layout';
import { findWidget } from './feedback';

export interface ObjectivesModel {
  lines: string[];
}

/**
 * Read-only objectives: standard Conquest always; Wonder victory countdown
 * when enabled in the current match.
 */
export function objectivesModel(state: ReadonlyGameState, player: PlayerId,
  strings: Record<string, string> = {}, names: Record<PlayerId, string> = { 1: 'Player 1', 2: 'Player 2' }): ObjectivesModel {
  const lines = [strings['9823'] ?? 'Conquest: Destroy all enemies.'];
  if (state.wonderVictory) {
    lines.push(`${strings['11436'] ?? 'Build a Wonder'} — ${wonderTimerText(WONDER_YEARS, strings['11301'])}`);
    // Both sides' public timers matter. Never inspect hidden enemy entities
    // beyond the simulation's public countdown selector (also used by the HUD).
    const timers = displayedWonderCountdowns(state);
    for (const timer of [...timers.filter(t => t.owner === player), ...timers.filter(t => t.owner !== player)]) {
      lines.push(`${names[timer.owner]} — ${wonderTimerText(wonderYearsRemaining(timer.finishTick, state.tick), strings['11301'])}`);
    }
  }
  return { lines };
}

export function objectivesAvailable(ui: UiAssets | undefined): boolean {
  return !!ui?.layouts.dialogobjectives && ['10910', '9249', '9823', '11436', '11301'].every(id => !!ui.objectivesStrings?.[id]);
}

/** Read-only current-player objectives dialog. */
export class ObjectivesDialog {
  readonly element: HTMLDialogElement;
  private previousFocus?: HTMLElement;

  constructor(root: HTMLElement, ui: UiAssets | undefined, private sound: () => void = () => {}) {
    const dialog = this.element = document.createElement('dialog');
    dialog.id = 'objectives-dialog';
    dialog.setAttribute('aria-labelledby', 'objectives-title');
    dialog.innerHTML = `<h2 id="objectives-title"></h2><div class="objectives-lines"></div><button data-objectives-close></button>`;
    dialog.querySelector('h2')!.textContent = ui?.objectivesStrings?.['10910'] ?? 'Objectives';
    const close = dialog.querySelector<HTMLButtonElement>('[data-objectives-close]')!;
    close.textContent = ui?.objectivesStrings?.['9249'] ?? 'Close';
    const layout = ui?.layouts.dialogobjectives;
    if (layout) {
      const { width, height } = layout.viewPort;
      dialog.style.width = `calc(${width}px * var(--ui-scale))`;
      dialog.style.height = `calc(${height}px * var(--ui-scale))`;
      const background = findWidget(layout.widgets, 'BackgroundObjectives')!;
      const art = materialUrl(ui, background.StateMaterials?.StateNormal?.Material ?? '');
      if (art) { dialog.style.backgroundImage = `url("${art}")`; dialog.style.backgroundColor = 'transparent'; }
      for (const [selector, within, name] of [
        ['h2', 'BackgroundObjectives', 'Title'], ['.objectives-lines', 'BackgroundObjectives', 'ObjectivesBox'],
        ['[data-objectives-close]', 'Clipped', 'ButtonCancel'],
      ]) {
        const element = dialog.querySelector<HTMLElement>(selector)!;
        const box = widgetBox(layout, within, name)!;
        Object.assign(element.style, { left: `${box.left / width * 100}%`, top: `${box.top / height * 100}%`,
          width: `${box.width / width * 100}%`, height: `${box.height / height * 100}%` });
        const widget = findWidget(name === 'ButtonCancel' ? layout.widgets : background.ChildWidgets ?? [], name)!;
        const font = (widget.StateMaterials?.StateNormal ?? widget.StateMaterials?.StateTextNormal)?.Font;
        if (font) {
          element.style.fontSize = `calc(${font.PointSize}px * var(--ui-scale))`;
          const c = font.TextColor;
          if (c) element.style.color = `rgb(${c.r}, ${c.g}, ${c.b})`;
        }
        if (name === 'ButtonCancel') for (const [state, property] of [['StateNormal', '--normal'], ['StateHover', '--hover'], ['StatePressed', '--pressed']]) {
          const image = materialUrl(ui, widget.StateMaterials?.[state]?.Material ?? '');
          if (image) element.style.setProperty(property, `url("${image}")`);
        }
      }
    }
    close.addEventListener('click', () => { this.sound(); this.close(); });
    dialog.addEventListener('cancel', event => { event.preventDefault(); this.close(); });
    dialog.addEventListener('keydown', event => event.stopPropagation());
    root.append(dialog);
  }

  get open(): boolean { return this.element.open; }

  show(model: ObjectivesModel): void {
    if (this.open) { this.update(model); return; }
    this.previousFocus = document.activeElement as HTMLElement;
    this.update(model);
    this.element.showModal();
  }

  update(model: ObjectivesModel): void {
    const content = this.element.querySelector('.objectives-lines')!;
    if ([...content.children].map(p => p.textContent).join('\n') === model.lines.join('\n')) return;
    content.textContent = '';
    for (const line of model.lines) {
      const p = document.createElement('p');
      p.textContent = line;
      content.append(p);
    }
  }

  close(): void {
    if (!this.open) return;
    this.element.close();
    if (this.previousFocus?.isConnected) this.previousFocus.focus();
  }
}
