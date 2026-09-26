import type { PlayerId, ResourceKind } from '../sim/types';
import type { UiAssets } from './assets';
import { buttonText, slices } from './native-feedback';

export type TributeDraft = Partial<Record<ResourceKind, number | 'all'>>;
export interface DiplomacyModel {
  player: PlayerId; readOnly: boolean; hasMarket: boolean; fee: number;
  maximum: Record<ResourceKind, number>;
  players: { id: PlayerId; name: string; civilization: string; color: string }[];
}
const resources = ['wood', 'food', 'gold', 'stone'] as const;
const px = (value: number) => `calc(${value}px * var(--ui-scale))`;

/** Two-player adaptation of dialogdiplomacy.xaml/SystemResourcesDiplomacyItem.
 * Current matches are locked opposing teams. Display native stance controls as
 * locked rather than offering a relation the simulation cannot honour. */
export class DiplomacyDialog {
  readonly element: HTMLDialogElement;
  private model?: DiplomacyModel;
  private draft: TributeDraft = {};
  private previousFocus?: HTMLElement;
  constructor(root: HTMLElement, ui: UiAssets | undefined, private text: Record<string, string>,
    private confirm: (draft: TributeDraft) => { ok: boolean; reason?: string }, private sound: () => void) {
    this.element = document.createElement('dialog');
    const dialog = this.element;
    dialog.id = 'diplomacy-dialog'; dialog.setAttribute('aria-labelledby', 'diplomacy-title');
    dialog.innerHTML = `<div class="diplomacy-frame"></div><section class="diplomacy-content">
      <h2 id="diplomacy-title"></h2><button data-diplomacy-close class="native-button" aria-label="Close">×</button>
      <div class="diplomacy-table"></div><p data-diplomacy-market></p>
      <label class="diplomacy-lock"><input type="checkbox" checked disabled><span></span></label>
      <label class="diplomacy-victory"><input type="checkbox" disabled><span></span></label>
      <p data-diplomacy-error role="alert"></p><div class="diplomacy-actions">
        <button data-diplomacy-confirm class="native-button"></button><button data-diplomacy-clear class="native-button"></button>
        <button data-diplomacy-cancel class="native-button"></button></div></section>`;
    root.append(dialog);
    dialog.querySelector('#diplomacy-title')!.textContent = text.diplomacy ?? 'Diplomacy';
    dialog.querySelector('.diplomacy-lock span')!.textContent = text.lockTeams ?? 'Lock Teams';
    dialog.querySelector<HTMLElement>('.diplomacy-lock')!.title = text.lockTeamsHelp ?? 'Players cannot change teams mid game.';
    dialog.querySelector('.diplomacy-victory span')!.textContent = text.alliedVictory ?? 'Allied Victory';
    dialog.querySelector<HTMLElement>('.diplomacy-victory')!.title = text.alliedVictoryHelp ?? '';
    for (const [selector, label] of [['confirm', text.ok ?? 'OK'], ['clear', text.clearTributes ?? 'Clear Tributes'], ['cancel', text.cancel ?? 'Cancel']]) {
      buttonText(dialog.querySelector(`[data-diplomacy-${selector}]`)!, label);
    }
    dialog.querySelector('[data-diplomacy-close]')!.setAttribute('aria-label', text.close ?? 'Close');
    const native = ui?.nativeFeedback;
    if (ui && native?.diplomacy) {
      const d = native.diplomacy;
      dialog.style.width = px(d.width);
      for (const [name, size] of Object.entries(d.fonts)) dialog.style.setProperty(`--diplomacy-${name}-font`, px(size));
      dialog.style.setProperty('--diplomacy-columns', d.columns.map(n => n === '*' ? 'minmax(0, 1fr)' : px(Number(n))).join(' '));
      dialog.style.setProperty('--diplomacy-row', px(d.rowHeight));
      dialog.style.setProperty('--tribute-width', px(d.tributeSize[0]));
      dialog.style.setProperty('--tribute-height', px(d.tributeSize[1]));
      slices(dialog.querySelector<HTMLElement>('.diplomacy-frame')!, native.confirm.frame, ui);
      for (const resource of resources) for (const state of ['Normal', 'Hover', 'Active', 'Disabled']) {
        const key = resource[0].toUpperCase() + resource.slice(1) + state + 'Icon';
        dialog.style.setProperty(`--tribute-${resource}-${state.toLowerCase()}`, `url('${ui.base}${d.icons[key]}')`);
      }
      const close = dialog.querySelector<HTMLElement>('[data-diplomacy-close]')!;
      close.style.width = px(d.closeSize[0]); close.style.height = px(d.closeSize[1]);
      for (const button of dialog.querySelectorAll<HTMLElement>('.diplomacy-actions button')) button.style.width = px(d.buttonWidth);
    } else {
      for (const button of dialog.querySelectorAll('.native-button')) button.classList.remove('native-button');
    }
    dialog.addEventListener('cancel', event => { event.preventDefault(); this.close(); });
    dialog.addEventListener('keydown', event => event.stopPropagation());
    dialog.addEventListener('click', event => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
      if (!button || button.disabled) return;
      this.sound();
      if (button.hasAttribute('data-diplomacy-close') || button.hasAttribute('data-diplomacy-cancel')) this.close();
      if (button.hasAttribute('data-diplomacy-clear')) { this.draft = {}; this.render(); }
      if (button.dataset.tributeResource) this.adjust(button.dataset.tributeResource as ResourceKind, event, 1);
      if (button.hasAttribute('data-diplomacy-confirm')) {
        if (!Object.keys(this.draft).length) { this.close(); return; }
        if (this.model?.readOnly || !this.model?.hasMarket) return;
        const result = this.confirm({ ...this.draft });
        if (result.ok) this.close();
        else dialog.querySelector('[data-diplomacy-error]')!.textContent = result.reason ?? '';
      }
    });
    dialog.addEventListener('contextmenu', event => {
      event.preventDefault();
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-tribute-resource]');
      if (!button || button.disabled) return;
      this.adjust(button.dataset.tributeResource as ResourceKind, event, -1);
    });
  }
  get open(): boolean { return this.element.open; }
  show(model: DiplomacyModel): void {
    this.model = model;
    if (this.open) return;
    this.draft = {}; this.previousFocus = document.activeElement as HTMLElement;
    this.element.querySelector('[data-diplomacy-error]')!.textContent = '';
    this.render(); this.element.showModal();
  }
  close(): void {
    this.draft = {}; this.element.close();
    if (this.previousFocus?.isConnected) this.previousFocus.focus();
  }
  update(model: DiplomacyModel): void {
    this.model = model;
    if (this.open) this.render();
  }
  private adjust(resource: ResourceKind, event: MouseEvent, direction: number): void {
    if (!this.model || this.model.readOnly || !this.model.hasMarket) return;
    const current = this.draft[resource] === 'all' ? this.model.maximum[resource] : this.draft[resource] ?? 0;
    const next = event.ctrlKey ? direction > 0 ? 'all' : 0
      : Math.min(this.model.maximum[resource], Math.max(0, current + direction * (event.shiftKey ? 500 : 100)));
    if (next) this.draft[resource] = next; else delete this.draft[resource];
    this.render();
  }
  private render(): void {
    const model = this.model;
    if (!model) return;
    const table = this.element.querySelector('.diplomacy-table')!;
    // Keep focused buttons stable across live quote updates.
    if (!table.children.length) {
      const header = document.createElement('div'); header.className = 'diplomacy-row diplomacy-heading';
      for (const label of ['', this.text.diplomacyName ?? 'Name', this.text.civilization ?? 'Civilization', this.text.theirStance ?? 'Their Stance',
        this.text.ally ?? 'Ally', this.text.neutral ?? 'Neutral', this.text.enemy ?? 'Enemy']) {
        const cell = document.createElement('span'); cell.textContent = label; header.append(cell);
      }
      const tribute = document.createElement('span'); tribute.dataset.tributeHeading = ''; tribute.style.gridColumn = 'span 4'; header.append(tribute);
      table.append(header);
      for (const p of model.players) {
        const row = document.createElement('div'); row.className = 'diplomacy-row'; row.dataset.player = String(p.id);
        for (const key of ['number', 'name', 'civilization', 'stance']) {
          const cell = document.createElement('span'); cell.dataset.diplomacyCell = key; row.append(cell);
        }
        for (const relation of ['ally', 'neutral', 'enemy']) {
          const cell = document.createElement('label'), radio = document.createElement('input');
          radio.type = 'radio'; radio.name = `diplomacy-${p.id}`; radio.disabled = true; radio.dataset.relation = relation;
          radio.setAttribute('aria-label', this.text[relation] ?? relation); cell.title = this.text[`${relation}Help`] ?? '';
          cell.append(radio); row.append(cell);
        }
        for (const resource of resources) {
          const cell = document.createElement('div'), button = document.createElement('button');
          button.dataset.tributeResource = resource; button.className = 'tribute-button';
          button.setAttribute('aria-label', `${this.text.tribute ?? 'Tribute'} ${resource}`);
          const suffix = resource[0].toUpperCase() + resource.slice(1);
          button.title = this.text[`tribute${suffix}Help`] ?? `Click:100 ${resource}; Shift:500; Ctrl:all; right-click:subtract`;
          button.style.setProperty('--tribute-normal', `var(--tribute-${resource}-normal)`);
          button.style.setProperty('--tribute-hover', `var(--tribute-${resource}-hover)`);
          button.style.setProperty('--tribute-active', `var(--tribute-${resource}-active)`);
          button.style.setProperty('--tribute-disabled', `var(--tribute-${resource}-disabled)`);
          cell.append(button); row.append(cell);
        }
        table.append(row);
      }
    }
    table.querySelector('[data-tribute-heading]')!.textContent = (this.text.payTribute ?? 'Pay Tribute (cost %d%%)').replace('%d', String(model.fee)).replace('%%', '%');
    for (const p of model.players) {
      const row = table.querySelector<HTMLElement>(`[data-player="${p.id}"]`)!;
      for (const [key, value] of Object.entries({ number: String(p.id), name: p.name, civilization: p.civilization,
        stance: p.id === model.player ? this.text.ally ?? 'Ally' : this.text.enemy ?? 'Enemy' })) {
        row.querySelector(`[data-diplomacy-cell="${key}"]`)!.textContent = value;
      }
      row.querySelector<HTMLElement>('[data-diplomacy-cell="number"]')!.style.backgroundColor = p.color;
      for (const radio of row.querySelectorAll<HTMLInputElement>('[data-relation]')) radio.checked = radio.dataset.relation === (p.id === model.player ? 'ally' : 'enemy');
      for (const button of row.querySelectorAll<HTMLButtonElement>('[data-tribute-resource]')) {
        const resource = button.dataset.tributeResource as ResourceKind;
        const value = p.id === model.player ? 0 : this.draft[resource] ?? 0;
        button.textContent = String(value === 'all' ? model.maximum[resource] : value);
        button.disabled = model.readOnly || !model.hasMarket || p.id === model.player;
      }
    }
    this.element.querySelector('[data-diplomacy-market]')!.textContent = model.hasMarket ? '' : this.text.tributeNeedsMarket ?? 'You need a Market to pay tribute.';
    this.element.querySelector<HTMLButtonElement>('[data-diplomacy-confirm]')!.disabled = model.readOnly;
    this.element.querySelector<HTMLButtonElement>('[data-diplomacy-clear]')!.disabled = model.readOnly;
  }
}
