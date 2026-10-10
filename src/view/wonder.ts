import type { PlayerId, ReadonlyGameState } from '../sim/types';
import { wonderCountdowns, WONDER_YEARS, WONDER_YEAR_TICKS } from '../sim/wonder';
import { iconUrl, materialUrl, type UiAssets } from './assets';
import { widgetBox } from './layout';

/** Shared by the banner and read-only Objectives screen: five seconds/year,
 * ceiling fractional years, clamped at expiry (see docs/wonder-victory.md). */
export function wonderYearsRemaining(finishTick: number, tick: number): number {
  return Math.max(0, Math.ceil((finishTick - tick) / WONDER_YEAR_TICKS));
}

export function wonderTimerText(years: number, template = 'Wonder: %d Years'): string {
  return template.replace('%d', String(years));
}

export function displayedWonderCountdowns(state: ReadonlyGameState) {
  return [...wonderCountdowns(state)].sort((a, b) => a.finishTick - b.finishTick || a.entityId - b.entityId)
    .filter((t, i, all) => all.findIndex(other => other.owner === t.owner) === i)
    .sort((a, b) => a.owner - b.owner);
}

/** Owned WonderPanel banners and public construction/countdown announcements.
 * Browser font rasterisation and adjacent banner packing remain view adapters. */
export class WonderPanel {
  private root: HTMLDivElement;
  private known?: Map<number, { owner: PlayerId; counting: boolean }>;
  private buttons = new Map<number, HTMLButtonElement>();
  constructor(parent: HTMLElement, private ui: UiAssets | undefined, private strings: Record<string, string>,
    private message: (text: string) => void, private look: (id: number) => void) {
    this.root = document.createElement('div'); this.root.id = 'wonder-countdowns'; parent.prepend(this.root);
  }

  update(state: ReadonlyGameState, self: PlayerId, names: Record<PlayerId, string>): void {
    const timers = wonderCountdowns(state);
    const current = new Map<number, { owner: PlayerId; counting: boolean }>();
    if (state.wonderVictory) for (const e of state.entities) {
      if (e.kind !== 'wonder' || e.owner === 0 || e.dead || e.hp <= 0) continue;
      const counting = timers.some(t => t.entityId === e.id);
      current.set(e.id, { owner: e.owner, counting });
      if (!this.known) continue; // snapshot/HMR is not a new completion
      const old = this.known.get(e.id);
      if (!old && e.buildProgress !== undefined) this.message(e.owner === self
        ? this.strings.wonderStartedSelf ?? 'You have started building a Wonder!'
        : (this.strings.wonderStartedOther ?? '%s started building a Wonder!').replace('%s', names[e.owner]));
      if (counting && !old?.counting) this.message((e.owner === self
        ? this.strings.wonderCompletedSelf ?? 'You completed a Wonder. You will win if it stands for %d years!'
        : this.strings.wonderCompletedEnemy ?? '%s completed a Wonder. You will lose if it stands for %d years!')
        .replace('%s', names[e.owner]).replace('%d', String(WONDER_YEARS)));
    }
    if (this.known) for (const [id, old] of this.known) {
      if (!current.has(id) && !state.winner && !state.draw) this.message(old.owner === self
        ? this.strings.wonderDestroyedSelf ?? 'Your Wonder was destroyed!'
        : (this.strings.wonderDestroyedOther ?? "%s's Wonder was destroyed!").replace('%s', names[old.owner]));
    }
    this.known = current;
    // The native panel has player banners. Show that side's earliest standing
    // deadline; a second Wonder does not erase the first one's elapsed time.
    const shown = displayedWonderCountdowns(state);
    const layout = this.ui?.layouts.wonderpanel;
    const flag = widgetBox(layout, 'Banners', 'Flag') ?? { left: -195, top: -55, width: 90, height: 457 };
    const scaled = (value: number) => `calc(${value}px * var(--ui-scale))`;
    for (const [index, timer] of shown.entries()) {
      let button = this.buttons.get(timer.entityId);
      if (!button) {
        button = document.createElement('button'); button.type = 'button'; button.className = 'wonder-banner';
        button.dataset.wonderId = String(timer.entityId);
        button.innerHTML = '<span class="wonder-icon"></span><span class="wonder-years"></span><span class="wonder-unit"></span><span class="wonder-owner"></span>';
        button.addEventListener('click', () => this.look(timer.entityId));
        this.buttons.set(timer.entityId, button); this.root.append(button);
        for (const [selector, name, fallback] of [
          ['.wonder-icon', 'Icon1', { left: 15, top: 175, width: 60, height: 60 }],
          ['.wonder-years', 'TimeText1', { left: -5, top: 235, width: 100, height: 60 }],
          ['.wonder-unit', 'Years', { left: -7, top: 275, width: 100, height: 60 }],
          ['.wonder-owner', 'PlayerNumber', { left: -7, top: 295, width: 100, height: 60 }],
        ] as const) {
          const box = widgetBox(layout, 'Flag', name) ?? fallback;
          Object.assign(button.querySelector<HTMLElement>(selector)!.style, {
            left: scaled(box.left), top: scaled(box.top), width: scaled(box.width), height: scaled(box.height),
          });
        }
      }
      Object.assign(button.style, { right: scaled(-flag.left - flag.width + index * flag.width), top: scaled(flag.top),
        width: scaled(flag.width), height: scaled(flag.height) });
      const art = materialUrl(this.ui, `WonderBanner${timer.owner - 1}`);
      button.style.backgroundImage = art ? `url("${art}")` : '';
      button.classList.toggle('open-banner', !art);
      const icon = iconUrl(this.ui, 'Buildings', 37);
      button.querySelector<HTMLElement>('.wonder-icon')!.style.backgroundImage = icon ? `url("${icon}")` : '';
      const years = wonderYearsRemaining(timer.finishTick, state.tick);
      button.querySelector('.wonder-years')!.textContent = String(years);
      button.querySelector('.wonder-unit')!.textContent = this.strings.wonderYears ?? 'Years';
      button.querySelector('.wonder-owner')!.textContent = String(timer.owner);
      button.title = (timer.owner === self ? this.strings.wonderTimerSelf : this.strings.wonderTimerEnemy)?.replace('%s', names[timer.owner])
        ?? `${names[timer.owner]} — Wonder: ${years} Years`;
      button.setAttribute('aria-label', `${names[timer.owner]}: ${wonderTimerText(years, this.strings.wonderTimer)}`);
    }
    for (const [id, button] of this.buttons) if (!shown.some(t => t.entityId === id)) { button.remove(); this.buttons.delete(id); }
    this.root.hidden = shown.length === 0;
  }
}
